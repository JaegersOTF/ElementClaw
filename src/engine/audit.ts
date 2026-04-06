import { createHash } from "crypto";
import { appendFileSync, existsSync, readFileSync } from "fs";
import { logger } from "../logger.js";
import type { Signal, Position } from "../types.js";

const AUDIT_LOG_PATH = "data/audit-log.jsonl";

export interface AuditEntry {
  type: "signal" | "settlement";
  timestamp: string; // ISO 8601
  epochMs: number;
  hash: string; // SHA256 of the payload (pre-image proof)
  payload: SignalAudit | SettlementAudit;
}

export interface SignalAudit {
  signalId: string;
  city: string;
  date: string;
  metric: string;
  bracketType: string;
  bracketMin: number;
  bracketMax: number;
  side: "YES" | "NO";
  modelProbability: number;
  marketPriceAtSignal: number;
  edge: number;
  size: number;
  confidence: string;
  conditionId: string;
  // Market snapshot — proves what the market looked like when we signaled
  marketSnapshot: {
    yesPrice: number;
    noPrice: number;
    volume: number;
    endDateIso: string;
    title: string;
  };
}

export interface SettlementAudit {
  positionId: string;
  signalId: string;
  city: string;
  date: string;
  side: "YES" | "NO";
  entryPrice: number;
  size: number;
  actualTemp: number;
  outcome: "won" | "lost";
  pnl: number;
  // Reference back to the signal hash for chain of proof
  originalSignalHash: string;
}

function sha256(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

// Write a signal to the audit log. Returns the hash for later reference.
export function auditSignal(signal: Signal): string {
  const now = Date.now();
  const payload: SignalAudit = {
    signalId: signal.id,
    city: signal.market.city,
    date: signal.market.date,
    metric: signal.market.metric,
    bracketType: signal.market.bracketType,
    bracketMin: signal.market.bracketMin,
    bracketMax: signal.market.bracketMax,
    side: signal.side,
    modelProbability: signal.modelProbability,
    marketPriceAtSignal: signal.marketPrice,
    edge: signal.edge,
    size: signal.size,
    confidence: signal.confidence,
    conditionId: signal.market.conditionId,
    marketSnapshot: {
      yesPrice: signal.market.yesPrice,
      noPrice: signal.market.noPrice,
      volume: signal.market.volume,
      endDateIso: signal.market.endDateIso,
      title: signal.market.title,
    },
  };

  const payloadJson = JSON.stringify(payload);
  const hash = sha256(payloadJson);

  const entry: AuditEntry = {
    type: "signal",
    timestamp: new Date(now).toISOString(),
    epochMs: now,
    hash,
    payload,
  };

  appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n");
  logger.info({ signalId: signal.id, hash: hash.slice(0, 12) }, "AUDIT: signal logged");
  return hash;
}

// Write a settlement to the audit log, referencing the original signal hash.
export function auditSettlement(
  position: Position,
  actualTemp: number,
  outcome: "won" | "lost",
  pnl: number,
  originalSignalHash: string,
): void {
  const now = Date.now();
  const payload: SettlementAudit = {
    positionId: position.id,
    signalId: position.signalId,
    city: position.city,
    date: position.date,
    side: position.side,
    entryPrice: position.entryPrice,
    size: position.size,
    actualTemp,
    outcome,
    pnl,
    originalSignalHash,
  };

  const payloadJson = JSON.stringify(payload);
  const hash = sha256(payloadJson);

  const entry: AuditEntry = {
    type: "settlement",
    timestamp: new Date(now).toISOString(),
    epochMs: now,
    hash,
    payload,
  };

  appendFileSync(AUDIT_LOG_PATH, JSON.stringify(entry) + "\n");
  logger.info(
    { positionId: position.id, outcome, hash: hash.slice(0, 12) },
    "AUDIT: settlement logged",
  );
}

// Read all audit entries (for dashboard)
export function readAuditLog(): AuditEntry[] {
  if (!existsSync(AUDIT_LOG_PATH)) return [];
  const raw = readFileSync(AUDIT_LOG_PATH, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line));
}

// Verify a single entry: re-hash the payload and compare
export function verifyEntry(entry: AuditEntry): boolean {
  const payloadJson = JSON.stringify(entry.payload);
  const expected = sha256(payloadJson);
  return expected === entry.hash;
}

// Verify the entire audit log integrity
export function verifyAuditLog(): { total: number; valid: number; invalid: number } {
  const entries = readAuditLog();
  let valid = 0;
  let invalid = 0;
  for (const entry of entries) {
    if (verifyEntry(entry)) valid++;
    else invalid++;
  }
  return { total: entries.length, valid, invalid };
}
