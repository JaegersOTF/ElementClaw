import type { AppConfig, CityConfig } from "./types.js";

export function loadConfig(): AppConfig {
  return {
    mode: (process.env["MODE"] as "paper" | "live") ?? "paper",
    bankrollUsdc: Number(process.env["BANKROLL_USDC"] ?? "30000"),
    maxPositionPct: Number(process.env["MAX_POSITION_PCT"] ?? "0.02"),
    minEdgePct: Number(process.env["MIN_EDGE_PCT"] ?? "10"),
    kellyFraction: Number(process.env["KELLY_FRACTION"] ?? "0.25"),
    maxOpenPositions: Number(process.env["MAX_OPEN_POSITIONS"] ?? "50"),
    maxPerCityDate: Number(process.env["MAX_PER_CITY_DATE"] ?? "3"),
    minEdgeLongshot: Number(process.env["MIN_EDGE_LONGSHOT"] ?? "20"),
    polygonPrivateKey: process.env["POLYGON_PRIVATE_KEY"],
    polymarketApiKey: process.env["POLYMARKET_API_KEY"],
    polymarketApiSecret: process.env["POLYMARKET_API_SECRET"],
    polymarketApiPassphrase: process.env["POLYMARKET_API_PASSPHRASE"],
  };
}

// NWS grid coordinates + Iowa State CLI station IDs for each city
// polymarketSlug must match what Polymarket uses in their event URLs
export const CITIES: CityConfig[] = [
  {
    name: "New York City",
    slug: "nyc",
    polymarketSlug: "nyc",
    lat: 40.7128,
    lon: -74.006,
    nwsGridId: "OKX",
    nwsGridX: 33,
    nwsGridY: 37,
    iowaStation: "KNYC",
  },
  {
    name: "Chicago",
    slug: "chicago",
    polymarketSlug: "chicago",
    lat: 41.8781,
    lon: -87.6298,
    nwsGridId: "LOT",
    nwsGridX: 76,
    nwsGridY: 73,
    iowaStation: "KORD",
  },
  {
    name: "Miami",
    slug: "miami",
    polymarketSlug: "miami",
    lat: 25.7617,
    lon: -80.1918,
    nwsGridId: "MFL",
    nwsGridX: 76,
    nwsGridY: 50,
    iowaStation: "KMIA",
  },
  {
    name: "Atlanta",
    slug: "atlanta",
    polymarketSlug: "atlanta",
    lat: 33.749,
    lon: -84.388,
    nwsGridId: "FFC",
    nwsGridX: 52,
    nwsGridY: 88,
    iowaStation: "KATL",
  },
  {
    name: "Seattle",
    slug: "seattle",
    polymarketSlug: "seattle",
    lat: 47.6062,
    lon: -122.3321,
    nwsGridId: "SEW",
    nwsGridX: 124,
    nwsGridY: 67,
    iowaStation: "KSEA",
  },
  {
    name: "Dallas",
    slug: "dallas",
    polymarketSlug: "dallas",
    lat: 32.7767,
    lon: -96.797,
    nwsGridId: "FWD",
    nwsGridX: 80,
    nwsGridY: 103,
    iowaStation: "KDFW",
  },
];

// Aliases for matching market titles back to city slugs
export const CITY_ALIASES: Record<string, string> = {
  "new york": "nyc",
  "new york city": "nyc",
  nyc: "nyc",
  manhattan: "nyc",
  "central park": "nyc",
  chicago: "chicago",
  "o'hare": "chicago",
  miami: "miami",
  atlanta: "atlanta",
  seattle: "seattle",
  dallas: "dallas",
  dfw: "dallas",
  "fort worth": "dallas",
};
