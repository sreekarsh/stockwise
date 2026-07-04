import express from "express";
import { requireAuth, rateLimit } from "../middleware/auth.js";
import prisma from "../services/db.js";
import { makeSignals, buildSingleSignal, getCoinBySymbol } from "../services/signals.js";
import { getStrategyRunner } from "../services/strategy.js";
import {
  executeManualTrade,
  executeBotBuy,
  executeBotSell,
} from "../services/trading.js";
import {
  tradeSchema,
  botCreateSchema,
  botToggleSchema,
  botDeleteSchema,
  academyCompleteSchema,
} from "../schemas/bots.js";
import { BotStrategy, TradeSignal } from "../types/bots.js";
import mlService from "../services/mlService.js";
import logger from "../services/logger.js";
import { latestPrices } from "../services/websocketService.js";
import crypto from "crypto";
import {
  trackBotTrade,
  trackBotError,
  trackBotLoop,
  trackBotOverlap,
} from "../services/metrics.js";

const RATE_LIMITS = {
  trade: { windowMs: 60000, max: 30 },
  reset: { windowMs: 60000, max: 5 },
  createBot: { windowMs: 60000, max: 10 },
  toggleBot: { windowMs: 60000, max: 20 },
  deleteBot: { windowMs: 60000, max: 10 },
  academy: { windowMs: 60000, max: 20 },
} as const;

const MAX_BOTS_PER_USER = 5;
const BOT_SIMULATION_INTERVAL_MS = 30000;
const MAX_KEEP_LOGS = 50;
const MAX_BOTS_PER_HOUR = 3;
const BOT_LOOP_BATCH_SIZE = 20;
const MAX_CONSECUTIVE_FAILURES = 10;

let _botLoopRunning = false;
let _botLoopFailures = 0;
let _simulationPaused = false;
let _botLoopTimer: NodeJS.Timeout | null = null;

const idempotencyStore = new Map<string, { status: number; body: any; ts: number }>();
const IDEMPOTENCY_TTL = 86_400_000;
const botCreationTracker = new Map<number, number[]>();

setInterval(() => {
  const now = Date.now();
  for (const [key, record] of idempotencyStore) {
    if (now - record.ts > IDEMPOTENCY_TTL) idempotencyStore.delete(key);
  }
  for (const [userId, timestamps] of botCreationTracker) {
    const recent = timestamps.filter(t => now - t < 3_600_000);
    if (recent.length === 0) botCreationTracker.delete(userId);
    else botCreationTracker.set(userId, recent);
  }
}, 60_000).unref();

function checkIdempotency(req: any, res: any, next: any) {
  const key = req.headers["idempotency-key"] as string;
  if (!key) return next();
  const existing = idempotencyStore.get(key);
  if (existing) {
    return res.status(existing.status).json(existing.body);
  }
  const originalJson = res.json.bind(res);
  res.json = function (body: any) {
    idempotencyStore.set(key, { status: res.statusCode, body, ts: Date.now() });
    return originalJson(body);
  };
  next();
}

async function getMlSignalForSymbol(symbol: string): Promise<{
  signal: TradeSignal;
  price: number;
  confidence: number;
} | null> {
  try {
    const wsPrice = latestPrices?.[symbol.toUpperCase()];
    const currentPrice = wsPrice?.price;

    if (!currentPrice || !mlService.isMlReady()) {
      return null;
    }

    const healthy = await mlService.mlHealthy();
    if (!healthy) {
      return null;
    }

    // Build a minimal snapshot for the ML predict endpoint
    const snapshot = {
      symbol: symbol.toLowerCase(),
      prices: [currentPrice],
      highs: [currentPrice * 1.01],
      lows: [currentPrice * 0.99],
      opens: [currentPrice],
      sentiment_score: 0.5,
      forecast_hours: 4,
      price_now: currentPrice,
      change_24h: 0,
      updated_at: Date.now(),
    };

    const correlationId = crypto.randomUUID();
    const result = await mlService.mlFetch(
      "/api/ml/predict",
      {
        method: "POST",
        body: JSON.stringify(snapshot),
      },
      correlationId,
      5000
    );

    if (result && result.signal && result.trading_plan?.entry) {
      const mlSignal = result.signal === "BUY" ? TradeSignal.BUY
        : result.signal === "SELL" ? TradeSignal.SELL
        : TradeSignal.HOLD;
      return {
        signal: mlSignal,
        price: result.trading_plan.entry,
        confidence: result.confidence ?? 0,
      };
    }
    return null;
  } catch (e) {
    logger.debug({ err: e, symbol }, "ML signal fetch failed, falling back to PRNG");
    return null;
  }
}

