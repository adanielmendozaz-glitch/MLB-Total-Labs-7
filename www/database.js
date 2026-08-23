const MLBDB = {
  dbName: 'mlb_totals_lab',
  db: null,

  async init() {
    try {
      const sqlite = window.Capacitor?.Plugins?.CapacitorSQLite;

      if (!sqlite) {
        console.warn('SQLite nativo no disponible');
        return false;
      }

      await sqlite.createConnection({
        database: this.dbName,
        encrypted: false,
        mode: 'no-encryption',
        version: 1,
        readonly: false
      });

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
        `,
        transaction: true,
        readonly: false
      });

      console.log('MLB SQLite listo');
      return true;

    } catch (err) {
      console.error('Error iniciando SQLite:', err);
      return false;
    }
  }
};

window.MLBDB = MLBDB;
