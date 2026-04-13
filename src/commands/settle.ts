// settle.ts — One-shot settlement checker for OpenClaw cron.
//
// Checks open positions against actual NWS Daily Climate Report data,
// marks positions as won/lost, updates P&L, then exits.
//
// Usage: bun run src/commands/settle.ts
// Cron:  openclaw cron add --skill elementclaw --script settle --schedule "0 */1 * * *"

import { logger } from "../logger.js";
import { initRiskState } from "../engine/risk.js";
import { checkSettlements } from "../settlement/tracker.js";
import { getOpenPositions, getStats } from "../store/db.js";

export async function runSettle() {
  logger.info("settle: starting");

  initRiskState();

  const openBefore = getOpenPositions();
  if (openBefore.length === 0) {
    logger.info("settle: no open positions to check");
    return;
  }

  logger.info({ openPositions: openBefore.length }, "settle: checking settlements");

  const settled = await checkSettlements();

  const stats = getStats();
  const openAfter = getOpenPositions();

  logger.info(
    {
      settled,
      remainingOpen: openAfter.length,
      totalTrades: stats.totalTrades,
      wins: stats.wins,
      losses: stats.losses,
      winRate: stats.totalTrades > 0 ? `${((stats.wins / stats.totalTrades) * 100).toFixed(1)}%` : "N/A",
      totalPnl: `$${stats.totalPnl.toFixed(2)}`,
    },
    "settle: complete",
  );
}
async function main() {
  await runSettle();
}

if (import.meta.main) {
  main().catch((err) => {
    logger.fatal({ err }, "settle: fatal error");
    process.exit(1);
  });
}