function asError(e: unknown): Error {
  return e instanceof Error ? e : new Error(String(e));
}

export default function botsFactory(_db: any) {
  const router = express.Router();

  const accountRL = rateLimit({ windowMs: 60000, max: 30 });
  const botsRL = rateLimit({ windowMs: 60000, max: 30 });

  // GET /account
  router.get("/account", accountRL, requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { demo_balance: true, trader_xp: true, trader_level: true },
      });
      if (!user) return res.status(404).json({ error: "User not found" });

      const portfolio = await prisma.demoPortfolio.findMany({
        where: { user_id: userId, quantity: { gt: 0 } },
      });
      const trades = await prisma.demoTrade.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
        take: 50,
      });
      const completedLessons = await prisma.userLearning.findMany({
        where: { user_id: userId },
        select: { lesson_id: true },
      });

      return res.json({
        balance: user.demo_balance ?? 10000.0,
        xp: user.trader_xp ?? 0,
        level: user.trader_level ?? "Novice",
        portfolio,
        trades: trades.map((t) => ({
          symbol: t.symbol,
          type: t.type,
          quantity: t.quantity,
          price: t.price,
          created_at: t.created_at.toISOString(),
        })),
        completedLessons: completedLessons.map((l) => l.lesson_id),
      });
    } catch (e) {
      console.error("Error fetching demo account:", e);
      return res.status(500).json({ error: "Database error" });
    }
  });

  // POST /trade
  router.post(
    "/trade",
    rateLimit(RATE_LIMITS.trade),
    requireAuth,
    checkIdempotency,
    async (req, res) => {
      const parsed = tradeSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid trade data", details: parsed.error.issues });
      }
      const { symbol, type, quantity, price } = parsed.data;
      const sym = symbol.toUpperCase().trim();

      try {
        await executeManualTrade(req.session.userId!, sym, type as TradeSignal, quantity, price);
        return res.json({ success: true, message: "Trade executed successfully" });
      } catch (e) {
        const msg = asError(e).message;
        return res.status(400).json({ error: msg || "Trade execution failed" });
      }
    },
  );

  // POST /reset
  router.post(
    "/reset",
    rateLimit(RATE_LIMITS.reset),
    requireAuth,
    async (req, res) => {
      const userId = req.session.userId!;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: userId },
            data: { demo_balance: 10000.0 },
          });
          await tx.demoPortfolio.deleteMany({ where: { user_id: userId } });
          await tx.demoTrade.deleteMany({ where: { user_id: userId } });
          await tx.demoBot.deleteMany({ where: { user_id: userId } });
        });
        return res.json({
          success: true,
          message: "Demo account reset to $10,000 USDT",
        });
      } catch (e) {
        console.error("Error resetting demo account:", e);
        return res.status(500).json({ error: "Failed to reset demo account" });
      }
    },
  );

  // GET /bots
  router.get("/bots", botsRL, requireAuth, async (req, res) => {
    try {
      const bots = await prisma.demoBot.findMany({
        where: { user_id: req.session.userId! },
      });
      return res.json(bots);
    } catch (e) {
      return res.status(500).json({ error: "Database error" });
    }
  });

  // POST /bots/create
  router.post(
    "/bots/create",
    rateLimit(RATE_LIMITS.createBot),
    requireAuth,
    checkIdempotency,
    async (req, res) => {
      const parsed = botCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid bot data", details: parsed.error.issues });
      }
      const { name, strategy, symbol, parameters } = parsed.data;
      const userId = req.session.userId!;
      const sym = symbol.toUpperCase().trim();

      try {
        const now = Date.now();
        const userCreations = botCreationTracker.get(userId) || [];
        const recentCreations = userCreations.filter(t => now - t < 3_600_000);
        if (recentCreations.length >= MAX_BOTS_PER_HOUR) {
          return res.status(429).json({
            error: `Rate limit: maximum ${MAX_BOTS_PER_HOUR} bot creations per hour.`,
          });
        }
        recentCreations.push(now);
        botCreationTracker.set(userId, recentCreations);

        const activeCount = await prisma.demoBot.count({ where: { user_id: userId } });
        if (activeCount >= MAX_BOTS_PER_USER) {
          return res.status(400).json({
            error: `Maximum limit of ${MAX_BOTS_PER_USER} simulated bots reached. Delete an existing bot first.`,
          });
        }

        const bot = await prisma.demoBot.create({
          data: {
            user_id: userId,
            name,
            strategy,
            symbol: sym,
            status: "active",
            parameters_json: JSON.stringify(parameters ?? {}),
            logs: {
              create: {
                message: `Bot ${name} initialized. Strategy: ${strategy}. Trading: ${sym}/USDT.`,
              },
            },
          },
        });

        return res.json({ success: true, botId: bot.id });
      } catch (e) {
        return res.status(500).json({ error: "Database error" });
      }
    },
  );

  // POST /bots/toggle
  router.post(
    "/bots/toggle",
    rateLimit(RATE_LIMITS.toggleBot),
    requireAuth,
    checkIdempotency,
    async (req, res) => {
      const parsed = botToggleSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }
      const { botId, status } = parsed.data;
      const userId = req.session.userId!;

      try {
        const bot = await prisma.demoBot.findFirst({
          where: { id: Number(botId), user_id: userId },
        });
        if (!bot) return res.status(404).json({ error: "Bot not found" });

        await prisma.$transaction([
          prisma.demoBot.update({
            where: { id: bot.id },
            data: { status },
          }),
          prisma.demoBotLog.create({
            data: {
              bot_id: bot.id,
              message: `Bot status updated to: ${status.toUpperCase()}`,
            },
          }),
        ]);
        return res.json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: "Database error" });
      }
    },
  );

  // POST /bots/delete
  router.post(
    "/bots/delete",
    rateLimit(RATE_LIMITS.deleteBot),
    requireAuth,
    checkIdempotency,
    async (req, res) => {
      const parsed = botDeleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }
      const { botId } = parsed.data;
      const userId = req.session.userId!;

      try {
        const bot = await prisma.demoBot.findFirst({
          where: { id: Number(botId), user_id: userId },
        });
        if (!bot) return res.status(404).json({ error: "Bot not found" });

        await prisma.demoBot.delete({ where: { id: bot.id } });
        return res.json({ success: true });
      } catch (e) {
        return res.status(500).json({ error: "Database error" });
      }
    },
  );

  // GET /bots/logs
  router.get("/bots/logs", requireAuth, async (req, res) => {
    const rawBotId = req.query.botId;
    if (!rawBotId) return res.status(400).json({ error: "Bot ID is required" });
    const botId = Number(rawBotId);
    if (!Number.isFinite(botId) || botId <= 0) {
      return res.status(400).json({ error: "Invalid Bot ID" });
    }

    try {
      const logs = await prisma.demoBotLog.findMany({
        where: { bot_id: botId },
        orderBy: { created_at: "desc" },
        take: MAX_KEEP_LOGS,
      });
      return res.json(
        logs.map((l) => ({
          message: l.message,
          created_at: l.created_at.toISOString(),
        })),
      );
    } catch (e) {
      return res.status(500).json({ error: "Database error" });
    }
  });

  // POST /academy/complete
  router.post(
    "/academy/complete",
    rateLimit(RATE_LIMITS.academy),
    async (req, res) => {
      const parsed = academyCompleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
      }
      const { lessonId, xpReward: xp } = parsed.data;

      // If not logged in, return success without saving
      if (!req.session || !req.session.userId) {
        return res.json({
          success: true,
          guest: true,
          message: `Completed! Earned ${xp} XP.`,
        });
      }

      const userId = req.session.userId;

      try {
        const existing = await prisma.userLearning.findUnique({
          where: { user_id_lesson_id: { user_id: userId, lesson_id: lessonId } },
        });
        if (existing) {
          return res.json({ success: true, message: "Lesson already completed", levelUp: false });
        }

        const updatedUser = await prisma.$transaction(async (tx) => {
          await tx.userLearning.create({
            data: { user_id: userId, lesson_id: lessonId },
          });
          await tx.user.update({
            where: { id: userId },
            data: { trader_xp: { increment: xp } },
          });

          const user = await tx.user.findUnique({
            where: { id: userId },
            select: { trader_xp: true },
          });
          const totalXp = user!.trader_xp ?? 0;
          let newLevel = "Novice";
          if (totalXp >= 1000) newLevel = "Master";
          else if (totalXp >= 600) newLevel = "Pro";
          else if (totalXp >= 300) newLevel = "Intermediate";
          else if (totalXp >= 100) newLevel = "Apprentice";

          return await tx.user.update({
            where: { id: userId },
            data: { trader_level: newLevel },
            select: { trader_xp: true, trader_level: true },
          });
        });

        return res.json({
          success: true,
          xp: updatedUser.trader_xp,
          level: updatedUser.trader_level,
          message: `Completed! Earned ${xp} XP.`,
        });
      } catch (e) {
        console.error("Error completing lesson:", e);
        return res.status(500).json({ error: "Database error" });
      }
    },
  );

  // ─── BOT SIMULATION LOOP ──────────────────────────────────────────

  async function pruneLogs(botId: number): Promise<void> {
    const keepLogs = await prisma.demoBotLog.findMany({
      where: { bot_id: botId },
      select: { id: true },
      orderBy: { id: "desc" },
      take: MAX_KEEP_LOGS,
    });
    if (keepLogs.length > 0) {
      const keepIds = keepLogs.map((l) => l.id);
      await prisma.demoBotLog.deleteMany({
        where: { bot_id: botId, id: { notIn: keepIds } },
      });
    }
  }

  async function evaluateBot(bot: {
    id: number;
    user_id: number;
    symbol: string;
    strategy: string;
    parameters_json: unknown;
  }): Promise<void> {
    const botId = bot.id;
    const userId = bot.user_id;
    const symbol = bot.symbol.toUpperCase().trim();
    const strategy = bot.strategy as BotStrategy;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { demo_balance: true },
    });
    if (!user) return;

    const holding = await prisma.demoPortfolio.findUnique({
      where: { user_id_symbol: { user_id: userId, symbol } },
    });
    const qtyOwned = holding ? holding.quantity : 0;
    const avgEntry = holding ? holding.avg_buy_price : 0;

    // Try ML engine first, fall back to PRNG-based signals
    const mlSignal = await getMlSignalForSymbol(symbol);
    let currentPrice: number;
    let technicalSignal: TradeSignal;

    if (mlSignal) {
      currentPrice = mlSignal.price;
      technicalSignal = mlSignal.signal;
      logger.debug({ symbol, signal: technicalSignal, confidence: mlSignal.confidence }, "Using ML signal for bot");
    } else {
      const coinData = getCoinBySymbol(symbol);
      const signalData = coinData ? buildSingleSignal(symbol, 0) : buildSingleSignal("BTC", 0);
      currentPrice = signalData.basePrice;
      technicalSignal = signalData.signal;
    }

    const runner = getStrategyRunner(strategy);
    let params: Record<string, unknown> = {};
    if (typeof bot.parameters_json === "string") {
      try { params = JSON.parse(bot.parameters_json); } catch { /* ignore */ }
    }

    const { decision, triggerMessage } = await runner(
      params as any,
      technicalSignal,
      currentPrice,
      userId,
      symbol,
      botId,
      qtyOwned,
      avgEntry,
    );

    if (decision === TradeSignal.BUY) {
      await executeBotBuy(userId, symbol, botId, currentPrice, triggerMessage);
      trackBotTrade("BUY", symbol);
    } else if (decision === TradeSignal.SELL && qtyOwned > 0.00001) {
      await executeBotSell(userId, symbol, botId, currentPrice, triggerMessage, strategy, qtyOwned);
      trackBotTrade("SELL", symbol);
    } else {
      await prisma.demoBotLog.create({
        data: { bot_id: botId, message: `\u26AA MONITOR: ${triggerMessage} Standby.` },
      });
    }

    await pruneLogs(botId);
  }

  async function runActiveBots(): Promise<void> {
    if (_simulationPaused) return;
    if (_botLoopRunning) {
      logger.warn("Bot loop overlap detected — skipping this cycle");
      trackBotOverlap();
      return;
    }
    if (_botLoopFailures >= MAX_CONSECUTIVE_FAILURES) {
      logger.error({ failures: _botLoopFailures }, "Bot loop circuit breaker tripped — pausing simulation");
      _simulationPaused = true;
      return;
    }

    _botLoopRunning = true;
    trackBotLoop();
    try {
      const totalBots = await prisma.demoBot.count({ where: { status: "active" } });
      if (totalBots === 0) return;

      let processed = 0;
      let cursor: number | undefined;
      while (processed < totalBots) {
        const batch = await prisma.demoBot.findMany({
          where: { status: "active" },
          orderBy: { id: "asc" },
          take: BOT_LOOP_BATCH_SIZE,
          ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });
        if (batch.length === 0) break;

        for (const bot of batch) {
          try {
            await evaluateBot(bot);
          } catch (e) {
            logger.error({ err: e, botId: bot.id }, "Bot evaluation error");
            trackBotError("evaluation");
          }
        }

        cursor = batch[batch.length - 1].id;
        processed += batch.length;
      }

      _botLoopFailures = 0;
      logger.debug({ processed, total: totalBots }, "Bot loop cycle complete");
    } catch (e) {
      _botLoopFailures++;
      console.error("Error running simulated bots:", e);
    } finally {
      _botLoopRunning = false;
    }
  }

  function scheduleNextRun(): void {
    if (_simulationPaused) return;
    _botLoopTimer = setTimeout(() => {
      runActiveBots().finally(() => scheduleNextRun());
    }, BOT_SIMULATION_INTERVAL_MS);
    if (_botLoopTimer && typeof _botLoopTimer.unref === "function") {
      _botLoopTimer.unref();
    }
  }

  scheduleNextRun();

  function stopSimulation(): void {
    _simulationPaused = true;
    if (_botLoopTimer) {
      clearTimeout(_botLoopTimer);
      _botLoopTimer = null;
    }
    logger.info("Bot simulation stopped");
  }

  function startSimulation(): void {
    if (!_simulationPaused) return;
    _simulationPaused = false;
    _botLoopFailures = 0;
    scheduleNextRun();
    logger.info("Bot simulation started");
  }

  function getSimulationStatus() {
    return {
      running: !_simulationPaused,
      paused: _simulationPaused,
      loopActive: _botLoopRunning,
      consecutiveFailures: _botLoopFailures,
      maxConsecutiveFailures: MAX_CONSECUTIVE_FAILURES,
      intervalMs: BOT_SIMULATION_INTERVAL_MS,
    };
  }

  return {
    router,
    makeSignals,
    runActiveBots,
    stopSimulation,
    startSimulation,
    getSimulationStatus,
  };
}
