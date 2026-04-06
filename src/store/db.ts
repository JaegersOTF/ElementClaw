import { Database } from "bun:sqlite";
import { initSchema } from "./schema.js";
import type { Signal, Position, CLIReport } from "../types.js";
import { logger } from "../logger.js";

let db: Database;

export function getDb(): Database {
  if (!db) {
    db = new Database("data/positions.sqlite", { create: true });
    db.run("PRAGMA journal_mode = WAL");
    initSchema(db);
    logger.info("SQLite database initialized");
  }
  return db;
}

// --- Signals ---

export function insertSignal(signal: Signal): void {
  getDb().run(
    `INSERT OR IGNORE INTO signals (id, condition_id, city, date, metric, bracket_type, bracket_min, bracket_max, side, model_probability, market_price, edge, size, kelly, confidence, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      signal.id, signal.market.conditionId, signal.market.city, signal.market.date,
      signal.market.metric, signal.market.bracketType, signal.market.bracketMin, signal.market.bracketMax,
      signal.side, signal.modelProbability, signal.marketPrice, signal.edge,
      signal.size, signal.kelly, signal.confidence, signal.createdAt,
    ],
  );
}

// --- Positions ---

export function insertPosition(pos: Position): void {
  getDb().run(
    `INSERT OR IGNORE INTO positions (id, signal_id, condition_id, city, date, metric, bracket_type, bracket_min, bracket_max, side, entry_price, size, potential_payout, model_probability, edge, status, entry_time, order_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      pos.id, pos.signalId, pos.conditionId, pos.city, pos.date,
      pos.metric, pos.bracketType, pos.bracketMin, pos.bracketMax,
      pos.side, pos.entryPrice, pos.size, pos.potentialPayout,
      pos.modelProbability, pos.edge, pos.status, pos.entryTime, pos.orderId ?? null,
    ],
  );
}

function mapRow(row: any): Position {
  return {
    id: row.id,
    signalId: row.signal_id,
    conditionId: row.condition_id,
    city: row.city,
    date: row.date,
    metric: row.metric,
    bracketMin: row.bracket_min,
    bracketMax: row.bracket_max,
    bracketType: row.bracket_type,
    side: row.side,
    entryPrice: row.entry_price,
    size: row.size,
    potentialPayout: row.potential_payout,
    modelProbability: row.model_probability,
    edge: row.edge,
    status: row.status,
    entryTime: row.entry_time,
    settleTime: row.settle_time,
    actualTemp: row.actual_temp,
    pnl: row.pnl,
    orderId: row.order_id,
  };
}

export function getOpenPositions(): Position[] {
  return (getDb().query(`SELECT * FROM positions WHERE status = 'open'`).all() as any[]).map(mapRow);
}

export function getAllPositions(): Position[] {
  return (getDb().query(`SELECT * FROM positions ORDER BY entry_time DESC`).all() as any[]).map(mapRow);
}

export function settlePosition(id: string, status: "won" | "lost", actualTemp: number, pnl: number): void {
  getDb().run(
    `UPDATE positions SET status = ?, settle_time = ?, actual_temp = ?, pnl = ? WHERE id = ?`,
    [status, Date.now(), actualTemp, pnl, id],
  );
}

// --- Settlements ---

export function upsertSettlement(report: CLIReport): void {
  getDb().run(
    `INSERT OR REPLACE INTO settlements (station, date, high, low, fetched_at)
     VALUES (?, ?, ?, ?, ?)`,
    [report.station, report.date, report.high, report.low, Date.now()],
  );
}

export function getSettlement(station: string, date: string): CLIReport | null {
  const row = getDb().query(
    `SELECT station, date, high, low FROM settlements WHERE station = ? AND date = ?`,
  ).get(station, date) as any;
  return row ? { station: row.station, date: row.date, high: row.high, low: row.low } : null;
}

// --- Audit Hashes ---

export function insertAuditHash(signalId: string, hash: string): void {
  getDb().run(
    `INSERT OR IGNORE INTO audit_hashes (signal_id, hash, created_at) VALUES (?, ?, ?)`,
    [signalId, hash, Date.now()],
  );
}

export function getAuditHash(signalId: string): string | null {
  const row = getDb().query(
    `SELECT hash FROM audit_hashes WHERE signal_id = ?`,
  ).get(signalId) as any;
  return row?.hash ?? null;
}

// --- Stats ---

export function getStats(): { totalTrades: number; wins: number; losses: number; totalPnl: number } {
  const settled = getDb().query(
    `SELECT status, pnl FROM positions WHERE status IN ('won', 'lost')`,
  ).all() as any[];

  let wins = 0, losses = 0, totalPnl = 0;
  for (const row of settled) {
    if (row.status === "won") wins++;
    else losses++;
    totalPnl += row.pnl ?? 0;
  }

  return { totalTrades: wins + losses, wins, losses, totalPnl };
}
