// --- City & Weather ---

export interface CityConfig {
  name: string;
  slug: string; // for matching market titles
  polymarketSlug: string; // slug used in Polymarket event URLs
  lat: number;
  lon: number;
  nwsGridId: string; // NWS grid office
  nwsGridX: number;
  nwsGridY: number;
  iowaStation: string; // Iowa State CLI station ID (ICAO)
}

export interface EnsembleForecast {
  city: string;
  fetchedAt: number;
  daily: DailyForecast[];
}

export interface DailyForecast {
  date: string; // YYYY-MM-DD
  highs: number[]; // 31 members, Fahrenheit
  lows: number[]; // 31 members, Fahrenheit
}

export interface BucketProbability {
  city: string;
  date: string;
  metric: "high" | "low";
  bracketMin: number; // inclusive
  bracketMax: number; // exclusive
  probability: number; // 0-1
  memberCount: number;
}

// --- Market ---

export interface RawMarket {
  conditionId: string;
  questionId: string;
  title: string;
  slug: string;
  outcomes: string[];
  outcomePrices: string[];
  tokens: MarketToken[];
  volume: number;
  endDateIso: string;
  active: boolean;
  closed: boolean;
}

export interface MarketToken {
  tokenId: string;
  outcome: string;
  price: number;
}

export interface ParsedMarket {
  conditionId: string;
  title: string;
  city: string;
  date: string; // YYYY-MM-DD
  metric: "high" | "low";
  bracketMin: number;
  bracketMax: number;
  bracketType: "above" | "below" | "between";
  yesTokenId: string;
  noTokenId: string;
  yesPrice: number;
  noPrice: number;
  volume: number;
  endDateIso: string;
}

// --- Engine ---

export interface Signal {
  id: string;
  market: ParsedMarket;
  modelProbability: number;
  marketPrice: number;
  edge: number; // modelProbability - marketPrice
  side: "YES" | "NO";
  size: number; // USDC
  kelly: number; // raw Kelly fraction
  confidence: "LOCK" | "STRONG" | "SAFE" | "NEAR-SAFE";
  createdAt: number;
}

// --- Positions ---

export type PositionStatus = "open" | "won" | "lost" | "expired";

export interface Position {
  id: string;
  signalId: string;
  conditionId: string;
  city: string;
  date: string;
  metric: "high" | "low";
  bracketMin: number;
  bracketMax: number;
  bracketType: "above" | "below" | "between";
  side: "YES" | "NO";
  entryPrice: number;
  size: number; // USDC risked
  potentialPayout: number;
  modelProbability: number;
  edge: number;
  status: PositionStatus;
  entryTime: number;
  settleTime?: number;
  actualTemp?: number;
  pnl?: number;
  orderId?: string; // CLOB order ID for live mode
}

// --- Settlement ---

export interface CLIReport {
  station: string;
  date: string;
  high: number; // Fahrenheit
  low: number; // Fahrenheit
}

export interface SettledTradeRecord {
  positionId: string;
  signalId: string;
  conditionId: string;

  city: string;
  date: string;
  metric: "high" | "low";
  bracketMin: number;
  bracketMax: number;
  bracketType: "above" | "below" | "between";
  side: "YES" | "NO";

  entryPrice: number;
  size: number;
  potentialPayout: number;
  modelProbability: number;
  edge: number;

  entryTime: number;
  settleTime: number;
  holdDurationHours: number;

  actualTemp: number;
  outcome: "won" | "lost";
  pnl: number;

  orderId?: string;
}
// --- Config ---

export interface AppConfig {
  mode: "paper" | "live";
  bankrollUsdc: number;
  maxPositionPct: number;
  minEdgePct: number;
  kellyFraction: number;
  maxOpenPositions: number;
  maxPerCityDate: number;
  minEdgeLongshot: number; // higher edge required for low-probability bets
  polygonPrivateKey?: string;
  polymarketApiKey?: string;
  polymarketApiSecret?: string;
  polymarketApiPassphrase?: string;
}
