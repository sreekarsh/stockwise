import { TradeSignal, Signal, SignalCoin, FeatureDriver } from "../types/bots.js";
import { latestPrices } from "./websocketService.js";

const SIGNAL_COINS: [string, string, number, number, string][] = [
  ["BTC", "Bitcoin", 61585, 0.75, "$1.23T"],
  ["ETH", "Ethereum", 1699.47, 1.15, "$205B"],
  ["BNB", "BNB", 560.5, 1.0, "$75.5B"],
  ["SOL", "Solana", 80.58, 1.55, "$46.8B"],
  ["XRP", "XRP", 1.094, 0.88, "$68B"],
  ["ADA", "Cardano", 0.1601, 0.82, "$5.97B"],
  ["AVAX", "Avalanche", 6.76, 1.42, "$2.92B"],
  ["DOGE", "Dogecoin", 0.0746, 2.05, "$11.6B"],
  ["TON", "Toncoin", 1.67, 1.35, "$4.51B"],
  ["MATIC", "Polygon", 0.0731, 1.48, "$0.78B"],
  ["LINK", "Chainlink", 7.86, 1.22, "$5.88B"],
  ["SHIB", "Shiba Inu", 0.00000432, 2.75, "$2.54B"],
  ["LTC", "Litecoin", 43.49, 0.98, "$3.36B"],
  ["UNI", "Uniswap", 3.2, 1.28, "$1.99B"],
  ["NEAR", "NEAR Protocol", 1.92, 1.32, "$2.49B"],
  ["APT", "Aptos", 0.615, 1.52, "$0.51B"],
  ["ATOM", "Cosmos", 1.56, 1.08, "$0.81B"],
  ["ARB", "Arbitrum", 0.0779, 1.58, "$0.50B"],
  ["OP", "Optimism", 0.0995, 1.48, "$0.21B"],
  ["MANA", "Decentraland", 0.0643, 1.68, "$0.13B"],
  ["EGLD", "MultiversX", 18.5, 1.18, "$0.45B"],
  ["XLM", "Stellar", 0.199, 0.98, "$6.77B"],
  ["NEO", "NEO", 1.96, 1.1, "$0.14B"],
  ["ZEC", "Zcash", 440.67, 1.28, "$7.40B"],
  ["AAVE", "Aave", 86.81, 1.18, "$1.32B"],
];

function seededRng(seed: number): () => number {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function fmtPrice(p: number): string {
  if (p >= 10000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 2 });
  if (p >= 100) return p.toFixed(2);
  if (p >= 1) return p.toFixed(3);
  if (p >= 0.01) return p.toFixed(4);
  if (p >= 0.0001) return p.toFixed(6);
  return p.toFixed(8);
}

function pickSignal(rng: () => number): TradeSignal {
  const v = rng();
  if (v < 0.4) return TradeSignal.BUY;
  if (v < 0.75) return TradeSignal.SELL;
  return TradeSignal.HOLD;
}

