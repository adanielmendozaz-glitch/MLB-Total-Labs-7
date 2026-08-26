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

      if (vaultHealth.ok) {
        this.showStatus(
          'SQLite OK · Data Vault protegido',
          true
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
