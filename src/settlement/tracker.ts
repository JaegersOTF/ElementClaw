import { logger } from "../logger.js";
import { fetchWithRetry } from "../utils/retry.js";
import { appendJsonl } from "../utils/jsonl.js";
import { CITIES } from "../config.js";
import { getSettlement, upsertSettlement, settlePosition, getOpenPositions, getAuditHash } from "../store/db.js";
import { onSettlement } from "../engine/risk.js";
import { auditSettlement } from "../engine/audit.js";
import type { CLIReport, Position, SettledTradeRecord } from "../types.js";

/**
 * Fetch actual observed temps from Iowa State CLI API.
 * https://mesonet.agron.iastate.edu/json/cli.py?station=KNYC&year=2026
 */
export async function fetchCLIReport(station: string, date: string): Promise<CLIReport | null> {
  // Check cache first
  const cached = getSettlement(station, date);
  if (cached) return cached;

  const year = date.slice(0, 4);
  const url = `https://mesonet.agron.iastate.edu/json/cli.py?station=${station}&year=${year}`;

  try {
    const res = await fetchWithRetry(url, {}, 2, 2000);
    if (!res.ok) {
      logger.warn({ station, status: res.status }, "CLI API error");
      return null;
    }

    const data = (await res.json()) as CLIApiResponse;
    if (!data.results) return null;

    // Cache all results for this station
    for (const r of data.results) {
      const report: CLIReport = {
        station: r.station,
        date: r.valid,
        high: r.high,
        low: r.low,
      };
      upsertSettlement(report);
    }

    return getSettlement(station, date);
  } catch (err) {
    logger.error({ station, err }, "CLI fetch failed");
    return null;
  }
}

/**
 * Check open positions against actual settlement data.
 */
export async function checkSettlements(): Promise<number> {
  const openPositions = getOpenPositions();
  if (openPositions.length === 0) return 0;

  let settled = 0;

  for (const pos of openPositions) {
    // Find the city config to get the station ID
    const city = CITIES.find((c) => c.slug === pos.city);
    if (!city) continue;

    // Only check positions whose date has passed
    const posDate = new Date(pos.date);
    const now = new Date();
    if (posDate >= now) continue; // not yet settleable

    const report = await fetchCLIReport(city.iowaStation, pos.date);
    if (!report) continue;

    const actualTemp = pos.metric === "high" ? report.high : report.low;
    const outcome = evaluateOutcome(pos, actualTemp);

    const pnl = outcome === "won"
      ? pos.potentialPayout - pos.size // profit
      : -pos.size; // loss
    const settleTime = Date.now();
    settlePosition(pos.id, outcome, actualTemp, pnl);
    onSettlement(outcome === "won", pos.date);
    
    const settledRecord = buildSettledTradeRecord(pos, actualTemp, outcome, pnl, settleTime);
    appendJsonl("data/settled-trades.jsonl", settledRecord);
    // Audit trail: log the settlement with reference to original signal hash
    const signalHash = getAuditHash(pos.signalId) ?? "unknown";
    auditSettlement(pos, actualTemp, outcome, pnl, signalHash);

    settled++;

    logger.info(
      {
        city: pos.city,
        date: pos.date,
        side: pos.side,
        actual: `${actualTemp}°F`,
        outcome,
        pnl: `$${pnl.toFixed(2)}`,
      },
      outcome === "won" ? "✅ WON" : "❌ LOST",
    );
  }

  return settled;
}

function buildSettledTradeRecord(
  pos: Position,
  actualTemp: number,
  outcome: "won" | "lost",
  pnl: number,
  settleTime: number,
): SettledTradeRecord {
  const holdDurationHours = Number(
    ((settleTime - pos.entryTime) / (1000 * 60 * 60)).toFixed(2),
  );

  return {
    positionId: pos.id,
    signalId: pos.signalId,
    conditionId: pos.conditionId,

    city: pos.city,
    date: pos.date,
    metric: pos.metric,
    bracketMin: pos.bracketMin,
    bracketMax: pos.bracketMax,
    bracketType: pos.bracketType,
    side: pos.side,

    entryPrice: pos.entryPrice,
    size: pos.size,
    potentialPayout: pos.potentialPayout,
    modelProbability: pos.modelProbability,
    edge: pos.edge,

    entryTime: pos.entryTime,
    settleTime,
    holdDurationHours,

    actualTemp,
    outcome,
    pnl,

    orderId: pos.orderId,
  };
}

function evaluateOutcome(pos: Position, actualTemp: number): "won" | "lost" {
  let inBracket: boolean;

  switch (pos.bracketType) {
    case "above":
      inBracket = actualTemp >= pos.bracketMin;
      break;
    case "below":
      inBracket = actualTemp < pos.bracketMax;
      break;
    case "between":
      inBracket = actualTemp >= pos.bracketMin && actualTemp < pos.bracketMax;
      break;
  }

  // YES wins if in bracket, NO wins if not in bracket
  if (pos.side === "YES") {
    return inBracket ? "won" : "lost";
  } else {
    return inBracket ? "lost" : "won";
  }
}

interface CLIApiResponse {
  results?: Array<{
    station: string;
    valid: string; // YYYY-MM-DD
    high: number;
    low: number;
  }>;
}
