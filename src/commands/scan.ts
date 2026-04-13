// scan.ts — One-shot scan cycle for OpenClaw cron.
//
// Fetches weather ensembles, scans Polymarket markets, generates signals,
// executes trades (paper or live), then exits.
//
// Usage: bun run src/commands/scan.ts
// Cron:  openclaw cron add --skill elementclaw --script scan --schedule "*/1 * * * *"

import { logger } from "../logger.js";
import { loadConfig, CITIES } from "../config.js";
import { fetchAllEnsembles } from "../weather/ensemble.js";
import { fetchAllEcmwfEnsembles } from "../weather/ecmwf.js";
import { fetchWeatherMarkets } from "../market/discovery.js";
import { parseAllMarkets } from "../market/parser.js";
import { generateSignals } from "../engine/signals.js";
import { executeSignal } from "../market/execution.js";
import { insertSignal, insertPosition, getOpenPositions } from "../store/db.js";
import { checkRiskLimits, initRiskState } from "../engine/risk.js";

export async function runScan() {
  const config = loadConfig();
  logger.info({ mode: config.mode }, "scan: starting");
  logger.info(
  {
    maxPerCity: Number(process.env.MAX_PER_CITY ?? 2),
    maxPerCityDate: Number(process.env.MAX_PER_CITY_DATE ?? 2),
    showConcentrationDebug: process.env.SHOW_CONCENTRATION_DEBUG === 'true',
  },
  'scan: concentration settings'
);

  initRiskState();

  // 1. Fetch weather data
  const gfsEnsembles = await fetchAllEnsembles(CITIES);
  const ecmwfEnsembles = await fetchAllEcmwfEnsembles(CITIES);

  // 2. Scan markets
  const rawMarkets = await fetchWeatherMarkets();
  const parsedMarkets = parseAllMarkets(rawMarkets);
  logger.info({ markets: parsedMarkets.length }, "scan: markets parsed");

  // 3. Risk check
  const openPositions = getOpenPositions();
  const risk = checkRiskLimits(config, openPositions);

  if (risk.circuitBroken) {
    logger.warn("scan: circuit breaker active — no trades");
    return;
  }

  if (openPositions.length >= config.maxOpenPositions) {
    logger.info(
  {
    open: openPositions.length,
    concentrationSummary: `${openPositions.length}/${config.maxOpenPositions} open, per-city <= ${Number(process.env.MAX_PER_CITY ?? 2)}, per-city-date <= ${Number(process.env.MAX_PER_CITY_DATE ?? 2)}`,
  },
  "scan: max positions reached"
);
    return;
  }

  // 4. Generate signals
  const signals = generateSignals(
    parsedMarkets,
    gfsEnsembles,
    config,
    openPositions,
    ecmwfEnsembles,
  );

  logger.info({ signals: signals.length }, "scan: signals generated");

  // 5. Execute
  let executed = 0;
  for (const signal of signals) {
    if (openPositions.length + executed >= config.maxOpenPositions) break;

    try {
      insertSignal(signal);
      const position = await executeSignal(signal, config);
      insertPosition(position);
      executed++;
      logger.info(
        { city: signal.market.city, side: signal.side, edge: `${(signal.edge * 100).toFixed(1)}%`, size: `$${signal.size.toFixed(2)}` },
        "scan: position opened",
      );
    } catch (err) {
      logger.error({ signal: signal.id, err }, "scan: execution failed");
    }
  }

  logger.info(
  {
    executed,
    totalOpen: openPositions.length + executed,
    concentrationSummary: `${openPositions.length + executed}/${config.maxOpenPositions} open, per-city <= ${Number(process.env.MAX_PER_CITY ?? 2)}, per-city-date <= ${Number(process.env.MAX_PER_CITY_DATE ?? 2)}`,
  },
  "scan: complete"
);
}

async function main() {
  await runScan();
}

if (import.meta.main) {
  main().catch((err) => {
    logger.fatal({ err }, "scan: fatal error");
    process.exit(1);
  });
}
