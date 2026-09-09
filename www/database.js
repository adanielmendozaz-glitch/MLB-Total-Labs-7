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

  async init() {
    try {
      const sqlite = window.Capacitor?.Plugins?.CapacitorSQLite;

      if (!sqlite) throw new Error('CapacitorSQLite no disponible');

      this.sqlite = sqlite;

      try {
        await sqlite.createConnection({
          database: this.dbName,
          encrypted: false,
          mode: 'no-encryption',
          version: 1,
          readonly: false
        });
      } catch (err) {
        const msg = String(err?.message || err || '');

        if (!/already exists|connection .* exists/i.test(msg)) {
          throw err;
        }
      }

      await sqlite.open({
        database: this.dbName,
        readonly: false
      });

      await sqlite.execute({
        database: this.dbName,
        statements: `
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
        transaction: true,
        readonly: false
      });

      const ok = await this.healthCheck();

      if (!ok) throw new Error('SQLite healthcheck falló');

      this.ready = true;

      const censusMode = await this.initCensusReconciled();
      const betsMode = await this.initBetsReconciled();
      const bankMode = await this.initBankReconciled();
      const labMode = await this.initLabPersistence();
      const vaultHealth = await this.vaultHealth();

      const vaultIntegrity =
        await this.vaultIntegrityCheck();

      this.lastVaultIntegrity =
        vaultIntegrity;


      const nativeHealth =
        await this.nativeReliabilityCheck();


      this.lastNativeHealth =
        nativeHealth;


      if (
        vaultHealth.ok &&
        vaultIntegrity.ok &&
        nativeHealth.ok
      ) {

        this.showStatus(
          'SQLite OK · Data Vault protegido',
          true
        );

      } else if (
        vaultHealth.ok &&
        !vaultIntegrity.ok
      ) {

        console.warn(
          'Data Vault fingerprint mismatch:',
          vaultIntegrity
        );

        this.showStatus(
          'SQLite ALERTA · Vault desincronizado',
          false
        );

      } else if (censusMode === 'restored') {
        this.showStatus('SQLite OK · Censo restaurado', true);
      } else if (censusMode === 'backed-up') {
        this.showStatus('SQLite OK · Censo protegido', true);
      } else {
        this.showStatus('SQLite OK', true);
      }

      return true;

    } catch (err) {
      console.error('SQLite error:', err);
      this.ready = false;
      this.showStatus('SQLite ERROR', false);
      return false;
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
            localStorage.setItem(
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
          localStorage.setItem(
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


    localStorage.setItem(
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


    localStorage.setItem(
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


    localStorage.setItem(
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

      localStorage.setItem(
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

      localStorage.setItem(
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
          localStorage.setItem(
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

/* V7.8.6H1 HISTORY RESCUE OVERLAY
 * Alcance deliberadamente limitado:
 * - import/export de historial
 * - TEAM SHADOW dentro del Data Vault
 * - commit durable + verificacion SQLite
 * No modifica motores, probabilidades, pesos, filtros ni picks.
 */
(function(){
  'use strict';

  const RESCUE_VERSION='V7.8.6H1';
  const SHADOW_STORE_KEY='mlb_v786_team_shadow_lab';
  const SHADOW_SQL_KEY='team_shadow_v1';

  function rescueSleep(ms){
    return new Promise(resolve=>setTimeout(resolve,ms));
  }

  function rescueCensusRows(data){
    return Object.values(data?.days||{})
      .reduce((sum,day)=>sum+(Array.isArray(day?.rows)?day.rows.length:0),0);
  }

  function rescueShadowState(){
    try{
      const raw=STORE.getItem(SHADOW_STORE_KEY);
      const parsed=raw?JSON.parse(raw):null;
      if(typeof teamShadowNormalizeState==='function'){
        return teamShadowNormalizeState(parsed||{});
      }
      const now=new Date().toISOString();
      return {
        version:'V7.8.6_TEAM_SHADOW_1',
        schema:1,
        createdAt:parsed?.createdAt||now,
        updatedAt:parsed?.updatedAt||now,
        rows:Array.isArray(parsed?.rows)?parsed.rows:[]
      };
    }catch{
      const now=new Date().toISOString();
      return {version:'V7.8.6_TEAM_SHADOW_1',schema:1,createdAt:now,updatedAt:now,rows:[]};
    }
  }

  function rescueCounts(){
    const census=rankCensus();
    const shadow=rescueShadowState();
    const bank=bankCfg();
    const drafts=rankDraftStore();
    const mkts=markets();
    return {
      bets:bets().length,
      lab:lab().length,
      teamShadow:Array.isArray(shadow.rows)?shadow.rows.length:0,
      censusDays:Object.keys(census?.days||{}).length,
      censusRows:rescueCensusRows(census),
      bankMovements:Array.isArray(bank?.movements)?bank.movements.length:0,
      rankDraftDays:Object.keys(drafts||{}).length,
      markets:mkts&&typeof mkts==='object'?Object.keys(mkts).length:0
    };
  }

  async function rescueWaitForDatabase(timeout=12000){
    const nativeCapable=!!window.Capacitor?.Plugins?.CapacitorSQLite;
    if(!nativeCapable){
      return {native:false,ready:false};
    }
    const start=Date.now();
    while(!window.MLBDB?.ready && Date.now()-start<timeout){
      await rescueSleep(100);
    }
    if(!window.MLBDB?.ready){
      throw new Error('SQLite Data Vault no termino de iniciar. Cierra y abre la app e intenta importar de nuevo.');
    }
    return {native:true,ready:true};
  }

  function rescueBetKey(row={}){
    if(row.id) return 'ID|'+String(row.id);
    return [
      row.gamePk??'',row.date??'',row.market??'',row.side??'',row.line??'',row.created??''
    ].join('|');
  }

  function rescueMergeBets(incoming=[]){
    const current=Array.isArray(bets())?bets():[];
    const imported=(Array.isArray(incoming)?incoming:[]).map((raw,i)=>{
      try{
        const normalized=normalizeBetRow(raw,i,'SAFE IMPORT');
        return {...raw,...normalized,id:String(raw?.id??normalized.id),created:raw?.created||normalized.created};
      }catch{
        return {...raw};
      }
    });

    const map=new Map(current.map(r=>[rescueBetKey(r),r]));
    let added=0,updated=0,conflicts=0;

    for(const row of imported){
      if(!row||typeof row!=='object') continue;
      const key=rescueBetKey(row);
      const old=map.get(key);
      if(!old){
        map.set(key,row);
        added++;
        continue;
      }
      const statusRank=r=>{
        const s=String(r?.status||'').toUpperCase();
        if(['WIN','LOSS','FINAL'].includes(s)) return 3;
        if(['PUSH','VOID'].includes(s)) return 2;
        if(s==='PENDING') return 1;
        return 0;
      };
      const aStatus=String(old?.status||'').toUpperCase();
      const bStatus=String(row?.status||'').toUpperCase();
      const aSettled=['WIN','LOSS','PUSH','VOID'].includes(aStatus);
      const bSettled=['WIN','LOSS','PUSH','VOID'].includes(bStatus);
      if(aSettled&&bSettled&&aStatus!==bStatus&&!(aStatus==='PUSH'&&bStatus==='VOID')&&!(aStatus==='VOID'&&bStatus==='PUSH')){
        conflicts++;
        map.set(key,{...row,...old,id:old.id||row.id,created:old.created||row.created});
        continue;
      }
      const oldRank=statusRank(old),newRank=statusRank(row);
      const oldTime=Date.parse(old?.settled||old?.updated||old?.created||'')||0;
      const newTime=Date.parse(row?.settled||row?.updated||row?.created||'')||0;
      const oldComplete=Object.values(old||{}).filter(v=>v!==null&&v!==undefined&&v!=='').length;
      const newComplete=Object.values(row||{}).filter(v=>v!==null&&v!==undefined&&v!=='').length;
      const incomingWins=newRank>oldRank||(newRank===oldRank&&(newTime>oldTime||(newTime===oldTime&&newComplete>oldComplete)));
      const winner=incomingWins?row:old;
      const loser=incomingWins?old:row;
      if(incomingWins) updated++;
      map.set(key,{...loser,...winner,id:old.id||row.id,created:old.created||row.created});
    }

    const merged=[...map.values()].sort((a,b)=>{
      const at=Date.parse(a?.created||a?.settled||'')||0;
      const bt=Date.parse(b?.created||b?.settled||'')||0;
      return at-bt;
    });
    saveBets(merged);
    return {before:current.length,imported:imported.length,after:merged.length,added,updated,conflicts};
  }

  function rescueMergeShadow(incoming){
    const current=rescueShadowState();
    const imported=(incoming&&typeof incoming==='object')
      ?(typeof teamShadowNormalizeState==='function'?teamShadowNormalizeState(incoming):incoming)
      :{rows:[]};
    const incomingRows=Array.isArray(imported?.rows)?imported.rows:[];
    const currentRows=Array.isArray(current?.rows)?current.rows:[];
    const currentKeys=new Set(currentRows.map(r=>
      typeof teamShadowRowKey==='function'?teamShadowRowKey(r):String(r?.id||'')
    ));
    const mergedRows=typeof teamShadowMergeRows==='function'
      ?teamShadowMergeRows(currentRows,incomingRows)
      :[...currentRows,...incomingRows];
    const now=new Date().toISOString();
    const merged={
      ...imported,
      ...current,
      version:current.version||imported.version||'V7.8.6_TEAM_SHADOW_1',
      schema:1,
      createdAt:current.createdAt||imported.createdAt||now,
      updatedAt:now,
      rows:mergedRows
    };
    STORE.setItem(SHADOW_STORE_KEY,JSON.stringify(merged));
    let added=0;
    for(const r of incomingRows){
      const k=typeof teamShadowRowKey==='function'?teamShadowRowKey(r):String(r?.id||'');
      if(!currentKeys.has(k)) added++;
    }
    return {before:currentRows.length,imported:incomingRows.length,after:mergedRows.length,added};
  }

  async function rescueDurableCommit(){
    const dbState=await rescueWaitForDatabase();
    if(!dbState.native){
      return {native:false,verified:false,reason:'browser-local-only'};
    }

    const makeWanted=()=>{
      const b=bets();
      const l=lab();
      const c=rankCensus();
      const bk=bankCfg();
      const sh=rescueShadowState();
      return {
        bets:JSON.stringify(b),
        lab:JSON.stringify(l),
        census:JSON.stringify(c),
        bank:JSON.stringify(bk),
        shadow:JSON.stringify(sh)
      };
    };

    let lastMismatch=[];

    /* Varias pasadas impiden que una escritura asincrona antigua termine despues
       y vuelva a dejar SQLite con una foto anterior. */
    for(let attempt=1;attempt<=3;attempt++){
      const wanted=makeWanted();

      await window.MLBDB.saveBetsSnapshot(JSON.parse(wanted.bets));
      await window.MLBDB.saveLabSnapshot(JSON.parse(wanted.lab));
      await window.MLBDB.saveCensusSnapshot(JSON.parse(wanted.census));
      await window.MLBDB.saveBankSnapshot(JSON.parse(wanted.bank));
      await window.MLBDB.setKV(SHADOW_SQL_KEY,wanted.shadow);

      await rescueSleep(180);

      const got={
        bets:await window.MLBDB.getKV(window.MLBDB.betsSqlKey||'bets_v1'),
        lab:await window.MLBDB.getKV(window.MLBDB.labSqlKey||'lab_v1'),
        census:await window.MLBDB.getKV(window.MLBDB.censusSqlKey||'rank_census_v1'),
        bank:await window.MLBDB.getKV(window.MLBDB.bankSqlKey||'bank_v1'),
        shadow:await window.MLBDB.getKV(SHADOW_SQL_KEY)
      };

      lastMismatch=Object.keys(wanted).filter(k=>got[k]!==wanted[k]);
      if(!lastMismatch.length){
        return {native:true,verified:true,attempt};
      }
      await rescueSleep(220);
    }

    throw new Error('SQLite no confirmo el historial completo: '+lastMismatch.join(', '));
  }

  function rescueIncomingCounts(x={}){
    const census=x?.rankCensus&&typeof x.rankCensus==='object'?x.rankCensus:null;
    const shadow=x?.teamShadow&&typeof x.teamShadow==='object'?x.teamShadow:null;
    return {
      bets:Array.isArray(x?.bets)?x.bets.length:0,
      lab:Array.isArray(x?.lab)?x.lab.length:0,
      teamShadow:Array.isArray(shadow?.rows)?shadow.rows.length:0,
      censusRows:census?rescueCensusRows(census):0
    };
  }

  function rescueAssertImported(before,after,incoming){
    const checks=[
      ['bets',incoming.bets],
      ['lab',incoming.lab],
      ['teamShadow',incoming.teamShadow],
      ['censusRows',incoming.censusRows]
    ];
    const failed=[];
    for(const [key,min] of checks){
      if(min>0 && Number(after[key]||0)<min){
        failed.push(`${key} ${after[key]||0}/${min}`);
      }
      if(Number(after[key]||0)<Number(before[key]||0)){
        failed.push(`${key} retrocedio ${before[key]}→${after[key]}`);
      }
    }
    if(failed.length){
      throw new Error('Verificacion de migracion incompleta: '+failed.join(' · '));
    }
  }

  async function rescueExportJson(){
    try{
      await rescueDurableCommit();
    }catch(e){
      console.warn('History Rescue durable pre-export',e);
    }

    const betsData=bets();
    const labData=lab();
    const censusData=rankCensus();
    const draftsData=rankDraftStore();
    const bankData=bankCfg();
    const marketsData=markets();
    const cfgData=cfg();
    const shadowData=rescueShadowState();
    let vaultHealth=null;
    try{ vaultHealth=await window.MLBDB?.vaultHealth?.(); }catch{}

    const counts=rescueCounts();
    const payload={
      dataVault:{
        schema:2,
        appVersion:RESCUE_VERSION,
        modelVersion:typeof MODEL_VERSION!=='undefined'?MODEL_VERSION:'UNKNOWN',
        createdAt:new Date().toISOString(),
        health:vaultHealth,
        counts
      },
      bets:betsData,
      lab:labData,
      teamShadow:shadowData,
      cfg:cfgData,
      markets:marketsData,
      rankCensus:censusData,
      rankDrafts:draftsData,
      bank:bankData
    };

    const stamp=localDay().replace(/-/g,'');
    const ok=await download(
      'mlb_v786_history_rescue_'+stamp+'.json',
      JSON.stringify(payload,null,2),
      'application/json'
    );
    if(ok!==false){
      status(`Data Vault completo · ${counts.bets} apuestas · ${counts.lab} LAB · ${counts.censusRows} Censo · ${counts.teamShadow} Shadow.`,'ok');
    }
    return ok;
  }

  function rescueImportJson(file){
    const reader=new FileReader();

    reader.onload=async()=>{
      try{
        /* En Android no tocamos nada hasta que SQLite este listo. */
        await rescueWaitForDatabase();

        const parsed=JSON.parse(reader.result);
        const x=(parsed?.payload&&typeof parsed.payload==='object')?parsed.payload:parsed;
        const before=rescueCounts();
        const incoming=Array.isArray(x)?{bets:x.length,lab:0,teamShadow:0,censusRows:0}:rescueIncomingCounts(x);

        const preImport=await rollingBackupCreate('PRE_IMPORT',true);
        if(!preImport) throw new Error('No se pudo crear PRE_IMPORT');

        const report={
          version:RESCUE_VERSION,
          at:new Date().toISOString(),
          preImportId:preImport.id,
          bets:null,lab:null,teamShadow:null,census:null,markets:null,bank:null,rankDrafts:null,cfg:false,
          conflicts:0,
          durable:null,
          before,
          incoming,
          after:null
        };

        if(Array.isArray(x)){
          report.bets=rescueMergeBets(x);
        }else{
          if(Array.isArray(x?.bets)){
            report.bets=rescueMergeBets(x.bets);
            report.conflicts+=report.bets.conflicts||0;
          }

          if(Array.isArray(x?.lab)){
            report.lab=safeImportMergeLab(x.lab);
            report.conflicts+=report.lab.conflicts||0;
          }

          if(x?.teamShadow&&typeof x.teamShadow==='object'){
            report.teamShadow=rescueMergeShadow(x.teamShadow);
          }

          if(x?.rankCensus&&typeof x.rankCensus==='object'){
            report.census=safeImportMergeCensus(x.rankCensus);
            report.conflicts+=report.census.conflicts||0;
          }else if(x?.rankTracker&&typeof x.rankTracker==='object'){
            saveLegacyRankArchive(x.rankTracker);
            migrateRankingToCensus();
          }

          if(x?.markets&&typeof x.markets==='object') report.markets=safeImportMergeMarkets(x.markets);
          if(x?.rankDrafts&&typeof x.rankDrafts==='object') report.rankDrafts=safeImportMergeRankDrafts(x.rankDrafts);
          if(x?.bank&&typeof x.bank==='object') report.bank=safeImportMergeBank(x.bank);

          if(x?.cfg&&typeof x.cfg==='object'){
            const mergedCfg=safeImportFillMissing(cfg(),x.cfg);
            STORE.setItem('mlb_v5_cfg',JSON.stringify(mergedCfg));
            report.cfg=true;
          }
        }

        loadCfg();
        repairLabHistory();

        /* Espera corta para vaciar escrituras lanzadas por las funciones heredadas,
           luego el Rescue hace su propio commit canonico y lo lee de vuelta. */
        await rescueSleep(350);
        report.durable=await rescueDurableCommit();
        report.after=rescueCounts();
        rescueAssertImported(before,report.after,incoming);

        window.MLBHistoryRescueReport=report;
        S.safeImportReport=report;

        renderHistory();
        renderBank();
        renderLab();
        renderUnifiedSettlementStatus();
        renderTeams();
        renderCensus();
        renderRanking();
        renderRollingBackupDashboard();
        try{ renderShadowIntegrity(); renderShadowLab(); }catch{}

        const a=report.after;
        status(
          `Historial restaurado y verificado · ${a.bets} apuestas · ${a.lab} LAB · ${a.censusRows} Censo · ${a.teamShadow} Shadow · SQLite ${report.durable?.verified?'OK':'local'}.`,
          report.conflicts?'err':'ok'
        );

      }catch(e){
        console.error('History Rescue Import:',e);
        alert('Importacion cancelada: '+(e?.message||e));
      }finally{
        try{ document.getElementById('importJson').value=''; }catch{}
      }
    };

    reader.readAsText(file);
  }

  window.importJson=rescueImportJson;
  window.exportJson=rescueExportJson;
  window.MLBHistoryRescue={version:RESCUE_VERSION,counts:rescueCounts,durableCommit:rescueDurableCommit};

  const importInput=document.getElementById('importJson');
  if(importInput){
    importInput.onchange=e=>e.target.files?.[0]&&rescueImportJson(e.target.files[0]);
  }

  const exportButton=document.getElementById('exportJson');
  if(exportButton){
    exportButton.onclick=rescueExportJson;
    exportButton.textContent='Backup Data Vault';
  }

  console.info(RESCUE_VERSION,'History Rescue activo');
})();
