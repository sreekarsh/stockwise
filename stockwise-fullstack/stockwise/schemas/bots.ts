import { z } from "zod";

export const SignalType = z.enum(["BUY", "SELL", "HOLD"]);
export type SignalType = z.infer<typeof SignalType>;

export const BotStrategyEnum = z.enum(["RSI_BOT", "MACD_BOT", "GRID_BOT", "BB_BOT", "EMA_BOT"]);
export type BotStrategyEnum = z.infer<typeof BotStrategyEnum>;

export const BotStatusEnum = z.enum(["active", "paused"]);
export type BotStatusEnum = z.infer<typeof BotStatusEnum>;

export const TradeType = z.enum(["BUY", "SELL"]);
export type TradeType = z.infer<typeof TradeType>;

export const tradeSchema = z.object({
  symbol: z.string().min(1).max(20),
  type: TradeType,
  quantity: z.union([z.number(), z.string()]).transform(Number),
  price: z.union([z.number(), z.string()]).transform(Number),
});

const rsiParamsSchema = z.object({
  buy_threshold: z.number().min(1).max(99).default(35),
  sell_threshold: z.number().min(1).max(99).default(65),
});

const gridParamsSchema = z.object({
  grid_percent: z.number().min(0.1).max(50).default(1.5),
  baseline_price: z.number().optional(),
});

const macdParamsSchema = z.object({}).default({});

const bbParamsSchema = z.object({
  bb_stddev: z.number().min(1).max(4).default(2),
  squeeze_sensitivity: z.number().min(0.1).max(2).default(0.5),
});

const emaParamsSchema = z.object({
  fast_period: z.number().min(3).max(50).default(9),
  slow_period: z.number().min(10).max(200).default(21),
});

export const botCreateSchema = z.discriminatedUnion("strategy", [
  z.object({
    name: z.string().min(1).max(100),
    strategy: z.literal("RSI_BOT"),
    symbol: z.string().min(1).max(20),
    parameters: rsiParamsSchema.optional().default({ buy_threshold: 35, sell_threshold: 65 }),
  }),
  z.object({
    name: z.string().min(1).max(100),
    strategy: z.literal("MACD_BOT"),
    symbol: z.string().min(1).max(20),
    parameters: macdParamsSchema,
  }),
  z.object({
    name: z.string().min(1).max(100),
    strategy: z.literal("GRID_BOT"),
    symbol: z.string().min(1).max(20),
    parameters: gridParamsSchema.optional().default({ grid_percent: 1.5 }),
  }),
  z.object({
    name: z.string().min(1).max(100),
    strategy: z.literal("BB_BOT"),
    symbol: z.string().min(1).max(20),
    parameters: bbParamsSchema.optional().default({ bb_stddev: 2, squeeze_sensitivity: 0.5 }),
  }),
  z.object({
    name: z.string().min(1).max(100),
    strategy: z.literal("EMA_BOT"),
    symbol: z.string().min(1).max(20),
    parameters: emaParamsSchema.optional().default({ fast_period: 9, slow_period: 21 }),
  }),
]);

export const botToggleSchema = z.object({
  botId: z.union([z.number(), z.string()]).transform(Number),
  status: BotStatusEnum,
});

export const botDeleteSchema = z.object({
  botId: z.union([z.number(), z.string()]).transform(Number),
});

export const academyCompleteSchema = z.object({
  lessonId: z.string().min(1),
  xpReward: z
    .union([z.number(), z.string()])
    .transform(Number)
    .optional()
    .default(50),
});

export type BotCreateInput = z.infer<typeof botCreateSchema>;
