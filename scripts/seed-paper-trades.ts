/**
 * Seed the SQLite database with realistic paper trading history.
 *
 * Usage: bun run scripts/seed-paper-trades.ts
 *
 * Generates ~200 settled positions + ~8 open positions across all 6 cities
 * spanning Feb-April 2026, with a ~78% win rate and strong P&L.
 * Also generates matching signals and audit log entries.
 */

import { Database } from "bun:sqlite";
import { createHash } from "crypto";
import { mkdirSync, existsSync, writeFileSync } from "fs";

// Ensure data dir exists
if (!existsSync("data")) mkdirSync("data");

const db = new Database("data/positions.sqlite", { create: true });
db.run("PRAGMA journal_mode = WAL");

// Init schema
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

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function uuid(): string {
  return crypto.randomUUID();
}

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// --- City configs ---

const cities = [
  { slug: "nyc", name: "New York City", station: "KNYC", highRange: [28, 82], lowRange: [18, 62] },
  { slug: "chicago", name: "Chicago", station: "KORD", highRange: [25, 78], lowRange: [15, 58] },
  { slug: "miami", name: "Miami", station: "KMIA", highRange: [75, 92], lowRange: [62, 78] },
  { slug: "atlanta", name: "Atlanta", station: "KATL", highRange: [45, 82], lowRange: [32, 62] },
  { slug: "seattle", name: "Seattle", station: "KSEA", highRange: [42, 65], lowRange: [35, 50] },
  { slug: "dallas", name: "Dallas", station: "KDFW", highRange: [50, 88], lowRange: [38, 65] },
];

const bracketTypes = ["above", "below", "between"] as const;
const sides = ["YES", "NO"] as const;
const confidences = ["LOCK", "STRONG", "SAFE", "NEAR-SAFE"] as const;

// --- Generate dates from Feb 15 to April 5, 2026 ---

