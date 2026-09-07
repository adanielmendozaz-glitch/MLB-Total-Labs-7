const MLBDB = {
  dbName: 'mlb_totals_lab',
  sqlite: null,
  ready: false,
  censusStorageKey: 'mlb_v60_rank_census',
  censusSqlKey: 'rank_census_v1',
  betsStorageKey: 'mlb_v5_bets',
  betsSqlKey: 'bets_v1',
  bankStorageKey: 'mlb_v71_bank',
  bankSqlKey: 'bank_v1',
  labStorageKey: 'mlb_v5_lab',
  labSqlKey: 'lab_v1',


  /* V7.8.6 LOCALSTORAGE QUOTA GUARD */
  safeLocalSet(key, value) {
    try {
      this.safeLocalSet(key, String(value));
      return true;
    } catch (err) {
      const msg = String(err?.message || err || '');
      const quota =
        err?.name === 'QuotaExceededError' ||
        /quota|exceeded/i.test(msg);

      this.lastLocalStorageWarning = {
        key,
        quota,
        message: msg,
        at: new Date().toISOString()
      };

      console.warn(
        quota
          ? 'LocalStorage quota llena; se conserva SQLite/IndexedDB'
          : 'LocalStorage write falló',
        key,
        err
      );

      return false;
    }
  },

  safeLocalRemove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch (err) {
      console.warn('LocalStorage remove falló', key, err);
      return false;
    }
  },

  showStatus(message, ok) {
    let badge = document.getElementById('mlb-sqlite-status');

    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'mlb-sqlite-status';
      badge.style.cssText =
        'position:fixed;right:12px;bottom:12px;z-index:999999;' +
        'padding:8px 11px;border-radius:10px;font:600 12px system-ui;' +
        'color:white;box-shadow:0 2px 10px rgba(0,0,0,.35);';
      document.body.appendChild(badge);
    }

    badge.textContent = message;
    badge.style.background = ok ? '#147a38' : '#a92222';
  },

  /* SQLITE STARTUP RECOVERY V3 */
  async init() {
    if(this.__initPromise){
      return this.__initPromise;
    }

    this.__initPromise=(async()=>{
      const sqlite=
        window.Capacitor?.Plugins?.CapacitorSQLite;

      this.lastInitError=null;
      this.lastInitStage='start';

      if(!sqlite){
        this.lastInitError='CapacitorSQLite no disponible';
        this.lastInitStage='plugin';
        this.ready=false;
        this.showStatus('SQLite ERROR · plugin',false);
        return false;
      }

      this.sqlite=sqlite;

      const opts={
        database:this.dbName,
        readonly:false
      };

      const createOpts={
        database:this.dbName,
        encrypted:false,
        mode:'no-encryption',
        version:1,
        readonly:false
      };

      const ensureSchema=async()=>{
        this.lastInitStage='schema';

        await sqlite.execute({
          database:this.dbName,
          statements:`
            CREATE TABLE IF NOT EXISTS app_kv (
              key TEXT PRIMARY KEY NOT NULL,
              value TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS _sqlite_healthcheck (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              token TEXT NOT NULL,
              created_at TEXT NOT NULL
            );
          `,
          transaction:true,
          readonly:false
        });
      };

      const connectionOpen=async()=>{
        try{
          const r=
            await sqlite.isDBOpen(opts);

          return r?.result===true;
        }catch{
          return false;
        }
      };

      const createIfNeeded=async()=>{
        try{
          await sqlite.createConnection(
            createOpts
          );
          return 'created';
        }catch(err){
          const msg=
            String(
              err?.message || err || ''
            );

          if(
            /already exists|connection .* exists/i
              .test(msg)
          ){
            return 'existing';
          }

          throw err;
        }
      };

      const openStable=async(forceFresh=false)=>{
        this.lastInitStage=
          forceFresh
            ?'connection-recovery'
            :'connection';

        /*
         * Si JS y Native quedaron desfasados, el plugin puede
         * limpiar conexiones inconsistentes por sí mismo.
         */
        if(
          typeof sqlite.checkConnectionsConsistency==='function'
        ){
          try{
            await sqlite.checkConnectionsConsistency({
              dbNames:[this.dbName],
              openModes:['RW']
            });
          }catch(e){
            console.warn(
              'SQLite consistency check:',
              e
            );
          }
        }

        if(forceFresh){
          try{
            const opened=
              await connectionOpen();

            if(opened){
              try{
                await sqlite.close(opts);
              }catch{}
            }
          }catch{}

          try{
            await sqlite.closeConnection(opts);
          }catch{}
        }

        let opened=
          await connectionOpen();

        if(opened){
          return true;
        }

        await createIfNeeded();

        opened=
          await connectionOpen();

        if(!opened){
          /*
           * La documentación del plugin advierte que open()
           * reabre una DB ya abierta. Por eso sólo se llama
           * tras confirmar que isDBOpen() es false.
           */
          await sqlite.open(opts);
        }

        opened=
          await connectionOpen();

        if(!opened){
          throw new Error(
            'SQLite no quedó abierto después de open()'
          );
        }

        return true;
      };

      const finishBoot=async()=>{
        await ensureSchema();

        this.lastInitStage='healthcheck';

        const health=
          await this.healthCheck();

        if(!health){
          throw new Error(
            'SQLite healthcheck falló'
          );
        }

        this.ready=true;

        this.lastInitStage='reconcile';

        const censusMode=
          await this.initCensusReconciled();

        const betsMode=
          await this.initBetsReconciled();

        const bankMode=
          await this.initBankReconciled();

        await this.initLabPersistence();

        const vaultHealth=
          await this.vaultHealth();

        const vaultIntegrity=
          await this.vaultIntegrityCheck();

        this.lastVaultIntegrity=
          vaultIntegrity;

        const nativeHealth=
          await this.nativeReliabilityCheck();

        this.lastNativeHealth=
          nativeHealth;

        this.lastInitStage='ready';

        if(
          vaultHealth.ok &&
          vaultIntegrity.ok &&
          nativeHealth.ok
        ){
          this.showStatus(
            'SQLite OK · Data Vault protegido',
            true
          );
        }else if(
          vaultHealth.ok &&
          !vaultIntegrity.ok
        ){
          console.warn(
            'Data Vault fingerprint mismatch:',
            vaultIntegrity
          );

          this.showStatus(
            'SQLite OK · Vault pendiente',
            true
          );
        }else if(
          censusMode==='restored'
        ){
          this.showStatus(
            'SQLite OK · Censo restaurado',
            true
          );
        }else if(
          censusMode==='backed-up'
        ){
          this.showStatus(
            'SQLite OK · Censo protegido',
            true
          );
        }else{
          this.showStatus(
            'SQLite OK',
            true
          );
        }

        return true;
      };

      let firstError=null;

      try{
        await openStable(false);
        return await finishBoot();

      }catch(err){
        firstError=err;

        console.warn(
          'SQLite primer arranque falló; intentando recuperación:',
          err
        );

        this.ready=false;
      }

      /*
       * Un solo intento de recuperación limpia.
       * No borra la DB: sólo cierra la conexión en memoria,
       * recrea el handle y vuelve a abrir el mismo archivo.
       */
      try{
        await new Promise(
          r=>setTimeout(r,250)
        );

        await openStable(true);

        const ok=
          await finishBoot();

        if(ok){
          this.lastInitError=null;
          return true;
        }

      }catch(err){
        this.ready=false;

        this.lastInitError=
          String(
            err?.message ||
            err ||
            firstError?.message ||
            firstError ||
            'Error desconocido'
          );

        this.lastInitStage=
          'failed';

        console.error(
          'SQLite recovery failed:',
          {
            first:firstError,
            second:err
          }
        );

        this.showStatus(
          'SQLite ERROR · conexión',
          false
        );

        return false;
      }

      return false;
    })();

    try{
      return await this.__initPromise;
    }finally{
      this.__initPromise=null;
    }
  },


  /* V7.8.5C2 NATIVE RELIABILITY CHECK */

  async nativeReliabilityCheck() {

    const report={

      ok:false,

      ranAt:
        new Date().toISOString(),

      plugin:
        !!this.sqlite,

      ready:
        this.ready===true,

      database:
        this.dbName,

      healthcheck:false,

      tables:false,

      schema:false,

      kvWrite:false,

      kvRead:false,

      kvDelete:false,

      vault:false,

      details:{}

    };


    this.lastNativeHealth=
      report;


    if(
      !this.sqlite ||
      !this.ready
    ){

      report.details.error=
        'SQLite no está listo';

      return report;
    }


    const token=
      '__mlb_native_test_'+
      Date.now()+
      '_'+
      Math.random()
        .toString(16)
        .slice(2);


    const value=
      JSON.stringify({

        test:'V7.8.5C2',

        token,

        created:
          new Date()
            .toISOString()

      });


    try{

      /* -------------------------------
         HEALTHCHECK NATIVO EXISTENTE
         ------------------------------- */

      report.healthcheck=
        await this.healthCheck();


      /* -------------------------------
         TABLAS REQUERIDAS
         ------------------------------- */

      const tableResult=
        await this.sqlite.query({

          database:
            this.dbName,

          statement:
            "SELECT name FROM sqlite_master "+
            "WHERE type = 'table' "+
            "AND name IN (?, ?)",

          values:[
            'app_kv',
            '_sqlite_healthcheck'
          ],

          readonly:false

        });


      const tableNames=
        Array.isArray(
          tableResult?.values
        )
          ?tableResult.values
            .map(r=>
              String(
                r?.name||''
              )
            )
          :[];


      report.details.tables=
        tableNames;


      report.tables=
        tableNames.includes(
          'app_kv'
        ) &&
        tableNames.includes(
          '_sqlite_healthcheck'
        );


      /* -------------------------------
         SCHEMA app_kv
         ------------------------------- */

      const schemaResult=
        await this.sqlite.query({

          database:
            this.dbName,

          statement:
            'PRAGMA table_info(app_kv)',

          values:[],

          readonly:false

        });


      const columns=
        Array.isArray(
          schemaResult?.values
        )
          ?schemaResult.values
            .map(r=>
              String(
                r?.name||''
              )
            )
          :[];


      report.details.columns=
        columns;


      report.schema=
        [
          'key',
          'value',
          'updated_at'
        ].every(
          c=>
            columns.includes(c)
        );


      /* -------------------------------
         ESCRITURA TEMPORAL
         ------------------------------- */

      report.kvWrite=
        (
          await this.setKV(
            token,
            value
          )
        )===true;


      /* -------------------------------
         LECTURA TEMPORAL
         ------------------------------- */

      const readBack=
        await this.getKV(
          token
        );


      report.kvRead=
        readBack===value;


      /* -------------------------------
         BORRADO TEMPORAL
         ------------------------------- */

      const deleted=
        await this.deleteKV(
          token
        );


      const afterDelete=
        await this.getKV(
          token
        );


      report.kvDelete=
        deleted===true &&
        afterDelete===null;


      /* -------------------------------
         DATA VAULT FINGERPRINT
         ------------------------------- */

      const vault=
        await this.vaultIntegrityCheck();


      this.lastVaultIntegrity=
        vault;


      report.vault=
        vault?.ok===true;


      report.details.vaultAlgorithm=
        vault?.algorithm||'—';


      /* -------------------------------
         RESULTADO GLOBAL
         ------------------------------- */

      report.ok=
        report.plugin &&
        report.ready &&
        report.healthcheck &&
        report.tables &&
        report.schema &&
        report.kvWrite &&
        report.kvRead &&
        report.kvDelete &&
        report.vault;


    }catch(e){

      report.ok=false;

      report.details.error=
        String(
          e?.message||e
        );


      console.error(
        'Native Reliability Check:',
        e
      );

    }finally{

      /*
       * Cleanup redundante.
       * Aunque una prueba falle,
       * nunca dejamos la clave temporal.
       */

      try{

        await this.deleteKV(
          token
        );

      }catch{}

    }


    this.lastNativeHealth=
      report;


    return report;
  },


  async healthCheck() {
    const token = 'mlb-' + Date.now();

    try {
      await this.sqlite.run({
        database: this.dbName,
        statement:
          'INSERT INTO _sqlite_healthcheck (token, created_at) VALUES (?, ?)',
        values: [token, new Date().toISOString()],
        transaction: true,
        readonly: false
      });

      const result = await this.sqlite.query({
        database: this.dbName,
        statement:
          'SELECT token FROM _sqlite_healthcheck WHERE token = ? LIMIT 1',
        values: [token],
        readonly: false
      });

      const ok =
        Array.isArray(result?.values) &&
        result.values.some(row => row.token === token);

      await this.sqlite.run({
        database: this.dbName,
        statement:
          'DELETE FROM _sqlite_healthcheck WHERE token = ?',
        values: [token],
        transaction: true,
        readonly: false
      });

      return ok;

    } catch (err) {
      console.error('SQLite healthcheck:', err);
      return false;
    }
  },


  /* V7.8.5A2 SAFE DATA VAULT RESET */

  async deleteKV(key) {

    if(
      !this.sqlite ||
      !this.ready
    ){
      return false;
    }


    await this.sqlite.run({

      database:
        this.dbName,

      statement:
        'DELETE FROM app_kv WHERE key = ?',

      values:
        [key],

      transaction:
        true,

      readonly:
        false

    });


    return true;
  },


  async clearDataVaultSnapshots() {

    if(
      !this.sqlite ||
      !this.ready
    ){
      return false;
    }


    const keys=[

      this.betsSqlKey,

      this.labSqlKey,

      this.censusSqlKey,

      this.bankSqlKey

    ];


    /*
     * Borrado secuencial:
     * si una operación falla,
     * abortamos y NO declaramos
     * el reset como exitoso.
     */

    for(const key of keys){

      const ok=
        await this.deleteKV(key);

      if(!ok){
        return false;
      }
    }


    /*
     * Verificación posterior.
     * No confiamos solamente en
     * que DELETE no arrojó error.
     */

    for(const key of keys){

      const value=
        await this.getKV(key);

      if(value!==null){

        console.error(
          'SQLite reset verification failed:',
          key
        );

        return false;
      }
    }


    this.lastVaultIntegrity=null;


    return true;
  },


  async setKV(key, value) {
    if (!this.ready && !this.sqlite) return false;

    await this.sqlite.run({
      database: this.dbName,
      statement:
        'INSERT OR REPLACE INTO app_kv (key, value, updated_at) VALUES (?, ?, ?)',
      values: [key, String(value), new Date().toISOString()],
      transaction: true,
      readonly: false
    });

    return true;
  },

  async getKV(key) {
    if (!this.sqlite) return null;

    const result = await this.sqlite.query({
      database: this.dbName,
      statement:
        'SELECT value FROM app_kv WHERE key = ? LIMIT 1',
      values: [key],
      readonly: false
    });

    return result?.values?.[0]?.value ?? null;
  },

  async saveCensusSnapshot(data) {
    if (!data || typeof data !== 'object') return false;

    return this.setKV(
      this.censusSqlKey,
      JSON.stringify(data)
    );
  },

  async saveBetsSnapshot(rows) {
    const safe = Array.isArray(rows) ? rows : [];
    return this.setKV(this.betsSqlKey, JSON.stringify(safe));
  },

  async initBetsPersistence() {
    let localRaw = null;

    try {
      localRaw = localStorage.getItem(this.betsStorageKey);
    } catch {}

    if (localRaw !== null) {
      try {
        const local = JSON.parse(localRaw);
        if (Array.isArray(local)) {
          await this.saveBetsSnapshot(local);
          return 'backed-up';
        }
      } catch {}
    }

    try {
      const nativeRaw = await this.getKV(this.betsSqlKey);

      if (nativeRaw !== null) {
        const native = JSON.parse(nativeRaw);

        if (Array.isArray(native)) {
          if (typeof window.saveBets === 'function') {
            window.saveBets(native);
          } else {
            this.safeLocalSet(
              this.betsStorageKey,
              JSON.stringify(native)
            );
          }

          window.renderHistory?.();
          return 'restored';
        }
      }
    } catch (err) {
      console.warn('No se pudieron restaurar Apuestas:', err);
    }

    return 'empty';
  },

  async saveBankSnapshot(data) {
    if (!data || typeof data !== 'object') return false;
    return this.setKV(this.bankSqlKey, JSON.stringify(data));
  },

  async initBankPersistence() {
    let localRaw = null;

    try {
      localRaw = localStorage.getItem(this.bankStorageKey);
    } catch {}

    if (localRaw !== null) {
      try {
        const local = JSON.parse(localRaw);

        if (local && typeof local === 'object') {
          await this.saveBankSnapshot(local);
          return 'backed-up';
        }
      } catch {}
    }

    try {
      const nativeRaw = await this.getKV(this.bankSqlKey);

      if (nativeRaw !== null) {
        const native = JSON.parse(nativeRaw);

        if (native && typeof native === 'object') {
          this.safeLocalSet(
            this.bankStorageKey,
            JSON.stringify(native)
          );

          window.renderBank?.();
          return 'restored';
        }
      }
    } catch (err) {
      console.warn('No se pudo restaurar Bank:', err);
    }

    return 'empty';
  },



  /* V7.8.1C SAFE DATA RECONCILIATION */

  dataTime(row = {}) {

    const values = [
      row.updated,
      row.settled,
      row.savedAt,
      row.created,
      row.date
    ];

    for (const value of values) {

      const t =
        Date.parse(value || '');

      if (Number.isFinite(t)) {
        return t;
      }
    }

    return 0;
  },

  resultRank(row = {}) {

    const s =
      String(
        row.status || ''
      ).toUpperCase();

    if (
      s === 'FINAL' ||
      s === 'WIN' ||
      s === 'LOSS'
    ){
      return 3;
    }

    if (
      s === 'PUSH' ||
      s === 'VOID'
    ){
      return 2;
    }

    if (s === 'PENDING'){
      return 1;
    }

    return 0;
  },

  betMergeKey(row = {}) {

    if (row.id) {
      return String(row.id);
    }

    return [
      row.gamePk ?? '',
      row.date ?? '',
      row.market ?? '',
      row.side ?? '',
      row.line ?? '',
      row.created ?? ''
    ].join('|');
  },

  mergeBetSnapshots(a, b) {

    const map =
      new Map();

    const ingest = rows => {

      for(
        const row
        of Array.isArray(rows)
          ? rows
          : []
      ){

        if(
          !row ||
          typeof row !== 'object'
        ){
          continue;
        }

        const key =
          this.betMergeKey(row);

        const prev =
          map.get(key);

        if(!prev){

          map.set(
            key,
            {...row}
          );

          continue;
        }


        const oldRank =
          this.resultRank(prev);

        const newRank =
          this.resultRank(row);


        const oldTime =
          this.dataTime(prev);

        const newTime =
          this.dataTime(row);


        /*
         * Un WIN/LOSS/PUSH nunca
         * vuelve accidentalmente
         * a PENDING.
         */
        if(
          newRank>oldRank ||
          (
            newRank===oldRank &&
            newTime>=oldTime
          )
        ){

          map.set(
            key,
            {
              ...prev,
              ...row,
              created:
                prev.created ||
                row.created
            }
          );
        }
      }
    };


    ingest(a);
    ingest(b);


    return [...map.values()]
      .sort(
        (x,y)=>
          this.dataTime(x)-
          this.dataTime(y)
      );
  },

  async initBetsReconciled() {

    let local = null;
    let native = null;


    try{

      const raw =
        localStorage.getItem(
          this.betsStorageKey
        );

      if(raw!==null){

        const parsed =
          JSON.parse(raw);

        if(Array.isArray(parsed)){
          local=parsed;
        }
      }

    }catch(e){

      console.warn(
        'Apuestas local inválidas',
        e
      );
    }


    try{

      const raw =
        await this.getKV(
          this.betsSqlKey
        );

      if(raw!==null){

        const parsed =
          JSON.parse(raw);

        if(Array.isArray(parsed)){
          native=parsed;
        }
      }

    }catch(e){

      console.warn(
        'Apuestas SQLite inválidas',
        e
      );
    }


    if(
      local===null &&
      native===null
    ){
      return 'empty';
    }


    const merged =
      this.mergeBetSnapshots(
        local || [],
        native || []
      );


    this.safeLocalSet(
      this.betsStorageKey,
      JSON.stringify(merged)
    );


    await this.saveBetsSnapshot(
      merged
    );


    window.renderHistory?.();


    return(
      local!==null &&
      native!==null
        ?'merged'
        :native!==null
          ?'restored'
          :'backed-up'
    );
  },

  censusRowKey(row = {}) {

    if(row.id){
      return String(row.id);
    }

    return [
      row.date ?? '',
      row.gamePk ?? '',
      row.market ?? 'TOTAL'
    ].join('|');
  },

  mergeCensusRows(a, b) {

    const map =
      new Map();


    const ingest = rows => {

      for(
        const row
        of Array.isArray(rows)
          ?rows
          :[]
      ){

        if(
          !row ||
          typeof row!=='object'
        ){
          continue;
        }

        const key =
          this.censusRowKey(row);

        const prev =
          map.get(key);


        if(!prev){

          map.set(
            key,
            {...row}
          );

          continue;
        }


        const oldRank =
          this.resultRank(prev);

        const newRank =
          this.resultRank(row);


        const oldTime =
          this.dataTime(prev);

        const newTime =
          this.dataTime(row);


        if(
          newRank>oldRank ||
          (
            newRank===oldRank &&
            newTime>=oldTime
          )
        ){

          map.set(
            key,
            {
              ...prev,
              ...row,
              created:
                prev.created ||
                row.created
            }
          );
        }
      }
    };


    ingest(a);
    ingest(b);


    return [...map.values()]
      .sort(
        (x,y)=>
          (
            Number(x.rank || 999) -
            Number(y.rank || 999)
          ) ||
          this.dataTime(x)-
          this.dataTime(y)
      );
  },

  mergeCensusSnapshots(a, b) {

    const A =
      a &&
      typeof a==='object'
        ?a
        :{};

    const B =
      b &&
      typeof b==='object'
        ?b
        :{};


    const out = {
      ...A,
      ...B,
      days:{}
    };


    const dates =
      new Set([
        ...Object.keys(
          A.days || {}
        ),
        ...Object.keys(
          B.days || {}
        )
      ]);


    for(const date of dates){

      const x =
        A.days?.[date] || {};

      const y =
        B.days?.[date] || {};


      const tx =
        this.dataTime(x);

      const ty =
        this.dataTime(y);


      const newer =
        ty>=tx
          ?y
          :x;


      out.days[date] = {
        ...x,
        ...y,
        ...newer,

        date,

        created:
          x.created ||
          y.created ||
          null,

        rows:
          this.mergeCensusRows(
            x.rows || [],
            y.rows || []
          )
      };
    }


    return out;
  },

  async initCensusReconciled() {

    let local = null;
    let native = null;


    try{

      const raw =
        localStorage.getItem(
          this.censusStorageKey
        );

      if(raw){

        const parsed =
          JSON.parse(raw);

        if(
          parsed &&
          typeof parsed==='object'
        ){
          local=parsed;
        }
      }

    }catch(e){

      console.warn(
        'Censo local inválido',
        e
      );
    }


    try{

      const raw =
        await this.getKV(
          this.censusSqlKey
        );

      if(raw){

        const parsed =
          JSON.parse(raw);

        if(
          parsed &&
          typeof parsed==='object'
        ){
          native=parsed;
        }
      }

    }catch(e){

      console.warn(
        'Censo SQLite inválido',
        e
      );
    }


    if(
      local===null &&
      native===null
    ){
      return 'empty';
    }


    const merged =
      this.mergeCensusSnapshots(
        local || {},
        native || {}
      );


    this.safeLocalSet(
      this.censusStorageKey,
      JSON.stringify(merged)
    );


    await this.saveCensusSnapshot(
      merged
    );


    window.renderCensus?.();
    window.renderRanking?.();


    return(
      local!==null &&
      native!==null
        ?'merged'
        :native!==null
          ?'restored'
          :'backed-up'
    );
  },

  bankTime(bank = {}) {

    const t =
      Date.parse(
        bank.updated || ''
      );

    return Number.isFinite(t)
      ?t
      :0;
  },

  bankRichness(bank = {}) {

    const movements =
      Array.isArray(
        bank.movements
      )
        ?bank.movements.length
        :0;

    return movements;
  },

  chooseBankSnapshot(local, native) {

    if(!local){
      return native || null;
    }

    if(!native){
      return local;
    }


    const lt =
      this.bankTime(local);

    const nt =
      this.bankTime(native);


    /*
     * Para Bank usamos el snapshot
     * más reciente completo.
     *
     * Esto respeta también
     * eliminaciones intencionales
     * de movimientos.
     */
    if(lt>nt){
      return local;
    }

    if(nt>lt){
      return native;
    }


    /*
     * Si no hay fecha fiable,
     * preferimos la copia
     * más completa.
     */
    return(
      this.bankRichness(local) >=
      this.bankRichness(native)
        ?local
        :native
    );
  },

  async initBankReconciled() {

    let local = null;
    let native = null;


    try{

      const raw =
        localStorage.getItem(
          this.bankStorageKey
        );

      if(raw!==null){

        const parsed =
          JSON.parse(raw);

        if(
          parsed &&
          typeof parsed==='object'
        ){
          local=parsed;
        }
      }

    }catch(e){

      console.warn(
        'Bank local inválido',
        e
      );
    }


    try{

      const raw =
        await this.getKV(
          this.bankSqlKey
        );

      if(raw!==null){

        const parsed =
          JSON.parse(raw);

        if(
          parsed &&
          typeof parsed==='object'
        ){
          native=parsed;
        }
      }

    }catch(e){

      console.warn(
        'Bank SQLite inválido',
        e
      );
    }


    if(
      local===null &&
      native===null
    ){
      return 'empty';
    }


    const chosen =
      this.chooseBankSnapshot(
        local,
        native
      );


    if(!chosen){
      return 'empty';
    }


    this.safeLocalSet(
      this.bankStorageKey,
      JSON.stringify(chosen)
    );


    await this.saveBankSnapshot(
      chosen
    );


    window.renderBank?.();


    return(
      local!==null &&
      native!==null
        ?'reconciled'
        :native!==null
          ?'restored'
          :'backed-up'
    );
  },


  /* V7.8.1D1 DATA VAULT HEALTH CHECK */

  vaultParse(raw, fallback) {

    if(
      raw===null ||
      raw===undefined
    ){
      return fallback;
    }

    try{
      return JSON.parse(raw);
    }catch{
      return fallback;
    }
  },

  vaultCensusCounts(data) {

    const days=
      data &&
      typeof data==='object' &&
      data.days &&
      typeof data.days==='object'
        ?data.days
        :{};

    let rows=0;

    for(
      const day
      of Object.values(days)
    ){
      rows +=
        Array.isArray(day?.rows)
          ?day.rows.length
          :0;
    }

    return{
      days:Object.keys(days).length,
      rows
    };
  },

  vaultSnapshotStats(
    bets,
    lab,
    census,
    bank
  ){

    const cc=
      this.vaultCensusCounts(
        census
      );

    return{

      bets:
        Array.isArray(bets)
          ?bets.length
          :0,

      lab:
        Array.isArray(lab)
          ?lab.length
          :0,

      censusDays:
        cc.days,

      censusRows:
        cc.rows,

      bankMovements:
        Array.isArray(
          bank?.movements
        )
          ?bank.movements.length
          :0
    };
  },


  /* V7.8.5A1 DATA VAULT FINGERPRINT */

  stableVaultString(value){

    if(value===null){
      return 'null';
    }

    if(Array.isArray(value)){

      return '['+
        value
          .map(v=>
            this.stableVaultString(v)
          )
          .join(',')+
        ']';
    }

    if(
      typeof value==='object'
    ){

      const keys=
        Object.keys(value)
          .sort();

      return '{'+
        keys
          .map(k=>
            JSON.stringify(k)+
            ':'+
            this.stableVaultString(
              value[k]
            )
          )
          .join(',')+
        '}';
    }

    return JSON.stringify(value);
  },


  parseVaultValue(raw){

    if(raw===null){
      return{
        present:false,
        valid:true,
        value:null
      };
    }

    try{

      return{
        present:true,
        valid:true,
        value:JSON.parse(raw)
      };

    }catch(e){

      return{
        present:true,
        valid:false,
        value:String(raw)
      };
    }
  },


  async vaultFingerprint(value){

    const text=
      this.stableVaultString(value);


    try{

      if(
        globalThis.crypto?.subtle &&
        typeof TextEncoder!=='undefined'
      ){

        const bytes=
          new TextEncoder()
            .encode(text);

        const digest=
          await globalThis.crypto
            .subtle
            .digest(
              'SHA-256',
              bytes
            );

        return Array
          .from(
            new Uint8Array(digest)
          )
          .map(x=>
            x.toString(16)
              .padStart(2,'0')
          )
          .join('');
      }

    }catch(e){

      console.warn(
        'SHA-256 no disponible; usando fallback',
        e
      );
    }


    let h1=2166136261;
    let h2=2246822507;

    for(
      let i=0;
      i<text.length;
      i++
    ){

      const c=
        text.charCodeAt(i);

      h1^=c;
      h1=Math.imul(
        h1,
        16777619
      );

      h2^=c;
      h2=Math.imul(
        h2,
        3266489917
      );
    }

    return(
      'fallback-'+
      (h1>>>0)
        .toString(16)
        .padStart(8,'0')+
      (h2>>>0)
        .toString(16)
        .padStart(8,'0')
    );
  },


  async vaultIntegrityCheck(){

    const localRaw={
      bets:null,
      lab:null,
      census:null,
      bank:null
    };


    try{
      localRaw.bets=
        localStorage.getItem(
          this.betsStorageKey
        );
    }catch{}

    try{
      localRaw.lab=
        localStorage.getItem(
          this.labStorageKey
        );
    }catch{}

    try{
      localRaw.census=
        localStorage.getItem(
          this.censusStorageKey
        );
    }catch{}

    try{
      localRaw.bank=
        localStorage.getItem(
          this.bankStorageKey
        );
    }catch{}


    const nativeRaw={
      bets:null,
      lab:null,
      census:null,
      bank:null
    };


    try{

      const values=
        await Promise.all([

          this.getKV(
            this.betsSqlKey
          ),

          this.getKV(
            this.labSqlKey
          ),

          this.getKV(
            this.censusSqlKey
          ),

          this.getKV(
            this.bankSqlKey
          )

        ]);

      nativeRaw.bets=
        values[0];

      nativeRaw.lab=
        values[1];

      nativeRaw.census=
        values[2];

      nativeRaw.bank=
        values[3];

    }catch(e){

      console.error(
        'Data Vault integrity read:',
        e
      );

      return{
        ok:false,
        checkedAt:
          new Date().toISOString(),
        error:
          String(
            e?.message || e
          ),
        details:{}
      };
    }


    const details={};
    let ok=true;


    for(
      const name
      of[
        'bets',
        'lab',
        'census',
        'bank'
      ]
    ){

      const local=
        this.parseVaultValue(
          localRaw[name]
        );

      const native=
        this.parseVaultValue(
          nativeRaw[name]
        );


      const localHash=
        local.present
          ?await this.vaultFingerprint(
              local.value
            )
          :null;

      const nativeHash=
        native.present
          ?await this.vaultFingerprint(
              native.value
            )
          :null;


      let match=false;


      if(
        !local.present &&
        !native.present
      ){

        match=true;

      }else if(
        local.present &&
        native.present &&
        local.valid &&
        native.valid &&
        localHash===nativeHash
      ){

        match=true;
      }


      if(!match){
        ok=false;
      }


      details[name]={

        match,

        localPresent:
          local.present,

        nativePresent:
          native.present,

        localValid:
          local.valid,

        nativeValid:
          native.valid,

        localHash:
          localHash
            ?localHash.slice(0,16)
            :null,

        nativeHash:
          nativeHash
            ?nativeHash.slice(0,16)
            :null

      };
    }


    return{

      ok,

      checkedAt:
        new Date().toISOString(),

      algorithm:
        globalThis.crypto?.subtle
          ?'SHA-256'
          :'FALLBACK',

      details

    };
  },


  async vaultHealth(){

    let localBets=[];
    let localLab=[];
    let localCensus={};
    let localBank={};


    try{

      localBets=
        this.vaultParse(
          localStorage.getItem(
            this.betsStorageKey
          ),
          []
        );

      localLab=
        this.vaultParse(
          localStorage.getItem(
            this.labStorageKey
          ),
          []
        );

      localCensus=
        this.vaultParse(
          localStorage.getItem(
            this.censusStorageKey
          ),
          {}
        );

      localBank=
        this.vaultParse(
          localStorage.getItem(
            this.bankStorageKey
          ),
          {}
        );

    }catch(e){

      console.warn(
        'Vault Health local:',
        e
      );
    }


    let nativeBets=[];
    let nativeLab=[];
    let nativeCensus={};
    let nativeBank={};


    try{

      nativeBets=
        this.vaultParse(
          await this.getKV(
            this.betsSqlKey
          ),
          []
        );

      nativeLab=
        this.vaultParse(
          await this.getKV(
            this.labSqlKey
          ),
          []
        );

      nativeCensus=
        this.vaultParse(
          await this.getKV(
            this.censusSqlKey
          ),
          {}
        );

      nativeBank=
        this.vaultParse(
          await this.getKV(
            this.bankSqlKey
          ),
          {}
        );

    }catch(e){

      console.warn(
        'Vault Health SQLite:',
        e
      );
    }


    const local=
      this.vaultSnapshotStats(
        localBets,
        localLab,
        localCensus,
        localBank
      );


    const native=
      this.vaultSnapshotStats(
        nativeBets,
        nativeLab,
        nativeCensus,
        nativeBank
      );


    const fields=[
      'bets',
      'lab',
      'censusDays',
      'censusRows',
      'bankMovements'
    ];


    const differences=
      fields.filter(
        key=>
          local[key] !==
          native[key]
      );


    return{

      ok:
        this.ready===true &&
        differences.length===0,

      sqliteReady:
        this.ready===true,

      checkedAt:
        new Date().toISOString(),

      local,

      native,

      differences
    };
  },

  /* V7.8.1A LAB DATA VAULT */

  labRowKey(row = {}) {

    if (row.id) {
      return String(row.id);
    }

    return [
      row.gamePk ?? '',
      String(row.market || '').toUpperCase(),
      String(row.side || '').toUpperCase(),
      Number.isFinite(Number(row.line))
        ? Number(row.line).toFixed(2)
        : String(row.line ?? '')
    ].join('|');
  },

  labStatusRank(row = {}) {

    const st =
      String(row.status || '').toUpperCase();

    if (st === 'FINAL') return 3;
    if (st === 'PUSH') return 2;
    if (st === 'PENDING') return 1;

    return 0;
  },

  labRowTime(row = {}) {

    const candidates = [
      row.updated,
      row.settled,
      row.created
    ];

    for (const value of candidates) {

      const t = Date.parse(value || '');

      if (Number.isFinite(t)) {
        return t;
      }
    }

    return 0;
  },

  mergeLabSnapshots(a, b) {

    const map = new Map();

    const ingest = rows => {

      for (
        const row
        of Array.isArray(rows) ? rows : []
      ) {

        if (
          !row ||
          typeof row !== 'object'
        ) {
          continue;
        }

        const key =
          this.labRowKey(row);

        if (!key) continue;

        const prev =
          map.get(key);

        if (!prev) {

          map.set(
            key,
            { ...row }
          );

          continue;
        }


        const oldRank =
          this.labStatusRank(prev);

        const newRank =
          this.labStatusRank(row);


        const oldTime =
          this.labRowTime(prev);

        const newTime =
          this.labRowTime(row);


        /*
         * Nunca degradamos un resultado
         * ya liquidado a PENDING.
         *
         * Si tienen el mismo estado,
         * conservamos el snapshot
         * más reciente.
         */

        if (
          newRank > oldRank ||
          (
            newRank === oldRank &&
            newTime >= oldTime
          )
        ) {

          map.set(
            key,
            {
              ...prev,
              ...row,
              created:
                prev.created ||
                row.created
            }
          );
        }

      }

    };


    ingest(a);
    ingest(b);


    return [...map.values()]
      .sort(
        (x, y) =>
          this.labRowTime(x) -
          this.labRowTime(y)
      );
  },

  async saveLabSnapshot(rows) {

    const safe =
      Array.isArray(rows)
        ? rows
        : [];

    return this.setKV(
      this.labSqlKey,
      JSON.stringify(safe)
    );
  },

  async initLabPersistence() {

    let local = null;
    let native = null;


    /*
     * Copia web actual
     */
    try {

      const raw =
        localStorage.getItem(
          this.labStorageKey
        );

      if (raw !== null) {

        const parsed =
          JSON.parse(raw);

        if (Array.isArray(parsed)) {
          local = parsed;
        }
      }

    } catch (err) {

      console.warn(
        'LAB localStorage inválido:',
        err
      );
    }


    /*
     * Copia SQLite
     */
    try {

      const raw =
        await this.getKV(
          this.labSqlKey
        );

      if (raw !== null) {

        const parsed =
          JSON.parse(raw);

        if (Array.isArray(parsed)) {
          native = parsed;
        }
      }

    } catch (err) {

      console.warn(
        'LAB SQLite inválido:',
        err
      );
    }


    /*
     * Ambas copias existen:
     * fusionamos en vez de
     * sobrescribir a ciegas.
     */
    if (
      Array.isArray(local) &&
      Array.isArray(native)
    ) {

      const merged =
        this.mergeLabSnapshots(
          local,
          native
        );

      this.safeLocalSet(
        this.labStorageKey,
        JSON.stringify(merged)
      );

      await this.saveLabSnapshot(
        merged
      );


      window.renderLab?.();
      window.renderTeams?.();


      return 'merged';
    }


    /*
     * Sólo existe local:
     * crear respaldo SQLite.
     */
    if (Array.isArray(local)) {

      await this.saveLabSnapshot(
        local
      );

      return 'backed-up';
    }


    /*
     * Sólo existe SQLite:
     * restaurar copia web.
     */
    if (Array.isArray(native)) {

      this.safeLocalSet(
        this.labStorageKey,
        JSON.stringify(native)
      );

      window.renderLab?.();
      window.renderTeams?.();

      return 'restored';
    }


    /*
     * No existe historial todavía.
     */
    await this.saveLabSnapshot([]);

    return 'empty';
  },

  validCensus(data) {
    return !!(
      data &&
      typeof data === 'object' &&
      data.days &&
      typeof data.days === 'object' &&
      Object.keys(data.days).length
    );
  },

  async initCensusPersistence() {
    let local = null;

    try {
      const raw = localStorage.getItem(this.censusStorageKey);
      if (raw) local = JSON.parse(raw);
    } catch {}

    let native = null;

    try {
      const raw = await this.getKV(this.censusSqlKey);
      if (raw) native = JSON.parse(raw);
    } catch {}

    if (this.validCensus(local)) {
      await this.saveCensusSnapshot(local);
      return 'backed-up';
    }

    if (this.validCensus(native)) {
      try {
        if (typeof window.saveRankCensus === 'function') {
          window.saveRankCensus(native);
        } else {
          this.safeLocalSet(
            this.censusStorageKey,
            JSON.stringify(native)
          );
        }

        window.renderCensus?.();
        window.renderRanking?.();

        return 'restored';
      } catch (err) {
        console.warn('No se pudo restaurar Censo:', err);
      }
    }

    return 'empty';
  }
};

