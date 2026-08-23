const MLBDB = {
  dbName: 'mlb_totals_lab',
  sqlite: null,
  ready: false,
  censusStorageKey: 'mlb_v60_rank_census',
  censusSqlKey: 'rank_census_v1',

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

      const censusMode = await this.initCensusPersistence();

      if (censusMode === 'restored') {
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
