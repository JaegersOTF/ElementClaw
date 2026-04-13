/**
 * status.ts — One-shot status report for OpenClaw cron or manual checks.
 *
 * Prints current positions, P&L stats, and risk state to stdout, then exits.
 *
 * Usage: bun run src/commands/status.ts
 * Cron:  openclaw cron add --skill elementclaw --script status --schedule "0 8 * * *"
 */

import { loadConfig } from "../config.js";
import { getOpenPositions, getStats } from "../store/db.js";
import { checkRiskLimits, initRiskState } from "../engine/risk.js";
import { getPnLSummary } from "../settlement/pnl.js";

function main() {
  const config = loadConfig();
  initRiskState();

  const openPositions = getOpenPositions();
  const stats = getStats();
  const pnl = getPnLSummary();
  const risk = checkRiskLimits(config, openPositions);
  const cityCounts = Object.fromEntries(
  Array.from(
    openPositions.reduce((acc, p) => {
      acc.set(p.city, (acc.get(p.city) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort(([a], [b]) => a.localeCompare(b))
);
  const cityDateCounts = Object.fromEntries(
  Array.from(
    openPositions.reduce((acc, p) => {
      const key = `${p.city} (${p.date})`;
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort(([a], [b]) => a.localeCompare(b))
);
 
  const maxPerCity = Number(process.env.MAX_PER_CITY ?? 2);
  const maxPerCityDate = Number(process.env.MAX_PER_CITY_DATE ?? 2);

  const concentrationOk =
  Object.values(cityCounts).every((count) => count <= maxPerCity) &&
  Object.values(cityDateCounts).every((count) => count <= maxPerCityDate);
  const sideCounts = Object.fromEntries(
  Array.from(
    openPositions.reduce((acc, p) => {
      acc.set(p.side, (acc.get(p.side) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort(([a], [b]) => a.localeCompare(b))
);
  const dateCounts = Object.fromEntries(
  Array.from(
    openPositions.reduce((acc, p) => {
      acc.set(p.date, (acc.get(p.date) ?? 0) + 1);
      return acc;
    }, new Map<string, number>())
  ).sort(([a], [b]) => a.localeCompare(b))
);
  const report = {
    mode: config.mode,
    bankroll: config.bankrollUsdc,
    openPositions: openPositions.length,
    sideCounts,
    dateCounts,
    cityCounts,
    cityDateCounts,
    maxPerCity,
    maxPerCityDate,
    concentrationOk,
    concentrationSummary: `${openPositions.length}/${config.maxOpenPositions} open, per-city <= ${maxPerCity}, per-city-date <= ${maxPerCityDate}`,
    maxPositions: config.maxOpenPositions,
    openExposure: Number(pnl.openExposure.toFixed(2)),
    averageOpenEdge: openPositions.length ? Number((openPositions.reduce((sum, p) => sum + p.edge, 0) / openPositions.length).toFixed(2)) : 0,
    highestOpenEdge: openPositions.length ? Number(Math.max(...openPositions.map((p) => p.edge)).toFixed(2)) : 0,
    lowestOpenEdge: openPositions.length ? Number(Math.min(...openPositions.map((p) => p.edge)).toFixed(2)) : 0,
    averageEntryPrice: openPositions.length ? Number((openPositions.reduce((sum, p) => sum + p.entryPrice, 0) / openPositions.length).toFixed(3)) : 0,
    averagePositionSize: openPositions.length ? Number((openPositions.reduce((sum, p) => sum + p.size, 0) / openPositions.length).toFixed(2)) : 0,
    totalTrades: stats.totalTrades,
    wins: stats.wins,
    losses: stats.losses,
    winRate: stats.totalTrades > 0 ? `${((stats.wins / stats.totalTrades) * 100).toFixed(1)}%` : "N/A",
    totalPnl: Number(stats.totalPnl.toFixed(2)),
    circuitBroken: risk.circuitBroken,
    consecutiveLosses: risk.consecutiveLosses,
    positions: openPositions.map((p) => ({
      city: p.city,
      date: p.date,
      side: p.side,
      bracket: p.bracketType === "between"
        ? `${p.bracketMin}-${p.bracketMax - 1}°F`
        : `${p.bracketType} ${p.bracketType === "above" ? p.bracketMin : p.bracketMax}°F`,
      entryPrice: `${(p.entryPrice * 100).toFixed(1)}¢`,
      size: `$${p.size.toFixed(2)}`,
      edge: `${(p.edge * 100).toFixed(1)}%`,
    })),
  };

  // Output as JSON for machine consumption (OpenClaw, dashboards, etc.)
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

main();
