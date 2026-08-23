const MLBDB = {
  dbName: 'mlb_totals_lab',
  sqlite: null,
  ready: false,

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

      if (!sqlite) {
        throw new Error('CapacitorSQLite no disponible');
      }

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
          CREATE TABLE IF NOT EXISTS census (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            game_id TEXT,
            date TEXT,
            away_team TEXT,
            home_team TEXT,
            line REAL,
            pick TEXT,
            probability REAL,
            status TEXT,
            result TEXT,
            created_at TEXT
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

      const token = 'mlb-' + Date.now();

      await sqlite.run({
        database: this.dbName,
        statement:
          'INSERT INTO _sqlite_healthcheck (token, created_at) VALUES (?, ?)',
        values: [token, new Date().toISOString()],
        transaction: true,
        readonly: false
      });

      const result = await sqlite.query({
        database: this.dbName,
        statement:
          'SELECT token FROM _sqlite_healthcheck WHERE token = ? LIMIT 1',
        values: [token],
        readonly: false
      });

      const ok =
        Array.isArray(result?.values) &&
        result.values.some(row => row.token === token);

      await sqlite.run({
        database: this.dbName,
        statement:
          'DELETE FROM _sqlite_healthcheck WHERE token = ?',
        values: [token],
        transaction: true,
        readonly: false
      });

      this.ready = ok;
      this.showStatus(ok ? 'SQLite OK' : 'SQLite ERROR', ok);

      return ok;

    } catch (err) {
      console.error('SQLite error:', err);
      this.ready = false;
      this.showStatus('SQLite ERROR', false);
      return false;
    }
  }
};

window.MLBDB = MLBDB;
