import { logger } from "../logger.js";
import type { Signal, ParsedMarket, EnsembleForecast, AppConfig, Position } from "../types.js";
import { calculateEdge } from "./edge.js";
import { kellySize } from "./sizing.js";
import { calculateConsensus } from "./consensus.js";
import { auditSignal } from "./audit.js";
import { insertAuditHash } from "../store/db.js";

const MIN_VOLUME = 1000; // $1K minimum market volume
const MIN_HOURS_TO_SETTLE = 2; // skip markets settling within 2 hours

function getConfidence(edge: number, consensusConfidence?: string): Signal["confidence"] {
  if (consensusConfidence === "LOCK" || edge >= 0.25) return "LOCK";
  if (consensusConfidence === "STRONG" || edge >= 0.15) return "STRONG";
  if (edge >= 0.10) return "SAFE";
  return "NEAR-SAFE";
}

/**
 * Generate trading signals from markets + ensemble data.
 */
export function generateSignals(
  markets: ParsedMarket[],
  gfsEnsembles: Map<string, EnsembleForecast>,
  config: AppConfig,
  openPositions: Position[],
  ecmwfEnsembles?: Map<string, EnsembleForecast>,
): Signal[] {
  const signals: Signal[] = [];
  const minEdge = config.minEdgePct / 100;
  const minEdgeLongshot = config.minEdgeLongshot / 100;
  const bankroll = config.bankrollUsdc;
  const now = Date.now();

  // Track which markets we already have positions on
  const openConditionIds = new Set(
    openPositions.filter((p) => p.status === "open").map((p) => p.conditionId),
  );

  // Track positions per city/date for diversification
  const cityDateCount = new Map<string, number>();
  for (const p of openPositions.filter((p) => p.status === "open")) {
    const key = `${p.city}:${p.date}`;
    cityDateCount.set(key, (cityDateCount.get(key) ?? 0) + 1);
  }

  for (const market of markets) {
    // Skip if we already have a position
    if (openConditionIds.has(market.conditionId)) continue;

    // Diversification: cap positions per city/date
    const cityDateKey = `${market.city}:${market.date}`;
    if ((cityDateCount.get(cityDateKey) ?? 0) >= config.maxPerCityDate) continue;

    // Skip low-volume markets
    if (market.volume < MIN_VOLUME) continue;

    // Skip markets settling too soon
    const endTime = new Date(market.endDateIso).getTime();
    if (endTime - now < MIN_HOURS_TO_SETTLE * 60 * 60 * 1000) continue;

    // Skip markets settling beyond forecast range (7 days)
    const marketDate = new Date(market.date).getTime();
    if (marketDate - now > 7 * 24 * 60 * 60 * 1000) continue;

    // Need GFS ensemble data for this city
    const gfsEnsemble = gfsEnsembles.get(market.city);
    if (!gfsEnsemble) continue;

    // Get ECMWF ensemble if available
    const ecmwfEnsemble = ecmwfEnsembles?.get(market.city) ?? null;

    // Multi-model consensus
    const consensus = calculateConsensus(
      gfsEnsemble,
      ecmwfEnsemble,
      null, // NWS high — fetched separately if needed
      market.date,
      market.metric,
      market.bracketType,
      market.bracketMin,
      market.bracketMax,
    );

    if (!consensus) continue;

    // Skip if models disagree
    if (consensus.confidence === "SKIP") continue;

    // Calculate edge using consensus probability
    const consensusProb = consensus.consensusProbability;
    const yesPrice = market.yesPrice;
    const noPrice = market.noPrice;

    const yesEdge = consensusProb - yesPrice;
    const noEdge = (1 - consensusProb) - noPrice;

    let side: "YES" | "NO";
    let edge: number;
    let modelProbability: number;
    let effectivePrice: number;

    if (yesEdge >= noEdge && yesEdge > 0) {
      side = "YES";
      edge = yesEdge;
      modelProbability = consensusProb;
      effectivePrice = yesPrice;
    } else if (noEdge > 0) {
      side = "NO";
      edge = noEdge;
      modelProbability = 1 - consensusProb;
      effectivePrice = noPrice;
    } else {
      continue; // no edge
    }

    // Longshots (model prob < 25%) need a higher edge to be worth it
    const isLongshot = modelProbability < 0.25;
    if (isLongshot && edge < minEdgeLongshot) continue;
    if (!isLongshot && edge < minEdge) continue;

    // Size the position (apply consensus Kelly multiplier)
    const sizing = kellySize(modelProbability, effectivePrice, bankroll, config);
    // Dampen Kelly multiplier for longshots — don't let LOCK inflate tail bets
    const effectiveKellyMult = isLongshot
      ? Math.min(consensus.kellyMultiplier, 0.8)
      : consensus.kellyMultiplier;
    let adjustedSize = sizing.size * effectiveKellyMult;
    adjustedSize = Math.min(adjustedSize, bankroll * config.maxPositionPct);
    adjustedSize = Math.floor(adjustedSize * 100) / 100;

    if (adjustedSize < 1.00) continue;

    const signal: Signal = {
      id: crypto.randomUUID(),
      market,
      modelProbability,
      marketPrice: effectivePrice,
      edge,
      side,
      size: adjustedSize,
      kelly: sizing.rawKelly,
      confidence: getConfidence(edge, consensus.confidence),
      createdAt: now,
    };

    // Audit trail: hash + timestamp the signal before execution
    const auditHash = auditSignal(signal);
    insertAuditHash(signal.id, auditHash);

    signals.push(signal);
    cityDateCount.set(cityDateKey, (cityDateCount.get(cityDateKey) ?? 0) + 1);

    logger.info(
      {
        city: market.city,
        date: market.date,
        metric: market.metric,
        bracket: market.bracketType === "between"
          ? `${market.bracketMin}-${market.bracketMax}°F`
          : `${market.bracketType} ${market.bracketType === "above" ? market.bracketMin : market.bracketMax}°F`,
        side: signal.side,
        model: `${(signal.modelProbability * 100).toFixed(1)}%`,
        market: `${(signal.marketPrice * 100).toFixed(1)}¢`,
        edge: `${(signal.edge * 100).toFixed(1)}%`,
        size: `$${signal.size.toFixed(2)}`,
        confidence: signal.confidence,
        models: consensus.modelsAgreeing,
      },
      "SIGNAL",
    );
  }

  return signals;
}