function buildSignal(coin: [string, string, number, number, string], idx: number): Signal {
  const [sym, name, defaultBasePrice, beta, mcap] = coin;
  const livePrice = latestPrices?.[sym.toUpperCase()];
  const basePrice: number = livePrice?.price ?? defaultBasePrice;

  const seed = idx * 6791 + idx * idx + 42;
  const signal = pickSignal(seededRng(seed));
  const r = seededRng(seed);
  const conf = Math.floor(r() * 18) + 80;
  const signalPct = Math.floor(r() * 22) + 60;

  let pctRaw: number;
  if (signal === TradeSignal.BUY) pctRaw = (r() * 8 + 0.2) * beta;
  else if (signal === TradeSignal.SELL) pctRaw = -(r() * 8 + 0.2) * beta;
  else pctRaw = (r() * 2 - 1) * beta * 0.5;

  const pctSign = pctRaw >= 0 ? "+" : "";
  const pctType: "pos" | "neg" | "neu" =
    pctRaw > 0.25 ? "pos" : pctRaw < -0.25 ? "neg" : "neu";

  const totalVotes = Math.floor(r() * 80) + 40;
  let buyV: number, sellV: number, holdV: number;
  if (signal === TradeSignal.BUY) {
    buyV = Math.floor(totalVotes * (0.55 + r() * 0.2));
    sellV = Math.floor((totalVotes - buyV) * (0.5 + r() * 0.3));
    holdV = totalVotes - buyV - sellV;
  } else if (signal === TradeSignal.SELL) {
    sellV = Math.floor(totalVotes * (0.55 + r() * 0.2));
    buyV = Math.floor((totalVotes - sellV) * (0.4 + r() * 0.3));
    holdV = totalVotes - sellV - buyV;
  } else {
    holdV = Math.floor(totalVotes * (0.45 + r() * 0.2));
    buyV = Math.floor((totalVotes - holdV) * (0.5 + r() * 0.3));
    sellV = totalVotes - holdV - buyV;
  }

  const spread = basePrice * 0.05 * (0.4 + r() * 0.8);
  const rangeMin = "$" + fmtPrice(basePrice - spread);
  const rangeMax = "$" + fmtPrice(basePrice + spread);
  const rangePos = Math.floor(r() * 55) + 30;

  const entrySlip = r() * 0.008 - 0.004;
  const entry = basePrice * (1 + entrySlip);
  const tpPct = (r() * 4 + 0.8) * beta;
  const slPct = (r() * 2 + 0.4) * beta;
  const rrVal = tpPct / slPct;

  let target: number, stop: number, tDelta: string, sDelta: string, tType: string, sType: string;
  if (signal === TradeSignal.BUY) {
    target = entry * (1 + tpPct / 100);
    stop = entry * (1 - slPct / 100);
    tDelta = `+${tpPct.toFixed(2)}%`;
    sDelta = `-${slPct.toFixed(2)}%`;
    tType = "pos";
    sType = "neg";
  } else if (signal === TradeSignal.SELL) {
    target = entry * (1 - tpPct / 100);
    stop = entry * (1 + slPct / 100);
    tDelta = `-${tpPct.toFixed(2)}%`;
    sDelta = `+${slPct.toFixed(2)}%`;
    tType = "neg";
    sType = "pos";
  } else {
    target = entry * (1 + (tpPct * 0.3) / 100);
    stop = entry * (1 - (slPct * 0.5) / 100);
    tDelta = `+${(tpPct * 0.3).toFixed(2)}%`;
    sDelta = `-${(slPct * 0.5).toFixed(2)}%`;
    tType = "pos";
    sType = "neg";
  }

  const highVol = beta > 1.8 || r() < 0.15;
  const vol = highVol ? "HIGH VOL" : "NORMAL VOL";
  const rr = signal === TradeSignal.HOLD ? "\u2014" : rrVal.toFixed(2) + "X";

  const featureNames = [
    "macd_hist", "rsi_14", "volume_zscore", "ret_1h",
    "mtf_4h_mom", "ema_cross", "bb_width", "obv_delta",
    "vwap_dev", "atr_norm", "stoch_k", "ret_4h",
    "spread_proxy", "regime_flag",
  ];
  const chosen = [...featureNames].sort(() => r() - 0.5);
  let rem = 100;
  const drivers: FeatureDriver[] = chosen.map((name, i) => {
    let pct: number;
    if (i === chosen.length - 1) {
      pct = Math.max(rem, 1);
    } else {
      pct = Math.max(Math.floor(r() * rem * 0.35) + 1, 1);
    }
    rem -= pct;
    return { name, pct };
  });
  if (rem > 0) drivers[0].pct += rem;
  drivers.sort((a, b) => b.pct - a.pct);

  return {
    rank: idx + 1,
    sym,
    name,
    basePrice,
    mcap,
    signal,
    signalPct,
    pct: `${pctSign}${pctRaw.toFixed(2)}% (4H)`,
    pctRaw,
    pctType,
    conf,
    votes: `${buyV} / ${sellV} / ${holdV}`,
    rangeMin,
    rangeMax,
    rangePos,
    entry: fmtPrice(entry),
    target: fmtPrice(target),
    stop: fmtPrice(stop),
    tDelta,
    sDelta,
    tType,
    sType,
    vol,
    rr,
    rrVal: signal === TradeSignal.HOLD ? 0 : rrVal,
    beta: beta.toFixed(2),
    drivers,
    updated: "Just now",
    mins: 0,
    version: "v3.0",
  };
}

export function makeSignals(count = 50): Signal[] {
  const out: Signal[] = [];
  for (let i = 0; i < count; i++) {
    const coin = SIGNAL_COINS[i % SIGNAL_COINS.length];
    out.push(buildSignal(coin, i));
  }
  return out;
}

export function getCoinBySymbol(sym: string): [string, string, number, number, string] | undefined {
  return SIGNAL_COINS.find((c) => c[0] === sym);
}

export function buildSingleSignal(sym: string, idx = 0): Signal {
  const coin = getCoinBySymbol(sym) ?? SIGNAL_COINS[0];
  return buildSignal(coin, idx);
}

export { SIGNAL_COINS };
