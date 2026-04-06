import { Database } from "bun:sqlite";

export function initSchema(db: Database): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      condition_id TEXT NOT NULL,
      city TEXT NOT NULL,
      date TEXT NOT NULL,
      metric TEXT NOT NULL,
      bracket_type TEXT NOT NULL,
      bracket_min REAL,
      bracket_max REAL,
      side TEXT NOT NULL,
      model_probability REAL NOT NULL,
      market_price REAL NOT NULL,
      edge REAL NOT NULL,
      size REAL NOT NULL,
      kelly REAL NOT NULL,
      confidence TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL,
      condition_id TEXT NOT NULL,
      city TEXT NOT NULL,
      date TEXT NOT NULL,
      metric TEXT NOT NULL,
      bracket_type TEXT NOT NULL,
      bracket_min REAL,
      bracket_max REAL,
      side TEXT NOT NULL,
      entry_price REAL NOT NULL,
      size REAL NOT NULL,
      potential_payout REAL NOT NULL,
      model_probability REAL NOT NULL,
      edge REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      entry_time INTEGER NOT NULL,
      settle_time INTEGER,
      actual_temp REAL,
      pnl REAL,
      order_id TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_hashes (
      signal_id TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settlements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      station TEXT NOT NULL,
      date TEXT NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      fetched_at INTEGER NOT NULL,
      UNIQUE(station, date)
    )
  `);
}
