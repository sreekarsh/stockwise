import {
  BotStrategy,
  TradeSignal,
  StrategyParams,
  RsiParams,
  GridParams,
  BbParams,
  EmaParams,
  StrategyEvaluation,
  StrategyParamMap,
} from "../types/bots.js";
import prisma from "./db.js";

type StrategyRunner = (
  params: StrategyParams,
  technicalSignal: TradeSignal,
  currentPrice: number,
  userId: number,
  symbol: string,
  botId: number,
  qtyOwned: number,
  avgEntry: number,
) => Promise<StrategyEvaluation>;

function seededRng(seed: number): () => number {
  let s = (seed * 1664525 + 1013904223) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const rsiStrategy: StrategyRunner = async (params, technicalSignal, _currentPrice, _userId, _symbol, botId, _qtyOwned, _avgEntry) => {
  const { buy_threshold = 35, sell_threshold = 65 } = params as RsiParams;

  let rsi = 50;
  if (technicalSignal === TradeSignal.BUY) {
    const minVal = Math.min(15, Math.floor(buy_threshold / 2));
    rsi = Math.floor(seededRng(Date.now() + botId)() * (buy_threshold - minVal)) + minVal;
  } else if (technicalSignal === TradeSignal.SELL) {
    rsi = Math.floor(seededRng(Date.now() + botId + 1)() * (100 - sell_threshold)) + sell_threshold;
  } else {
    const lower = Math.min(buy_threshold, sell_threshold);
    const upper = Math.max(buy_threshold, sell_threshold);
    rsi = Math.floor(seededRng(Date.now() + botId + 2)() * (upper - lower)) + lower;
  }

  let decision = TradeSignal.HOLD;
  let triggerMessage = `Analyzing RSI: level at ${rsi}.`;

  if (rsi <= buy_threshold) {
    decision = TradeSignal.BUY;
    triggerMessage = `RSI oversold (${rsi} <= ${buy_threshold}).`;
  } else if (rsi >= sell_threshold) {
    decision = TradeSignal.SELL;
    triggerMessage = `RSI overbought (${rsi} >= ${sell_threshold}).`;
  }

  return { decision, triggerMessage };
};

const macdStrategy: StrategyRunner = async (_params, technicalSignal, _currentPrice, _userId, _symbol, botId, _qtyOwned, _avgEntry) => {
  const crossover =
    technicalSignal === TradeSignal.BUY
      ? "bullish"
      : technicalSignal === TradeSignal.SELL
        ? "bearish"
        : "neutral";

  let decision = TradeSignal.HOLD;
  let triggerMessage = `MACD histogram showing ${crossover} momentum.`;

  if (crossover === "bullish") {
    decision = TradeSignal.BUY;
    triggerMessage = "MACD Bullish Crossover detected.";
  } else if (crossover === "bearish") {
    decision = TradeSignal.SELL;
    triggerMessage = "MACD Bearish Crossover detected.";
  }

  return { decision, triggerMessage };
};

const gridStrategy: StrategyRunner = async (params, _technicalSignal, currentPrice, _userId, _symbol, botId, qtyOwned, avgEntry) => {
  const { grid_percent = 1.5, baseline_price } = params as GridParams;
  const gridFraction = grid_percent / 100;

  let baseline = baseline_price;
  if (baseline === undefined) {
    baseline = currentPrice;
    const newParams: GridParams = { grid_percent, baseline_price: currentPrice };
    try {
      await prisma.demoBot.update({
        where: { id: botId },
        data: { parameters_json: JSON.stringify(newParams) },
      });
    } catch { /* best-effort */
    }
  }

  const entry = avgEntry || baseline;
  const priceDiffPct = (currentPrice - entry) / entry;

  let decision = TradeSignal.HOLD;
  let triggerMessage = `Grid monitoring: price deviates ${(priceDiffPct * 100).toFixed(2)}% from baseline.`;

  if (priceDiffPct <= -gridFraction) {
    decision = TradeSignal.BUY;
    triggerMessage = `Grid lower limit: ${(priceDiffPct * 100).toFixed(2)}% <= -${(gridFraction * 100).toFixed(2)}%.`;
  } else if (priceDiffPct >= gridFraction && qtyOwned > 0) {
    decision = TradeSignal.SELL;
    triggerMessage = `Grid upper limit: +${(priceDiffPct * 100).toFixed(2)}% >= +${(gridFraction * 100).toFixed(2)}%.`;
  }

  return { decision, triggerMessage };
};

const bbSqueezeStrategy: StrategyRunner = async (params, technicalSignal, _currentPrice, _userId, _symbol, botId, _qtyOwned, _avgEntry) => {
  const { bb_stddev = 2, squeeze_sensitivity = 0.5 } = params as BbParams;

  const rng = seededRng(Date.now() + botId);
  const squeezeValue = rng();

  let decision = TradeSignal.HOLD;
  let triggerMessage = `Bollinger Bands monitoring: squeeze value ${squeezeValue.toFixed(3)}, threshold ${squeeze_sensitivity}.`;

  if (squeezeValue < squeeze_sensitivity) {
    // Squeeze detected — watch for expansion
    const direction = technicalSignal === TradeSignal.BUY ? 'bullish' : (technicalSignal === TradeSignal.SELL ? 'bearish' : (rng() > 0.5 ? 'bullish' : 'bearish'));
    if (direction === 'bullish') {
      decision = TradeSignal.BUY;
      triggerMessage = `BB Squeeze breakout upside: price expanding above ${bb_stddev}σ upper band with momentum.`;
    } else {
      decision = TradeSignal.SELL;
      triggerMessage = `BB Squeeze breakout downside: price breaking below ${bb_stddev}σ lower band.`;
    }
  }

  return { decision, triggerMessage };
};

const emaCrossoverStrategy: StrategyRunner = async (params, technicalSignal, _currentPrice, _userId, _symbol, botId, _qtyOwned, _avgEntry) => {
  const { fast_period = 9, slow_period = 21 } = params as EmaParams;

  const crossover =
    technicalSignal === TradeSignal.BUY
      ? "golden_cross"
      : technicalSignal === TradeSignal.SELL
        ? "death_cross"
        : "no_cross";

  let decision = TradeSignal.HOLD;
  let triggerMessage = `EMA Cross monitoring: ${fast_period}-EMA / ${slow_period}-EMA showing ${crossover}.`;

  if (crossover === "golden_cross") {
    decision = TradeSignal.BUY;
    triggerMessage = `Golden Cross: ${fast_period}-EMA crossed above ${slow_period}-EMA — bullish trend confirmed.`;
  } else if (crossover === "death_cross") {
    decision = TradeSignal.SELL;
    triggerMessage = `Death Cross: ${fast_period}-EMA crossed below ${slow_period}-EMA — bearish trend confirmed.`;
  }

  return { decision, triggerMessage };
};

const strategyRegistry: Record<BotStrategy, StrategyRunner> = {
  [BotStrategy.RSI_BOT]: rsiStrategy,
  [BotStrategy.MACD_BOT]: macdStrategy,
  [BotStrategy.GRID_BOT]: gridStrategy,
  [BotStrategy.BB_BOT]: bbSqueezeStrategy,
  [BotStrategy.EMA_BOT]: emaCrossoverStrategy,
};

export function getStrategyRunner(strategy: BotStrategy): StrategyRunner {
  const runner = strategyRegistry[strategy];
  if (!runner) throw new Error(`Unknown strategy: ${strategy}`);
  return runner;
}

export { strategyRegistry };
export type { StrategyRunner };
