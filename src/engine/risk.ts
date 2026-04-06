import { logger } from "../logger.js";
import type { AppConfig, Position } from "../types.js";
import { getAllPositions } from "../store/db.js";

export interface RiskState {
  consecutiveLosses: number;
  circuitBroken: boolean;
  totalExposure: number;
  openCount: number;
}

const MAX_CONSECUTIVE_LOSS_DAYS = 3;

let consecutiveLossDays = 0;
let lastSettleDateWon = false;
let lastSettleDate = "";
let circuitBroken = false;

/**
 * Check if we should halt trading due to risk limits.
 */
export function checkRiskLimits(config: AppConfig, openPositions: Position[]): RiskState {
  const totalExposure = openPositions.reduce((sum, p) => sum + p.size, 0);

  return {
    consecutiveLosses: consecutiveLossDays,
    circuitBroken,
    totalExposure,
    openCount: openPositions.length,
  };
}

/**
 * Update risk state after a settlement.
 * Tracks by settlement date — correlated losses on the same date count as one loss day.
 */
export function onSettlement(won: boolean, date?: string): void {
  const settleDate = date ?? new Date().toISOString().slice(0, 10);

  if (settleDate !== lastSettleDate) {
    // New settlement date — check if previous date was net loss
    if (lastSettleDate && !lastSettleDateWon) {
      consecutiveLossDays++;
    } else if (lastSettleDate && lastSettleDateWon) {
      consecutiveLossDays = 0;
    }
    lastSettleDate = settleDate;
    lastSettleDateWon = won;
  } else {
    // Same date — if any position won, mark the day as a win
    if (won) lastSettleDateWon = true;
  }

  if (won && circuitBroken) {
    circuitBroken = false;
    consecutiveLossDays = 0;
    logger.info("Circuit breaker RESET after win");
  }

  if (consecutiveLossDays >= MAX_CONSECUTIVE_LOSS_DAYS) {
    circuitBroken = true;
    logger.warn(
      { consecutiveLossDays },
      "CIRCUIT BREAKER TRIGGERED — trading paused",
    );
  }
}

/**
 * Manually reset the circuit breaker.
 */
export function resetCircuitBreaker(): void {
  consecutiveLossDays = 0;
  circuitBroken = false;
  logger.info("Circuit breaker manually reset");
}

/**
 * Check if a market is settling too soon (within N hours).
 */
export function isTooCloseToSettlement(endDateIso: string, minHours: number = 2): boolean {
  const endTime = new Date(endDateIso).getTime();
  const now = Date.now();
  return endTime - now < minHours * 60 * 60 * 1000;
}

/**
 * Reconstruct risk state from DB on startup.
 */
export function initRiskState(): void {
  const positions = getAllPositions();
  const settled = positions.filter((p) => p.status === "won" || p.status === "lost");

  // Group by date, check if each date had any wins
  const dateResults = new Map<string, boolean>();
  for (const p of settled) {
    const hadWin = dateResults.get(p.date) ?? false;
    if (p.status === "won") dateResults.set(p.date, true);
    else if (!hadWin) dateResults.set(p.date, false);
  }

  // Count trailing consecutive loss days
  consecutiveLossDays = 0;
  const dates = [...dateResults.keys()].sort().reverse();
  for (const d of dates) {
    if (!dateResults.get(d)) {
      consecutiveLossDays++;
    } else {
      break;
    }
  }

  if (consecutiveLossDays >= MAX_CONSECUTIVE_LOSS_DAYS) {
    circuitBroken = true;
    logger.warn({ consecutiveLossDays }, "Circuit breaker active from previous session");
  }
}
