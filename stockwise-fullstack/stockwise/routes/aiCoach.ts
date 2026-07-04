import express from "express";
import { requireAuth, rateLimit } from "../middleware/auth.js";
import prisma from "../services/db.js";
import {
  askCoach,
  askCoachWithLLM,
  getLessonById,
  getAllLessons,
  getUserProgress,
} from "../services/aiCoachService.js";
import type { CoachContext } from "../services/aiCoachService.js";
import type { MarketData } from "../services/llmService.js";
import { isLLMAvailable, getActiveProvider } from "../services/llmService.js";
import { env } from "../config/env.js";
import logger from "../services/logger.js";

const router = express.Router();

// CoinGecko IDs for our supported assets
const ASSET_IDS = [
  "bitcoin",
  "ethereum",
  "solana",
  "binancecoin",
  "cardano",
  "ripple",
  "polkadot",
  "dogecoin",
  "avalanche-2",
  "uniswap",
  "chainlink",
  "shiba-inu",
].join(",");

const SYMBOL_MAP: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
  solana: "SOL",
  binancecoin: "BNB",
  cardano: "ADA",
  ripple: "XRP",
  polkadot: "DOT",
  dogecoin: "DOGE",
  "avalanche-2": "AVAX",
  uniswap: "UNI",
  chainlink: "LINK",
  "shiba-inu": "SHIB",
};

// Cache market data for 60 seconds to avoid hitting CoinGecko rate limits
let marketCache: MarketData[] = [];
let marketCacheTime = 0;
const MARKET_CACHE_TTL = 60_000;

async function fetchMarketData(): Promise<MarketData[]> {
  const now = Date.now();
  if (marketCache.length > 0 && now - marketCacheTime < MARKET_CACHE_TTL) {
    return marketCache;
  }

  try {
    const key = env.COINGECKO_API_KEY || "";
    const isDemo = key.startsWith("CG-") || !key;
    const baseUrl = isDemo ? "https://api.coingecko.com" : "https://pro-api.coingecko.com";
    const authHeader = isDemo ? "x-cg-demo-api-key" : "x-cg-pro-api-key";

    const url = `${baseUrl}/api/v3/simple/price?ids=${ASSET_IDS}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`;
    const headers: Record<string, string> = {};
    if (key) headers[authHeader] = key;

    const resp = await fetch(url, { headers });
    if (!resp.ok) return marketCache.length > 0 ? marketCache : [];

    const data = await resp.json();
    const result: MarketData[] = [];

    for (const [cgId, info] of Object.entries(data as Record<string, any>)) {
      const sym = SYMBOL_MAP[cgId] || cgId.toUpperCase();
      result.push({
        symbol: sym,
        name: cgId.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        priceUsd: info.usd || 0,
        change24h: info.usd_24h_change || 0,
        volume24h: info.usd_24h_vol || 0,
        marketCap: info.usd_market_cap || 0,
      });
    }

    if (result.length > 0) {
      marketCache = result;
      marketCacheTime = now;
    }
    return result;
  } catch (err) {
    console.error("Failed to fetch market data for coach:", err);
    return marketCache.length > 0 ? marketCache : [];
  }
}

// POST /coach/ask — works with or without login
router.post("/ask", rateLimit({ windowMs: 60000, max: 60 }), async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    let context: CoachContext;

    if (req.session?.userId) {
      const userId = req.session.userId;
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { demo_balance: true, trader_xp: true, trader_level: true },
      });
      if (!user) return res.status(404).json({ error: "User not found" });

      const completedLessons = await prisma.userLearning.findMany({
        where: { user_id: userId },
        select: { lesson_id: true },
      });

      const portfolio = await prisma.demoPortfolio.findMany({
        where: { user_id: userId, quantity: { gt: 0 } },
      });

      const activeBots = await prisma.demoBot.count({
        where: { user_id: userId, status: "active" },
      });

      const portfolioValue = portfolio.reduce(
        (sum, p) => sum + p.quantity * p.avg_buy_price,
        0,
      );

      context = {
        userId,
        completedLessons: completedLessons.map((l) => l.lesson_id),
        activeBotsCount: activeBots,
        portfolioValue,
        balance: user.demo_balance ?? 10000,
        level: user.trader_level ?? "Novice",
        xp: user.trader_xp ?? 0,
      };
    } else {
      context = {
        completedLessons: [],
        activeBotsCount: 0,
        portfolioValue: 0,
        balance: 10000,
        level: "Novice",
        xp: 0,
      };
    }

    // Use LLM-powered coach if available, otherwise fall back to rule-based
    let response;
    const llmAvailable = isLLMAvailable();
    logger.info({ llmAvailable }, "[Coach Route] LLM availability check");

    if (llmAvailable) {
      const marketData = await fetchMarketData();
      logger.info({ count: marketData.length }, "[Coach Route] Market data fetched");
      response = await askCoachWithLLM(message.trim(), context, marketData);
    } else {
      response = askCoach(message.trim(), context);
      logger.info("[Coach Route] Using rule-based only (LLM not available)");
    }

    return res.json(response);
  } catch (e) {
    logger.error({ err: e }, "Coach error");
    return res.status(500).json({ error: "Coach service error" });
  }
});

// GET /coach/progress
router.get("/progress", requireAuth, async (req, res) => {
  try {
    const userId = req.session.userId!;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { trader_xp: true, trader_level: true },
    });
    if (!user) return res.status(404).json({ error: "User not found" });

    const completedLessons = await prisma.userLearning.findMany({
      where: { user_id: userId },
      select: { lesson_id: true },
    });

    const progress = getUserProgress({
      userId,
      completedLessons: completedLessons.map((l) => l.lesson_id),
      activeBotsCount: 0,
      portfolioValue: 0,
      balance: 0,
      level: user.trader_level ?? "Novice",
      xp: user.trader_xp ?? 0,
    });

    return res.json(progress);
  } catch (e) {
    console.error("Progress error:", e);
    return res.status(500).json({ error: "Database error" });
  }
});

// GET /coach/lessons — open access (static content)
router.get("/lessons", (_req, res) => {
  return res.json(getAllLessons());
});

// GET /coach/lessons/:id — open access (static content)
router.get("/lessons/:id", (req, res) => {
  const lesson = getLessonById(String(req.params.id));
  if (!lesson) return res.status(404).json({ error: "Lesson not found" });
  return res.json(lesson);
});

// GET /coach/llm-status — check if LLM is configured
router.get("/llm-status", (_req, res) => {
  return res.json({ available: isLLMAvailable(), provider: getActiveProvider() });
});

export default router;
