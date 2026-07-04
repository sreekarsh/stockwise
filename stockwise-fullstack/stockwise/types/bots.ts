export enum BotStrategy {
  RSI_BOT = "RSI_BOT",
  MACD_BOT = "MACD_BOT",
  GRID_BOT = "GRID_BOT",
  BB_BOT = "BB_BOT",
  EMA_BOT = "EMA_BOT",
}

export enum BotStatus {
  ACTIVE = "active",
  PAUSED = "paused",
}

export enum TradeSignal {
  BUY = "BUY",
  SELL = "SELL",
  HOLD = "HOLD",
}

export interface RsiParams {
  buy_threshold: number;
  sell_threshold: number;
}

export interface MacdParams {
  // MACD has no configurable params currently
}

export interface GridParams {
  grid_percent: number;
  baseline_price?: number;
}

export interface BbParams {
  bb_stddev: number;
  squeeze_sensitivity: number;
}

export interface EmaParams {
  fast_period: number;
  slow_period: number;
}

export type StrategyParams = RsiParams | MacdParams | GridParams | BbParams | EmaParams;

export type StrategyParamMap = {
  [BotStrategy.RSI_BOT]: RsiParams;
  [BotStrategy.MACD_BOT]: MacdParams;
  [BotStrategy.GRID_BOT]: GridParams;
  [BotStrategy.BB_BOT]: BbParams;
  [BotStrategy.EMA_BOT]: EmaParams;
};

export interface SignalCoin {
  sym: string;
  name: string;
  basePrice: number;
  beta: number;
  mcap: string;
}

export interface FeatureDriver {
  name: string;
  pct: number;
}

export interface Signal {
  rank: number;
  sym: string;
  name: string;
  basePrice: number;
  mcap: string;
  signal: TradeSignal;
  signalPct: number;
  pct: string;
  pctRaw: number;
  pctType: "pos" | "neg" | "neu";
  conf: number;
  votes: string;
  rangeMin: string;
  rangeMax: string;
  rangePos: number;
  entry: string;
  target: string;
  stop: string;
  tDelta: string;
  sDelta: string;
  tType: string;
  sType: string;
  vol: string;
  rr: string;
  rrVal: number;
  beta: string;
  drivers: FeatureDriver[];
  updated: string;
  mins: number;
  version: string;
}

export interface BotConfig {
  id: number;
  userId: number;
  name: string;
  strategy: BotStrategy;
  symbol: string;
  status: BotStatus;
  parameters: StrategyParams;
}

export interface TradeResult {
  side: TradeSignal;
  symbol: string;
  quantity: number;
  price: number;
  value: number;
}

export interface StrategyEvaluation {
  decision: TradeSignal;
  triggerMessage: string;
}