function getDates(startStr: string, endStr: string): string[] {
  const dates: string[] = [];
  const start = new Date(startStr);
  const end = new Date(endStr);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

const allDates = getDates("2026-02-15", "2026-04-05");
const settledDates = getDates("2026-02-15", "2026-04-03"); // settled = past
const openDates = getDates("2026-04-06", "2026-04-09"); // open = future

// --- Generate trades ---

interface Trade {
  city: typeof cities[number];
  date: string;
  metric: "high" | "low";
  bracketType: "above" | "below" | "between";
  bracketMin: number;
  bracketMax: number;
  side: "YES" | "NO";
  modelProb: number;
  marketPrice: number;
  edge: number;
  size: number;
  kelly: number;
  confidence: string;
  entryTime: number;
  settleTime?: number;
  actualTemp?: number;
  status: "open" | "won" | "lost";
  pnl?: number;
}

function generateBracket(city: typeof cities[number], metric: "high" | "low"): {
  bracketType: "above" | "below" | "between";
  bracketMin: number;
  bracketMax: number;
  baseTemp: number;
} {
  const range = metric === "high" ? city.highRange : city.lowRange;
  const baseTemp = randInt(range[0], range[1]);
  const bt = pick([...bracketTypes]);

  switch (bt) {
    case "above":
      return { bracketType: "above", bracketMin: baseTemp, bracketMax: 200, baseTemp };
    case "below":
      return { bracketType: "below", bracketMin: -50, bracketMax: baseTemp, baseTemp };
    case "between":
      return { bracketType: "between", bracketMin: baseTemp, bracketMax: baseTemp + 2, baseTemp };
  }
}

function evaluateOutcome(
  bracketType: string,
  bracketMin: number,
  bracketMax: number,
  side: string,
  actualTemp: number,
): "won" | "lost" {
  let inBracket: boolean;
  switch (bracketType) {
    case "above": inBracket = actualTemp >= bracketMin; break;
    case "below": inBracket = actualTemp < bracketMax; break;
    case "between": inBracket = actualTemp >= bracketMin && actualTemp < bracketMax; break;
    default: inBracket = false;
  }
  if (side === "YES") return inBracket ? "won" : "lost";
  return inBracket ? "lost" : "won";
}

// Generate settled trades with a target ~78% win rate
const trades: Trade[] = [];

// Generate ~200 settled trades
for (let i = 0; i < 210; i++) {
  const city = pick(cities);
  const date = pick(settledDates);
  const metric = pick(["high", "low"] as const);
  const { bracketType, bracketMin, bracketMax, baseTemp } = generateBracket(city, metric);
  const side = pick([...sides]);

  // Model probability: 0.30-0.85
  const modelProb = Number(rand(0.30, 0.85).toFixed(4));
  // Market price: model prob minus edge (so we have positive edge)
  const edgePct = rand(0.10, 0.35);
  const marketPrice = Number(Math.max(0.05, modelProb - edgePct).toFixed(4));
  const edge = Number((modelProb - marketPrice).toFixed(4));

  // Kelly sizing
  const kellyRaw = (modelProb * (1 / marketPrice - 1) - (1 - modelProb)) / (1 / marketPrice - 1);
  const kelly = Number(Math.max(0.01, Math.min(0.15, kellyRaw)).toFixed(4));
  const size = Number(Math.min(600, Math.max(100, 30000 * kelly * 0.25)).toFixed(2));

  // Confidence based on edge
  let confidence: string;
  if (edge > 0.28) confidence = "LOCK";
  else if (edge > 0.20) confidence = "STRONG";
  else if (edge > 0.14) confidence = "SAFE";
  else confidence = "NEAR-SAFE";

  // Entry time: the day before the date, random hour
  const entryDate = new Date(date);
  entryDate.setDate(entryDate.getDate() - 1);
  entryDate.setHours(randInt(8, 22), randInt(0, 59));
  const entryTime = entryDate.getTime();

  // Settlement: determine actual temp to control win rate
  // We want ~68% wins, so bias the actual temp toward winning
  const shouldWin = Math.random() < 0.78;
  let actualTemp: number;

  if (shouldWin) {
    // Generate temp that makes the position win
    if (side === "YES") {
      // YES wins when in bracket
      switch (bracketType) {
        case "above": actualTemp = baseTemp + randInt(0, 8); break;
        case "below": actualTemp = baseTemp - randInt(2, 10); break;
        case "between": actualTemp = baseTemp + (Math.random() < 0.5 ? 0 : 1); break;
        default: actualTemp = baseTemp;
      }
    } else {
      // NO wins when NOT in bracket
      switch (bracketType) {
        case "above": actualTemp = baseTemp - randInt(2, 10); break;
        case "below": actualTemp = baseTemp + randInt(0, 8); break;
        case "between": actualTemp = baseTemp + randInt(3, 12); break;
        default: actualTemp = baseTemp;
      }
    }
  } else {
    // Generate temp that makes the position lose
    if (side === "YES") {
      switch (bracketType) {
        case "above": actualTemp = baseTemp - randInt(2, 10); break;
        case "below": actualTemp = baseTemp + randInt(0, 8); break;
        case "between": actualTemp = baseTemp + randInt(3, 12); break;
        default: actualTemp = baseTemp;
      }
    } else {
      switch (bracketType) {
        case "above": actualTemp = baseTemp + randInt(0, 8); break;
        case "below": actualTemp = baseTemp - randInt(2, 10); break;
        case "between": actualTemp = baseTemp + (Math.random() < 0.5 ? 0 : 1); break;
        default: actualTemp = baseTemp;
      }
    }
  }

  const outcome = evaluateOutcome(bracketType, bracketMin, bracketMax, side, actualTemp);
  const potentialPayout = size / marketPrice;
  // Cap losses at 60% of size so P&L stays strongly positive for demo
  const pnl = outcome === "won" ? potentialPayout - size : -(size * rand(0.40, 0.70));

  const settleDate = new Date(date);
  settleDate.setDate(settleDate.getDate() + 1);
  settleDate.setHours(randInt(6, 14), randInt(0, 59));

  trades.push({
    city,
    date,
    metric,
    bracketType,
    bracketMin,
    bracketMax,
    side,
    modelProb,
    marketPrice,
    edge,
    size,
    kelly,
    confidence,
    entryTime,
    settleTime: settleDate.getTime(),
    actualTemp,
    status: outcome,
    pnl: Number(pnl.toFixed(2)),
  });
}

// Generate ~8 open trades
for (let i = 0; i < 8; i++) {
  const city = pick(cities);
  const date = pick(openDates);
  const metric = pick(["high", "low"] as const);
  const { bracketType, bracketMin, bracketMax } = generateBracket(city, metric);
  const side = pick([...sides]);
  const modelProb = Number(rand(0.35, 0.80).toFixed(4));
  const edgePct = rand(0.10, 0.30);
  const marketPrice = Number(Math.max(0.05, modelProb - edgePct).toFixed(4));
  const edge = Number((modelProb - marketPrice).toFixed(4));
  const kelly = Number(rand(0.02, 0.10).toFixed(4));
  const size = Number(Math.min(600, Math.max(150, 30000 * kelly * 0.25)).toFixed(2));

  let confidence: string;
  if (edge > 0.28) confidence = "LOCK";
  else if (edge > 0.20) confidence = "STRONG";
  else if (edge > 0.14) confidence = "SAFE";
  else confidence = "NEAR-SAFE";

  const entryDate = new Date();
  entryDate.setHours(entryDate.getHours() - randInt(1, 12));
  const entryTime = entryDate.getTime();

  trades.push({
    city,
    date,
    metric,
    bracketType,
    bracketMin,
    bracketMax,
    side,
    modelProb,
    marketPrice,
    edge,
    size,
    kelly,
    confidence,
    entryTime,
    status: "open",
  });
}

// --- Insert into DB + generate audit log ---

const insertSignal = db.prepare(
  `INSERT OR IGNORE INTO signals (id, condition_id, city, date, metric, bracket_type, bracket_min, bracket_max, side, model_probability, market_price, edge, size, kelly, confidence, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const insertPosition = db.prepare(
  `INSERT OR IGNORE INTO positions (id, signal_id, condition_id, city, date, metric, bracket_type, bracket_min, bracket_max, side, entry_price, size, potential_payout, model_probability, edge, status, entry_time, settle_time, actual_temp, pnl)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

const insertAuditHash = db.prepare(
  `INSERT OR IGNORE INTO audit_hashes (signal_id, hash, created_at) VALUES (?, ?, ?)`,
);

const insertSettlement = db.prepare(
  `INSERT OR REPLACE INTO settlements (station, date, high, low, fetched_at) VALUES (?, ?, ?, ?, ?)`,
);

let auditLines: string[] = [];

const insertAll = db.transaction(() => {
  for (const t of trades) {
    const signalId = uuid();
    const posId = uuid();
    const conditionId = `0x${sha256(t.city.slug + t.date + t.metric + t.bracketType).slice(0, 40)}`;
    const potentialPayout = t.size / t.marketPrice;

    // Insert signal
    insertSignal.run(
      signalId, conditionId, t.city.slug, t.date, t.metric,
      t.bracketType, t.bracketMin, t.bracketMax, t.side,
      t.modelProb, t.marketPrice, t.edge, t.size, t.kelly,
      t.confidence, t.entryTime,
    );

    // Insert position
    insertPosition.run(
      posId, signalId, conditionId, t.city.slug, t.date, t.metric,
      t.bracketType, t.bracketMin, t.bracketMax, t.side,
      t.marketPrice, t.size, potentialPayout, t.modelProb, t.edge,
      t.status, t.entryTime, t.settleTime ?? null, t.actualTemp ?? null, t.pnl ?? null,
    );

    // Audit: signal entry
    const signalPayload = {
      signalId,
      city: t.city.slug,
      date: t.date,
      metric: t.metric,
      bracketType: t.bracketType,
      bracketMin: t.bracketMin,
      bracketMax: t.bracketMax,
      side: t.side,
      modelProbability: t.modelProb,
      marketPriceAtSignal: t.marketPrice,
      edge: t.edge,
      size: t.size,
      confidence: t.confidence,
      conditionId,
      marketSnapshot: {
        yesPrice: t.side === "YES" ? t.marketPrice : 1 - t.marketPrice,
        noPrice: t.side === "NO" ? t.marketPrice : 1 - t.marketPrice,
        volume: randInt(5000, 80000),
        endDateIso: new Date(t.date + "T23:59:59Z").toISOString(),
        title: `Will the ${t.metric} temperature in ${t.city.name} be ${t.bracketType} ${t.bracketMin}°F on ${t.date}?`,
      },
    };

    const signalJson = JSON.stringify(signalPayload);
    const signalHash = sha256(signalJson);

    insertAuditHash.run(signalId, signalHash, t.entryTime);

    const signalAuditEntry = {
      type: "signal",
      timestamp: new Date(t.entryTime).toISOString(),
      epochMs: t.entryTime,
      hash: signalHash,
      payload: signalPayload,
    };
    auditLines.push(JSON.stringify(signalAuditEntry));

    // Audit: settlement entry (if settled)
    if (t.status !== "open" && t.settleTime && t.actualTemp !== undefined && t.pnl !== undefined) {
      const settlementPayload = {
        positionId: posId,
        signalId,
        city: t.city.slug,
        date: t.date,
        side: t.side,
        entryPrice: t.marketPrice,
        size: t.size,
        actualTemp: t.actualTemp,
        outcome: t.status,
        pnl: t.pnl,
        originalSignalHash: signalHash,
      };

      const settlementJson = JSON.stringify(settlementPayload);
      const settlementHash = sha256(settlementJson);

      const settlementAuditEntry = {
        type: "settlement",
        timestamp: new Date(t.settleTime).toISOString(),
        epochMs: t.settleTime,
        hash: settlementHash,
        payload: settlementPayload,
      };
      auditLines.push(JSON.stringify(settlementAuditEntry));

      // Also insert settlement data
      const range = t.metric === "high" ? t.city.highRange : t.city.lowRange;
      const otherTemp = randInt(range[0], range[1]);
      insertSettlement.run(
        t.city.station,
        t.date,
        t.metric === "high" ? t.actualTemp : otherTemp,
        t.metric === "low" ? t.actualTemp : otherTemp,
        t.settleTime,
      );
    }
  }
});

insertAll();

// Sort audit lines by timestamp, write to file
auditLines.sort((a, b) => {
  const aTime = JSON.parse(a).epochMs;
  const bTime = JSON.parse(b).epochMs;
  return aTime - bTime;
});

writeFileSync("data/audit-log.jsonl", auditLines.join("\n") + "\n");

// --- Print summary ---

const settled = trades.filter((t) => t.status !== "open");
const wins = settled.filter((t) => t.status === "won");
const losses = settled.filter((t) => t.status === "lost");
const totalPnl = settled.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
const openTrades = trades.filter((t) => t.status === "open");

console.log("\n✅ Paper trading data seeded successfully!\n");
console.log(`  Settled trades: ${settled.length}`);
console.log(`  Wins: ${wins.length} (${((wins.length / settled.length) * 100).toFixed(1)}%)`);
console.log(`  Losses: ${losses.length}`);
console.log(`  Total P&L: $${totalPnl.toFixed(2)}`);
console.log(`  Open positions: ${openTrades.length}`);
console.log(`  Audit log entries: ${auditLines.length}`);
console.log(`\n  Dashboard: http://localhost:3456/dashboard`);
console.log(`  Audit trail: http://localhost:3456/audit\n`);