window.MLBDB = MLBDB;


/* =========================================================
 V7.8.6 DATA VAULT SYNC GUARD V2
 Deferred reconciliation · never writes during SQLite init
========================================================= */
(function(){
'use strict';

const db=window.MLBDB;
if(!db || db.__vaultSyncGuardV2Installed===true) return;

db.__vaultSyncGuardV2Installed=true;
db.__vaultSyncV2InFlight=null;
db.__vaultSyncV2Timer=null;

db.vaultSyncV2ReadLocal=function(){
  const out={};

  const specs=[
    {
      name:'bets',
      localKey:this.betsStorageKey,
      sqlKey:this.betsSqlKey,
      valid:v=>Array.isArray(v)
    },
    {
      name:'lab',
      localKey:this.labStorageKey,
      sqlKey:this.labSqlKey,
      valid:v=>Array.isArray(v)
    },
    {
      name:'census',
      localKey:this.censusStorageKey,
      sqlKey:this.censusSqlKey,
      valid:v=>
        v &&
        typeof v==='object' &&
        !Array.isArray(v) &&
        v.days &&
        typeof v.days==='object'
    },
    {
      name:'bank',
      localKey:this.bankStorageKey,
      sqlKey:this.bankSqlKey,
      valid:v=>
        v &&
        typeof v==='object' &&
        !Array.isArray(v)
    }
  ];

  for(const spec of specs){
    try{
      const raw=localStorage.getItem(spec.localKey);

      if(raw===null){
        out[spec.name]={
          ...spec,
          present:false,
          valid:true,
          raw:null
        };
        continue;
      }

      let parsed;
      try{
        parsed=JSON.parse(raw);
      }catch{
        out[spec.name]={
          ...spec,
          present:true,
          valid:false,
          raw
        };
        continue;
      }

      out[spec.name]={
        ...spec,
        present:true,
        valid:!!spec.valid(parsed),
        raw,
        parsed
      };
    }catch(e){
      out[spec.name]={
        ...spec,
        present:false,
        valid:false,
        raw:null,
        error:String(e?.message||e)
      };
    }
  }

  return out;
};

db.vaultDeferredReconcile=async function(reason='deferred'){
  if(this.__vaultSyncV2InFlight){
    return this.__vaultSyncV2InFlight;
  }

  this.__vaultSyncV2InFlight=(async()=>{
    const report={
      ok:false,
      reason,
      startedAt:new Date().toISOString(),
      changed:[],
      unchanged:[],
      skipped:[],
      errors:[]
    };

    if(
      !this.sqlite ||
      this.ready!==true
    ){
      report.errors.push('SQLite no listo');
      return report;
    }

    /*
     * Nunca escribimos durante init.
     * Dejamos que las reconciliaciones nativas terminen primero.
     */
    await new Promise(r=>setTimeout(r,350));

    let first;
    try{
      first=await this.vaultIntegrityCheck();
    }catch(e){
      report.errors.push(
        'fingerprint-1:'+String(e?.message||e)
      );
    }

    if(first?.ok===true){
      report.ok=true;
      report.state='already-synced';
      this.lastVaultSyncV2=report;
      return report;
    }

    /*
     * Segundo intento pasivo: cubre escrituras async recién terminadas.
     */
    await new Promise(r=>setTimeout(r,350));

    let second;
    try{
      second=await this.vaultIntegrityCheck();
    }catch(e){
      report.errors.push(
        'fingerprint-2:'+String(e?.message||e)
      );
    }

    if(second?.ok===true){
      report.ok=true;
      report.state='settled-without-write';
      this.lastVaultSyncV2=report;
      return report;
    }

    const local=this.vaultSyncV2ReadLocal();

    const names=[
      'bets',
      'lab',
      'census',
      'bank'
    ];

    for(const name of names){
      const item=local[name];

      if(
        !item ||
        !item.present
      ){
        report.skipped.push(
          name+':local-empty'
        );
        continue;
      }

      if(!item.valid){
        report.skipped.push(
          name+':local-invalid'
        );
        continue;
      }

      try{
        const nativeRaw=
          await this.getKV(
            item.sqlKey
          );

        if(nativeRaw===item.raw){
          report.unchanged.push(name);
          continue;
        }

        /*
         * En este punto init ya fusionó/restauró ambas copias.
         * LocalStorage representa el estado activo de la app.
         */
        await this.setKV(
          item.sqlKey,
          item.raw
        );

        const verify=
          await this.getKV(
            item.sqlKey
          );

        if(verify!==item.raw){
          throw new Error(
            'readback mismatch'
          );
        }

        report.changed.push(name);

      }catch(e){
        report.errors.push(
          name+':'+
          String(e?.message||e)
        );
      }
    }

    await new Promise(r=>setTimeout(r,120));

    let finalCheck;
    try{
      finalCheck=
        await this.vaultIntegrityCheck();
    }catch(e){
      report.errors.push(
        'fingerprint-final:'+
        String(e?.message||e)
      );
    }

    report.ok=
      finalCheck?.ok===true &&
      report.errors.length===0;

    report.state=
      report.ok
        ?'reconciled'
        :'mismatch-persists';

    report.finishedAt=
      new Date().toISOString();

    report.finalCheck=
      finalCheck || null;

    this.lastVaultSyncV2=report;

    /*
     * El badge distingue salud SQLite de sincronía del Vault.
     */
    if(report.ok){
      try{
        const health=
          await this.vaultHealth();

        if(health?.ok===true){
          this.showStatus(
            'SQLite OK · Data Vault protegido',
            true
          );
        }else{
          this.showStatus(
            'SQLite OK · Vault pendiente',
            true
          );
        }
      }catch{
        this.showStatus(
          'SQLite OK',
          true
        );
      }
    }else{
      console.warn(
        'Data Vault Sync Guard V2:',
        report
      );

      this.showStatus(
        'SQLite OK · Vault requiere revisión',
        false
      );
    }

    return report;
  })();

  try{
    return await this.__vaultSyncV2InFlight;
  }finally{
    this.__vaultSyncV2InFlight=null;
  }
};

/*
 * Envolvemos init, pero NO alteramos su lógica.
 * La reparación empieza sólo DESPUÉS de que init terminó con éxito.
 */
const originalInit=
  db.init.bind(db);

db.init=async function(){
  const ok=
    await originalInit();

  if(ok!==true){
    return ok;
  }

  clearTimeout(
    this.__vaultSyncV2Timer
  );

  this.__vaultSyncV2Timer=
    setTimeout(()=>{
      this.vaultDeferredReconcile(
        'post-init'
      ).catch(e=>
        console.warn(
          'Vault post-init:',
          e
        )
      );
    },900);

  return true;
};

/*
 * Guardia ligera en runtime:
 * sólo compara/repara si la app está visible.
 * No ejecuta escrituras si ambas copias ya coinciden.
 */
db.__vaultSyncV2Interval=
  setInterval(()=>{
    if(
      document.visibilityState==='visible' &&
      db.ready===true
    ){
      db.vaultDeferredReconcile(
        'runtime'
      ).catch(()=>{});
    }
  },15000);

document.addEventListener(
  'visibilitychange',
  ()=>{
    if(
      document.visibilityState==='visible' &&
      db.ready===true
    ){
      setTimeout(()=>{
        db.vaultDeferredReconcile(
          'resume'
        ).catch(()=>{});
      },700);
    }
  }
);

console.info(
  'V7.8.6 Data Vault Sync Guard V2 activo'
);

})();

