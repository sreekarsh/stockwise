import express from "express";
import crypto from "crypto";
import { requireAuth, rateLimit } from "../middleware/auth.js";
import { env } from "../config/env.js";
import prisma from "../services/db.js";
import { decrypt } from "../services/cryptoService.js";
import logger from "../services/logger.js";
import { addHoldingSchema, editHoldingSchema } from "../schemas/portfolio.js";

function safeDecrypt(val: any) {
  if (!val) return "";
  try {
    return decrypt(val);
  } catch {
    console.error("safeDecrypt: decryption failed for a value");
    return "";
  }
}

const COINGECKO_API_KEYS = (env.COINGECKO_API_KEY || "").split(",").map((k: string) => k.trim()).filter(Boolean);
let activeGeckoKeyIndex = 0;
function getCurrentGeckoKey(): string {
  if (COINGECKO_API_KEYS.length === 0) return "";
  if (activeGeckoKeyIndex >= COINGECKO_API_KEYS.length) activeGeckoKeyIndex = 0;
  return COINGECKO_API_KEYS[activeGeckoKeyIndex];
}
function rotateGeckoKey() {
  if (COINGECKO_API_KEYS.length > 1) {
    activeGeckoKeyIndex = (activeGeckoKeyIndex + 1) % COINGECKO_API_KEYS.length;
    logger.info({ keyIndex: activeGeckoKeyIndex + 1, total: COINGECKO_API_KEYS.length }, "[CoinGecko] Rotated key");
  }
}

const CRYPTOCOMPARE_API_KEY = env.CRYPTOCOMPARE_API_KEY;
const NEWSAPI_KEY = env.NEWSAPI_KEY;

// ─── CACHES with TTL + size limit ──────────────────────────────────
const CACHE_MAX_ENTRIES = 200;
function evictStaleCache(cache: any, timeMap: any, ttl: number) {
  const now = Date.now();
  for (const key of Object.keys(cache)) {
    if (now - (timeMap[key] || 0) > ttl) {
      delete cache[key];
      delete timeMap[key];
    }
  }
}
function evictOverflow(cache: any, maxEntries: number) {
  const keys = Object.keys(cache);
  if (keys.length > maxEntries) {
    const toRemove = keys.slice(0, keys.length - maxEntries);
    for (const k of toRemove) delete cache[k];
  }
}

let trendingCache: any = null;
let trendingCacheTime = 0;
let marketsCache: Record<string, any> = {};
let marketsCacheTime: Record<string, number> = {};
let fearGreedCache: any = null;
let fearGreedCacheTime = 0;
let stocksCache: any = null;
let stocksCacheTime = 0;
let coindcxCache: any = null;
let coindcxCacheTime = 0;
let rateCacheTime = 0;
let inrUsdRate = 92.0;

const CACHE_TTL = 300000;
const MARKETS_CACHE_TTL = 8000;
const STOCKS_CACHE_TTL = 30000;
const COINDCX_CACHE_TTL = 5000;

// Periodic cache cleanup every 5 minutes
setInterval(() => {
  evictStaleCache(marketsCache, marketsCacheTime, MARKETS_CACHE_TTL);
  evictOverflow(marketsCache, CACHE_MAX_ENTRIES);
}, 300000).unref();

// Cross-platform timeout-aware AbortSignal helper
function makeTimeoutSignal(ms: number) {
  const ac = new AbortController();
  const t = setTimeout(
    () =>
      ac.abort(
        new DOMException(
          `The operation was aborted due to timeout`,
          "AbortError",
        ),
      ),
    ms,
  );
  t.unref();
  return ac.signal;
}

const STOCK_SYMBOLS = [
  // ── NIFTY 50 ──────────────────────────────────────────────────
  {
    symbol: "RELIANCE",
    name: "Reliance Industries Ltd.",
    base: 2900,
    cat: "nifty50",
  },
  {
    symbol: "TCS",
    name: "Tata Consultancy Services",
    base: 3950,
    cat: "nifty50",
  },
  { symbol: "HDFCBANK", name: "HDFC Bank Ltd.", base: 1740, cat: "nifty50" },
  { symbol: "INFY", name: "Infosys Ltd.", base: 1800, cat: "nifty50" },
  { symbol: "ICICIBANK", name: "ICICI Bank Ltd.", base: 1240, cat: "nifty50" },
  {
    symbol: "HINDUNILVR",
    name: "Hindustan Unilever Ltd.",
    base: 2640,
    cat: "nifty50",
  },
  { symbol: "SBIN", name: "State Bank of India", base: 830, cat: "nifty50" },
  {
    symbol: "BHARTIARTL",
    name: "Bharti Airtel Ltd.",
    base: 1680,
    cat: "nifty50",
  },
  { symbol: "TATAMOTORS", name: "Tata Motors Ltd.", base: 880, cat: "nifty50" },
  {
    symbol: "KOTAKBANK",
    name: "Kotak Mahindra Bank",
    base: 1850,
    cat: "nifty50",
  },
  { symbol: "ITC", name: "ITC Ltd.", base: 455, cat: "nifty50" },
  { symbol: "AXISBANK", name: "Axis Bank Ltd.", base: 1180, cat: "nifty50" },
  { symbol: "LT", name: "Larsen & Toubro Ltd.", base: 3500, cat: "nifty50" },
  { symbol: "JSWSTEEL", name: "JSW Steel Ltd.", base: 850, cat: "nifty50" },
  {
    symbol: "ASIANPAINT",
    name: "Asian Paints Ltd.",
    base: 2950,
    cat: "nifty50",
  },
  { symbol: "NTPC", name: "NTPC Ltd.", base: 330, cat: "nifty50" },
  {
    symbol: "MARUTI",
    name: "Maruti Suzuki India Ltd.",
    base: 12800,
    cat: "nifty50",
  },
  {
    symbol: "NESTLEIND",
    name: "Nestle India Ltd.",
    base: 2280,
    cat: "nifty50",
  },
  {
    symbol: "ONGC",
    name: "Oil & Natural Gas Corp.",
    base: 305,
    cat: "nifty50",
  },
  { symbol: "COALINDIA", name: "Coal India Ltd.", base: 465, cat: "nifty50" },
  {
    symbol: "ULTRACEMCO",
    name: "UltraTech Cement Ltd.",
    base: 11200,
    cat: "nifty50",
  },
  { symbol: "TITAN", name: "Titan Company Ltd.", base: 3200, cat: "nifty50" },
  { symbol: "TATASTEEL", name: "Tata Steel Ltd.", base: 175, cat: "nifty50" },
  {
    symbol: "SUNPHARMA",
    name: "Sun Pharma Advanced",
    base: 1780,
    cat: "nifty50",
  },
  {
    symbol: "DMART",
    name: "Avenue Supermarts Ltd.",
    base: 4280,
    cat: "nifty50",
  },
  { symbol: "WIPRO", name: "Wipro Ltd.", base: 290, cat: "nifty50" },
  {
    symbol: "HCLTECH",
    name: "HCL Technologies Ltd.",
    base: 1750,
    cat: "nifty50",
  },
  { symbol: "SBILIFE", name: "SBI Life Insurance", base: 1650, cat: "nifty50" },
  {
    symbol: "HDFCLIFE",
    name: "HDFC Life Insurance",
    base: 680,
    cat: "nifty50",
  },
  {
    symbol: "POWERGRID",
    name: "Power Grid Corporation",
    base: 320,
    cat: "nifty50",
  },
  { symbol: "CIPLA", name: "Cipla Ltd.", base: 1850, cat: "nifty50" },
  { symbol: "TECHM", name: "Tech Mahindra Ltd.", base: 1780, cat: "nifty50" },
  {
    symbol: "BAJAJFINSV",
    name: "Bajaj Finserv Ltd.",
    base: 1680,
    cat: "nifty50",
  },
  {
    symbol: "BRITANNIA",
    name: "Britannia Industries",
    base: 5350,
    cat: "nifty50",
  },
  {
    symbol: "GODREJCP",
    name: "Godrej Consumer Products",
    base: 1620,
    cat: "nifty50",
  },
  {
    symbol: "PIDILITIND",
    name: "Pidilite Industries",
    base: 3150,
    cat: "nifty50",
  },
  { symbol: "M&M", name: "Mahindra & Mahindra", base: 3120, cat: "nifty50" },
  {
    symbol: "EICHERMOT",
    name: "Eicher Motors Ltd.",
    base: 8350,
    cat: "nifty50",
  },
  {
    symbol: "SHREECEM",
    name: "Shree Cement Ltd.",
    base: 25000,
    cat: "nifty50",
  },
  {
    symbol: "DRREDDY",
    name: "Dr. Reddy's Laboratories",
    base: 1180,
    cat: "nifty50",
  },
  {
    symbol: "INDUSINDBK",
    name: "IndusInd Bank Ltd.",
    base: 580,
    cat: "nifty50",
  },
  { symbol: "IOC", name: "Indian Oil Corporation", base: 145, cat: "nifty50" },
  {
    symbol: "HEROMOTOCO",
    name: "Hero MotoCorp Ltd.",
    base: 6200,
    cat: "nifty50",
  },
  { symbol: "BAJAJ-AUTO", name: "Bajaj Auto Ltd.", base: 9350, cat: "nifty50" },
  {
    symbol: "ADANIPORTS",
    name: "Adani Ports & SEZ",
    base: 1580,
    cat: "nifty50",
  },
  { symbol: "BPCL", name: "Bharat Petroleum", base: 520, cat: "nifty50" },
  {
    symbol: "ADANIENT",
    name: "Adani Enterprises Ltd.",
    base: 2950,
    cat: "nifty50",
  },
  {
    symbol: "BAJFINANCE",
    name: "Bajaj Finance Ltd.",
    base: 7300,
    cat: "nifty50",
  },
  { symbol: "VEDL", name: "Vedanta Ltd.", base: 480, cat: "nifty50" },
  { symbol: "ZOMATO", name: "Zomato Ltd.", base: 245, cat: "nifty50" },

  // ── CRYPTO (For Community Hub) ──────────────────────────────
  { symbol: "BTC", name: "Bitcoin", base: 61585, cat: "crypto" },
  { symbol: "ETH", name: "Ethereum", base: 1699.47, cat: "crypto" },
  { symbol: "SOL", name: "Solana", base: 80.58, cat: "crypto" },
  { symbol: "BNB", name: "Binance Coin", base: 560.5, cat: "crypto" },
  { symbol: "XRP", name: "Ripple", base: 1.094, cat: "crypto" },
  { symbol: "ADA", name: "Cardano", base: 0.1601, cat: "crypto" },
  { symbol: "AVAX", name: "Avalanche", base: 6.76, cat: "crypto" },
  { symbol: "DOGE", name: "Dogecoin", base: 0.0746, cat: "crypto" },
  { symbol: "DOT", name: "Polkadot", base: 0.855, cat: "crypto" },
  { symbol: "LINK", name: "Chainlink", base: 7.86, cat: "crypto" },

  // ── NIFTY NEXT 50 ─────────────────────────────────────────────
  { symbol: "SIEMENS", name: "Siemens Ltd.", base: 7200, cat: "next50" },
  {
    symbol: "AMBUJACEM",
    name: "Ambuja Cements Ltd.",
    base: 620,
    cat: "next50",
  },
  { symbol: "DABUR", name: "Dabur India Ltd.", base: 545, cat: "next50" },
  { symbol: "MARICO", name: "Marico Ltd.", base: 590, cat: "next50" },
  {
    symbol: "MUTHOOTFIN",
    name: "Muthoot Finance Ltd.",
    base: 2050,
    cat: "next50",
  },
  {
    symbol: "NAUKRI",
    name: "Info Edge (India) Ltd.",
    base: 8200,
    cat: "next50",
  },
  { symbol: "HAVELLS", name: "Havells India Ltd.", base: 1720, cat: "next50" },
  {
    symbol: "TORNTPHARM",
    name: "Torrent Pharmaceuticals",
    base: 3400,
    cat: "next50",
  },
  {
    symbol: "INDHOTEL",
    name: "Indian Hotels Co. Ltd.",
    base: 780,
    cat: "next50",
  },
  {
    symbol: "TATACOMM",
    name: "Tata Communications Ltd.",
    base: 1720,
    cat: "next50",
  },
  { symbol: "LUPIN", name: "Lupin Ltd.", base: 2230, cat: "next50" },
  {
    symbol: "AUROPHARMA",
    name: "Aurobindo Pharma Ltd.",
    base: 1300,
    cat: "next50",
  },
  { symbol: "GAIL", name: "GAIL (India) Ltd.", base: 220, cat: "next50" },
  {
    symbol: "INDIGO",
    name: "IndiGo (InterGlobe Aviation)",
    base: 4850,
    cat: "next50",
  },
  { symbol: "BANKBARODA", name: "Bank of Baroda", base: 245, cat: "next50" },
  { symbol: "CANBK", name: "Canara Bank", base: 105, cat: "next50" },
  {
    symbol: "COLPAL",
    name: "Colgate-Palmolive India",
    base: 2800,
    cat: "next50",
  },
  {
    symbol: "BERGEPAINT",
    name: "Berger Paints India",
    base: 560,
    cat: "next50",
  },
  {
    symbol: "ALKEM",
    name: "Alkem Laboratories Ltd.",
    base: 5400,
    cat: "next50",
  },
  { symbol: "GLAND", name: "Gland Pharma Ltd.", base: 1850, cat: "next50" },
  {
    symbol: "TATAPOWER",
    name: "Tata Power Co. Ltd.",
    base: 420,
    cat: "next50",
  },
  {
    symbol: "SAIL",
    name: "Steel Authority of India",
    base: 135,
    cat: "next50",
  },
  { symbol: "PETRONET", name: "Petronet LNG Ltd.", base: 355, cat: "next50" },
  {
    symbol: "CONCOR",
    name: "Container Corp. of India",
    base: 820,
    cat: "next50",
  },
  {
    symbol: "PAGEIND",
    name: "Page Industries Ltd.",
    base: 44000,
    cat: "next50",
  },
  { symbol: "MPHASIS", name: "Mphasis Ltd.", base: 2900, cat: "next50" },
  { symbol: "COFORGE", name: "Coforge Ltd.", base: 7800, cat: "next50" },
  { symbol: "LTI", name: "LTIMindtree Ltd.", base: 5200, cat: "next50" },
  {
    symbol: "PERSISTENT",
    name: "Persistent Systems Ltd.",
    base: 5800,
    cat: "next50",
  },
  { symbol: "POLYCAB", name: "Polycab India Ltd.", base: 6200, cat: "next50" },
  {
    symbol: "ABCAPITAL",
    name: "Aditya Birla Capital Ltd.",
    base: 220,
    cat: "next50",
  },
  { symbol: "FEDERALBNK", name: "Federal Bank Ltd.", base: 198, cat: "next50" },
  {
    symbol: "EXIDEIND",
    name: "Exide Industries Ltd.",
    base: 430,
    cat: "next50",
  },
  {
    symbol: "SUPREMEIND",
    name: "Supreme Industries Ltd.",
    base: 5300,
    cat: "next50",
  },
  { symbol: "TATAELXSI", name: "Tata Elxsi Ltd.", base: 7200, cat: "next50" },
  { symbol: "LAURUSLABS", name: "Laurus Labs Ltd.", base: 560, cat: "next50" },
  {
    symbol: "STARHEALTH",
    name: "Star Health Insurance",
    base: 590,
    cat: "next50",
  },
  {
    symbol: "SUNDRMFAST",
    name: "Sundram Fasteners Ltd.",
    base: 1280,
    cat: "next50",
  },
  {
    symbol: "IPCALAB",
    name: "Ipca Laboratories Ltd.",
    base: 1620,
    cat: "next50",
  },
  {
    symbol: "ICICIPRULI",
    name: "ICICI Prudential Life Ins.",
    base: 680,
    cat: "next50",
  },
  {
    symbol: "CUMMINSIND",
    name: "Cummins India Ltd.",
    base: 3600,
    cat: "next50",
  },
  {
    symbol: "GLAXO",
    name: "GlaxoSmithKline Pharma",
    base: 2300,
    cat: "next50",
  },
  {
    symbol: "HONAUT",
    name: "Honeywell Automation",
    base: 48000,
    cat: "next50",
  },
  { symbol: "BBTC", name: "Bombay Burmah Trading", base: 1850, cat: "next50" },
  {
    symbol: "KAJARIACER",
    name: "Kajaria Ceramics Ltd.",
    base: 1420,
    cat: "next50",
  },
  { symbol: "AAVAS", name: "Aavas Financiers Ltd.", base: 1680, cat: "next50" },
  {
    symbol: "KANSAINER",
    name: "Kansai Nerolac Paints",
    base: 320,
    cat: "next50",
  },
  { symbol: "CROMPTON", name: "Crompton Greaves CE", base: 390, cat: "next50" },
  { symbol: "VBL", name: "Varun Beverages Ltd.", base: 1540, cat: "next50" },
  { symbol: "ASTRAL", name: "Astral Ltd.", base: 1920, cat: "next50" },

  // ── MIDCAP ────────────────────────────────────────────────────
  {
    symbol: "IRCTC",
    name: "Indian Railway Catering & Tourism",
    base: 870,
    cat: "midcap",
  },
  { symbol: "ABFRL", name: "Aditya Birla Fashion", base: 290, cat: "midcap" },
  { symbol: "ATUL", name: "Atul Ltd.", base: 7200, cat: "midcap" },
  {
    symbol: "BAJAJHFL",
    name: "Bajaj Housing Finance",
    base: 145,
    cat: "midcap",
  },
  { symbol: "CEATLTD", name: "CEAT Ltd.", base: 3150, cat: "midcap" },
  {
    symbol: "CHOLAFIN",
    name: "Cholamandalam Inv & Fin",
    base: 1420,
    cat: "midcap",
  },
  { symbol: "DELHIVERY", name: "Delhivery Ltd.", base: 385, cat: "midcap" },
  {
    symbol: "DEEPAKNI",
    name: "Deepak Nitrite Ltd.",
    base: 2650,
    cat: "midcap",
  },
  { symbol: "JKCEMENT", name: "JK Cement Ltd.", base: 4600, cat: "midcap" },
  {
    symbol: "KPITTECH",
    name: "KPIT Technologies Ltd.",
    base: 1650,
    cat: "midcap",
  },
  {
    symbol: "NYKAA",
    name: "FSN E-Commerce Ventures",
    base: 185,
    cat: "midcap",
  },
  { symbol: "PAYTM", name: "One 97 Communications", base: 720, cat: "midcap" },
  { symbol: "POLICYBZR", name: "PB Fintech Ltd.", base: 1850, cat: "midcap" },
  { symbol: "TRENT", name: "Trent Ltd.", base: 6200, cat: "midcap" },
  { symbol: "SBICARD", name: "SBI Cards & Payment", base: 760, cat: "midcap" },
  {
    symbol: "CLEAN",
    name: "Clean Science & Technology",
    base: 1620,
    cat: "midcap",
  },
  { symbol: "HFCL", name: "HFCL Ltd.", base: 128, cat: "midcap" },
  { symbol: "IDFC", name: "IDFC Ltd.", base: 108, cat: "midcap" },
  {
    symbol: "IDFCFIRSTB",
    name: "IDFC First Bank Ltd.",
    base: 76,
    cat: "midcap",
  },
  {
    symbol: "IRFC",
    name: "Indian Railway Finance Corp.",
    base: 195,
    cat: "midcap",
  },
  { symbol: "JYOTHYLAB", name: "Jyothy Labs Ltd.", base: 525, cat: "midcap" },
  {
    symbol: "NATCOPHARM",
    name: "Natco Pharma Ltd.",
    base: 1580,
    cat: "midcap",
  },
  {
    symbol: "PGHH",
    name: "Procter & Gamble Health",
    base: 6200,
    cat: "midcap",
  },
  {
    symbol: "RATNAMANI",
    name: "Ratnamani Metals & Tubes",
    base: 3500,
    cat: "midcap",
  },
  {
    symbol: "SUNDARBFIN",
    name: "Sundaram Finance Ltd.",
    base: 5400,
    cat: "midcap",
  },
  {
    symbol: "TEXRAIL",
    name: "Texmaco Rail & Engineering",
    base: 245,
    cat: "midcap",
  },
  {
    symbol: "UJJIVANSFB",
    name: "Ujjivan Small Finance Bank",
    base: 48,
    cat: "midcap",
  },
  { symbol: "VSTIND", name: "VST Industries Ltd.", base: 4200, cat: "midcap" },
  {
    symbol: "WHIRLPOOL",
    name: "Whirlpool of India Ltd.",
    base: 1950,
    cat: "midcap",
  },
  {
    symbol: "ZYDUSLIFE",
    name: "Zydus Lifesciences Ltd.",
    base: 1280,
    cat: "midcap",
  },

  // ── SMALLCAP ──────────────────────────────────────────────────
  { symbol: "ANGELONE", name: "Angel One Ltd.", base: 2650, cat: "smallcap" },
  {
    symbol: "BIKAJI",
    name: "Bikaji Foods International",
    base: 720,
    cat: "smallcap",
  },
  {
    symbol: "BALRAMCHIN",
    name: "Balrampur Chini Mills",
    base: 540,
    cat: "smallcap",
  },
  {
    symbol: "CAMPUS",
    name: "Campus Activewear Ltd.",
    base: 248,
    cat: "smallcap",
  },
  { symbol: "DELTACORP", name: "Delta Corp Ltd.", base: 165, cat: "smallcap" },
  { symbol: "EMAMILTD", name: "Emami Ltd.", base: 680, cat: "smallcap" },
  {
    symbol: "FINEORG",
    name: "Fine Organic Industries",
    base: 5200,
    cat: "smallcap",
  },
  {
    symbol: "GESHIP",
    name: "Great Eastern Shipping",
    base: 1200,
    cat: "smallcap",
  },
  {
    symbol: "HAPPYFORGE",
    name: "Happy Forgings Ltd.",
    base: 1450,
    cat: "smallcap",
  },
  {
    symbol: "IDEAFORGE",
    name: "ideaForge Technology Ltd.",
    base: 720,
    cat: "smallcap",
  },
  {
    symbol: "JUBLPHARMA",
    name: "Jubilant Pharmova Ltd.",
    base: 1050,
    cat: "smallcap",
  },
  {
    symbol: "KFINTECH",
    name: "KFin Technologies Ltd.",
    base: 960,
    cat: "smallcap",
  },
  {
    symbol: "LATENTVIEW",
    name: "Latent View Analytics Ltd.",
    base: 430,
    cat: "smallcap",
  },
  {
    symbol: "METROPOLIS",
    name: "Metropolis Healthcare Ltd.",
    base: 1820,
    cat: "smallcap",
  },
  {
    symbol: "NAZARA",
    name: "Nazara Technologies Ltd.",
    base: 980,
    cat: "smallcap",
  },
  {
    symbol: "OLECTRA",
    name: "Olectra Greentech Ltd.",
    base: 1620,
    cat: "smallcap",
  },
  {
    symbol: "RAINBOW",
    name: "Rainbow Children Medicare",
    base: 1350,
    cat: "smallcap",
  },
  {
    symbol: "SAPPHIRE",
    name: "Sapphire Foods India",
    base: 1380,
    cat: "smallcap",
  },
  { symbol: "SENCO", name: "Senco Gold Ltd.", base: 1050, cat: "smallcap" },
  {
    symbol: "TEAMLEASE",
    name: "TeamLease Services Ltd.",
    base: 2850,
    cat: "smallcap",
  },
];

const STOCK_DOMAIN: Record<string, string> = {
  RELIANCE: "ril.com",
  TCS: "tcs.com",
  HDFCBANK: "hdfcbank.com",
  INFY: "infosys.com",
  ICICIBANK: "icicibank.com",
  HINDUNILVR: "hul.co.in",
  SBIN: "sbi.co.in",
  BHARTIARTL: "airtel.in",
  TATAMOTORS: "tatamotors.com",
  KOTAKBANK: "kotak.com",
  ITC: "itcportal.com",
  AXISBANK: "axisbank.com",
  LT: "larsentoubro.com",
  JSWSTEEL: "jsw.in",
  ASIANPAINT: "asianpaints.com",
  NTPC: "ntpc.co.in",
  MARUTI: "marutisuzuki.com",
  NESTLEIND: "nestle.in",
  ONGC: "ongcindia.com",
  COALINDIA: "coalindia.in",
  ULTRACEMCO: "ultratechcement.com",
  TITAN: "titan.co.in",
  TATASTEEL: "tatasteel.com",
  SUNPHARMA: "sunpharma.com",
  DMART: "dmart.in",
  WIPRO: "wipro.com",
  HCLTECH: "hcl.com",
  SBILIFE: "sbilife.co.in",
  HDFCLIFE: "hdfclife.com",
  POWERGRID: "powergrid.in",
  CIPLA: "cipla.com",
  TECHM: "techmahindra.com",
  BAJAJFINSV: "bajajfinserv.in",
  BRITANNIA: "britannia.co.in",
  GODREJCP: "godrejcp.com",
  PIDILITIND: "pidilite.com",
  "M&M": "mahindra.com",
  EICHERMOT: "eichermotors.com",
  SHREECEM: "shreecement.com",
  DRREDDY: "drreddys.com",
  INDUSINDBK: "indusind.com",
  IOC: "iocl.com",
  HEROMOTOCO: "heromotocorp.com",
  "BAJAJ-AUTO": "bajajauto.com",
  ADANIPORTS: "adaniports.com",
  BPCL: "bharatpetroleum.in",
  ADANIENT: "adanienterprises.com",
  BAJFINANCE: "bajajfinserv.in",
  VEDL: "vedantaresources.com",
  ZOMATO: "zomato.com",
  SIEMENS: "siemens.co.in",
  AMBUJACEM: "ambujacement.com",
  DABUR: "dabur.com",
  MARICO: "marico.com",
  MUTHOOTFIN: "muthootfinance.com",
  NAUKRI: "naukri.com",
  HAVELLS: "havells.com",
  TORNTPHARM: "torrentpharma.com",
  INDHOTEL: "tajhotels.com",
  TATACOMM: "tatacommunications.com",
  LUPIN: "lupin.com",
  AUROPHARMA: "aurobindo.com",
  GAIL: "gailonline.com",
  INDIGO: "goindigo.in",
  BANKBARODA: "bankofbaroda.in",
  CANBK: "canarabank.com",
  COLPAL: "colgate.com",
  BERGEPAINT: "bergerpaints.com",
  ALKEM: "alkemlabs.com",
  GLAND: "glandpharma.com",
  TATAPOWER: "tatapower.com",
  SAIL: "sail.co.in",
  PETRONET: "petronetlng.in",
  CONCOR: "concorindia.co.in",
  PAGEIND: "jockey.in",
  MPHASIS: "mphasis.com",
  COFORGE: "coforge.com",
  LTI: "ltimindtree.com",
  PERSISTENT: "persistent.com",
  POLYCAB: "polycab.com",
  ABCAPITAL: "adityabirlacapital.com",
  FEDERALBNK: "federalbank.co.in",
  EXIDEIND: "exideindustries.com",
  SUPREMEIND: "supreme.co.in",
  TATAELXSI: "tataelxsi.com",
  LAURUSLABS: "lauruslabs.com",
  STARHEALTH: "starhealth.in",
  SUNDRMFAST: "sundram.com",
  IPCALAB: "ipca.com",
  ICICIPRULI: "iciciprulife.com",
  CUMMINSIND: "cummins.com",
  GLAXO: "gsk.com",
  HONAUT: "honeywell.com",
  BBTC: "bbtcl.com",
  KAJARIACER: "kajariaceramics.com",
  AAVAS: "aavas.in",
  KANSAINER: "nerolac.com",
  CROMPTON: "crompton.co.in",
  VBL: "varunbeverages.com",
  ASTRAL: "astralpipes.com",
  IRCTC: "irctc.co.in",
  ABFRL: "abfrl.com",
  ATUL: "atul.co.in",
  BAJAJHFL: "bajajhousingfinance.in",
  CEATLTD: "ceat.com",
  CHOLAFIN: "cholamandalam.com",
  DELHIVERY: "delhivery.com",
  DEEPAKNI: "dnlst.com",
  JKCEMENT: "jkcement.com",
  KPITTECH: "kpit.com",
  NYKAA: "nykaa.com",
  PAYTM: "paytm.com",
  POLICYBZR: "policybazaar.com",
  TRENT: "trentlimited.com",
  SBICARD: "sbicard.com",
  CLEAN: "cleanscience.co.in",
  HFCL: "hfcl.com",
  IDFC: "idfc.com",
  IDFCFIRSTB: "idfcfirstbank.com",
  IRFC: "irfc.co.in",
  JYOTHYLAB: "jyothylabs.com",
  NATCOPHARM: "natcopharma.co.in",
  PGHH: "pghealthindia.com",
  RATNAMANI: "ratnamani.com",
  SUNDARBFIN: "sundaramfinance.in",
  TEXRAIL: "texmaco.in",
  UJJIVANSFB: "ujjivansfb.in",
  VSTIND: "vsthyd.com",
  WHIRLPOOL: "whirlpoolindia.com",
  ZYDUSLIFE: "zyduslife.com",
  ANGELONE: "angelone.in",
  BIKAJI: "bikaji.com",
  BALRAMCHIN: "chini.com",
  CAMPUS: "campusactivewear.com",
  DELTACORP: "deltacorp.in",
  EMAMILTD: "emamiltd.in",
  FINEORG: "fineorganics.com",
  GESHIP: "greatship.com",
  HAPPYFORGE: "happyforgingsltd.com",
  IDEAFORGE: "ideaforge.co.in",
  JUBLPHARMA: "jubilantpharma.com",
  KFINTECH: "kfintech.com",
  LATENTVIEW: "latentview.com",
  METROPOLIS: "metropolisindia.com",
  NAZARA: "nazara.com",
  OLECTRA: "olectra.com",
  RAINBOW: "rainbowhospitals.in",
  SAPPHIRE: "sapphirefoods.in",
  SENCO: "sencogoldanddiamonds.com",
  TEAMLEASE: "teamlease.com",
};

const COINGECKO_LOGO_MAP: Record<string, string> = {
  BTC: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png",
  ETH: "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png",
  SOL: "https://coin-images.coingecko.com/coins/images/4128/large/solana.png",
  BNB: "https://coin-images.coingecko.com/coins/images/825/large/bnb.png",
  XRP: "https://coin-images.coingecko.com/coins/images/44/large/xrp.png",
  ADA: "https://coin-images.coingecko.com/coins/images/975/large/cardano.png",
  AVAX: "https://coin-images.coingecko.com/coins/images/12559/large/Avalanche_Circle_RedWhite_Trans.png",
  DOGE: "https://coin-images.coingecko.com/coins/images/5/large/dogecoin.png",
  DOT: "https://coin-images.coingecko.com/coins/images/12171/large/polkadot.png",
  LINK: "https://coin-images.coingecko.com/coins/images/877/large/chainlink.png",
  MATIC:
    "https://coin-images.coingecko.com/coins/images/4713/large/polygon.png",
  TRX: "https://coin-images.coingecko.com/coins/images/1094/large/tron.png",
  SHIB: "https://coin-images.coingecko.com/coins/images/11939/large/shiba.png",
  LTC: "https://coin-images.coingecko.com/coins/images/2/large/litecoin.png",
  BCH: "https://coin-images.coingecko.com/coins/images/780/large/bitcoin-cash.png",
  ATOM: "https://coin-images.coingecko.com/coins/images/1481/large/cosmos.png",
  NEAR: "https://coin-images.coingecko.com/coins/images/10365/large/near.png",
  APT: "https://coin-images.coingecko.com/coins/images/26455/large/aptos_round.png",
  ARB: "https://coin-images.coingecko.com/coins/images/29167/large/Arbitrum.png",
  OP: "https://coin-images.coingecko.com/coins/images/25244/large/Optimism.png",
  INJ: "https://coin-images.coingecko.com/coins/images/12882/large/Secondary_Blue.png",
  VET: "https://coin-images.coingecko.com/coins/images/1167/large/VET.png",
  ALGO: "https://coin-images.coingecko.com/coins/images/4380/large/download.png",
  ICP: "https://coin-images.coingecko.com/coins/images/14495/large/Internet_Computer_logo.png",
  FIL: "https://coin-images.coingecko.com/coins/images/12817/large/filecoin.png",
  EOS: "https://coin-images.coingecko.com/coins/images/738/large/eos-logo.png",
  AAVE: "https://coin-images.coingecko.com/coins/images/12467/large/aave.png",
  MKR: "https://coin-images.coingecko.com/coins/images/1364/large/Maker.png",
  UNI: "https://coin-images.coingecko.com/coins/images/12504/large/uniswap-uni.png",
  XLM: "https://coin-images.coingecko.com/coins/images/100/large/stellar.png",
  ETC: "https://coin-images.coingecko.com/coins/images/453/large/ethereum-classic.png",
  XMR: "https://coin-images.coingecko.com/coins/images/162/large/monero.png",
  ZEC: "https://coin-images.coingecko.com/coins/images/486/large/zcash.png",
  PEPE: "https://coin-images.coingecko.com/coins/images/29850/large/pepe-token.jpeg",
  HBAR: "https://coin-images.coingecko.com/coins/images/3688/large/hbar.png",
  MON: "https://coin-images.coingecko.com/coins/images/37395/large/WhatsApp_Image_2024-02-27_at_18.34.45_01762153.jpg",
  SUPRA:
    "https://coin-images.coingecko.com/coins/images/35836/large/photo_2024-03-09_19-25-08.jpg",
  PUMP: "https://coin-images.coingecko.com/coins/images/35676/large/pump_%281%29.jpg",
  EPIC: "https://coin-images.coingecko.com/coins/images/54734/large/PFP.png",
};

const COINDCX_NAME_MAP: Record<string, string> = {
  BTC: "Bitcoin",
  ETH: "Ethereum",
  SOL: "Solana",
  BNB: "Binance Coin",
  XRP: "Ripple",
  ADA: "Cardano",
  AVAX: "Avalanche",
  DOGE: "Dogecoin",
  DOT: "Polkadot",
  LINK: "Chainlink",
  MATIC: "Polygon",
  TRX: "TRON",
  SHIB: "Shiba Inu",
  LTC: "Litecoin",
  BCH: "Bitcoin Cash",
  ATOM: "Cosmos",
  NEAR: "NEAR Protocol",
  APT: "Aptos",
  ARB: "Arbitrum",
  OP: "Optimism",
  INJ: "Injective",
  VET: "VeChain",
  ALGO: "Algorand",
  ICP: "Internet Computer",
  FIL: "Filecoin",
  EOS: "EOS",
  AAVE: "Aave",
  MKR: "Maker",
  UNI: "Uniswap",
  XLM: "Stellar",
  ETC: "Ethereum Classic",
  XMR: "Monero",
  ZEC: "Zcash",
};

// Seeded PRNG for mock fallback
function rng(seed: number) {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Generate a premium look synthetic sparkline for stock fallback/display
function generateSparkline(currentPrice: number, dayChgPct: number, symbol: string) {
  const bucket = Math.floor(Date.now() / STOCKS_CACHE_TTL);
  const points = [];
  let price = currentPrice * (1 - dayChgPct / 100);
  points.push(price);

  for (let i = 1; i < 24; i++) {
    const seed = bucket * 31 + symbol.charCodeAt(0) * i;
    const change = (rng(seed) - 0.5) * 0.02;
    price = price * (1 + change);
    points.push(price);
  }
  const ratio = currentPrice / price;
  return points.map((p) => +(p * ratio).toFixed(2));
}

// Calculate stock market cap dynamically based on category
function getStockMarketCap(price: number, cat: string) {
  let shares = 100000000;
  if (cat === "nifty50") shares = 5000000000;
  else if (cat === "next50") shares = 1500000000;
  else if (cat === "midcap") shares = 600000000;
  else if (cat === "smallcap") shares = 150000000;
  return Math.floor(price * shares);
}

export default (db: any) => {
  const router = express.Router();
  const publicRL = rateLimit({ windowMs: 60000, max: 30 });

  async function getActiveGeckoKey(req: any) {
    if (req && req.session && req.session.userId) {
      const u = await prisma.user.findUnique({
        where: { id: req.session.userId as number },
        select: { coingecko_key: true }
      });
      if (u && u.coingecko_key && u.coingecko_key.trim()) {
        return u.coingecko_key.trim();
      }
    }
    return getCurrentGeckoKey();
  }

  function cgBaseUrl(customKey: any = null) {
    const key = String(customKey || env.COINGECKO_API_KEY || "");
    const isDemo = key.startsWith("CG-") || !key;
    return isDemo
      ? "https://api.coingecko.com"
      : "https://pro-api.coingecko.com";
  }

  function cgAuthHeaderName(customKey: any = null) {
    const key = String(customKey || env.COINGECKO_API_KEY || "");
    const isDemo = key.startsWith("CG-") || !key;
    return isDemo ? "x-cg-demo-api-key" : "x-cg-pro-api-key";
  }

  // Fallback mock quote generator
  function mockQuote(s: any) {
    const bucket = Math.floor(Date.now() / STOCKS_CACHE_TTL);
    const r1 = rng(bucket * 31 + s.symbol.charCodeAt(0));
    const dayChgPct = +((r1 - 0.5) * 4).toFixed(2);
    const openOffset = +((rng(bucket * 37 + 1) - 0.5) * s.base * 0.008).toFixed(
      2,
    );
    const open = +(s.base + openOffset).toFixed(2);
    const price = +(s.base * (1 + dayChgPct / 100)).toFixed(2);
    const high = +(
      Math.max(price, open) *
      (1 + rng(bucket * 7 + 1) * 0.02)
    ).toFixed(2);
    const low = +(
      Math.min(price, open) *
      (1 - rng(bucket * 11 + 2) * 0.02)
    ).toFixed(2);
    const vol = Math.floor(rng(bucket * 13 + 3) * 10_000_000 + 500_000);

    const domain = STOCK_DOMAIN[s.symbol] || "";
    const image = domain
      ? `https://logo.clearbit.com/${domain}`
      : `https://ui-avatars.com/api/?name=${encodeURIComponent(s.symbol)}&background=111927&color=00e5a0&size=128&font-size=0.4&bold=true`;

    return {
      id: s.symbol.toLowerCase(),
      symbol: s.symbol,
      name: s.name,
      category: s.cat,
      domain: domain,
      image: image,
      current_price: price,
      price_change_percentage_24h: dayChgPct,
      price_change_percentage_1h_in_currency: +(dayChgPct / 24).toFixed(2),
      price_change_percentage_7d_in_currency: +(
        rng(bucket * 17 + 4) * 10 -
        5
      ).toFixed(2),
      market_cap: getStockMarketCap(price, s.cat),
      total_volume: vol,
      sparkline_in_7d: { price: generateSparkline(price, dayChgPct, s.symbol) },
      source: "mock",
    };
  }

  async function mapConcurrent(items: any[], fn: (item: any) => any, concurrency = 10) {
    const results = [];
    for (let i = 0; i < items.length; i += concurrency) {
      const chunk = items.slice(i, i + concurrency);
      const chunkResults = await Promise.all(chunk.map(fn));
      results.push(...chunkResults);
    }
    return results;
  }

  // Fetch live stock quotes from Finnhub
  async function fetchFinnhubQuotes(stockSymbols: any[]) {
    const apiKey = env.FINNHUB_API_KEY;
    if (!apiKey) {
      throw new Error("Finnhub API key is not configured");
    }

    const results = await mapConcurrent(stockSymbols, async (s) => {
      const symbol = `${s.symbol}.NS`;
      const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}`;
      try {
        const res = await fetch(url, { signal: makeTimeoutSignal(4000), headers: { "X-Finnhub-Token": apiKey } });
        if (res.status === 429) {
          throw new Error("Rate limit exceeded");
        }
        if (!res.ok) throw new Error(`Finnhub returned status ${res.status}`);
        const q = await res.json();

        if (q.c == null || q.c === 0) {
          throw new Error("No data returned for symbol");
        }

        const domain = STOCK_DOMAIN[s.symbol] || "";
        const image = domain
          ? `https://logo.clearbit.com/${domain}`
          : `https://ui-avatars.com/api/?name=${encodeURIComponent(s.symbol)}&background=111927&color=00e5a0&size=128&font-size=0.4&bold=true`;

        const price = q.c;
        const changePercent = q.dp ?? 0;

        const sparkline = generateSparkline(price, changePercent, s.symbol);
        const firstClose = sparkline[0];
        const change7d = firstClose
          ? ((price - firstClose) / firstClose) * 100
          : 0;

        return {
          id: s.symbol.toLowerCase(),
          symbol: s.symbol,
          name: s.name,
          category: s.cat,
          domain: domain,
          image: image,
          current_price: price,
          price_change_percentage_24h: +changePercent.toFixed(2),
          price_change_percentage_1h_in_currency: +(changePercent / 24).toFixed(
            2,
          ),
          price_change_percentage_7d_in_currency: +change7d.toFixed(2),
          market_cap: getStockMarketCap(price, s.cat),
          total_volume: Math.floor(q.v || Math.random() * 5_000_000 + 100_000),
          sparkline_in_7d: { price: sparkline },
          source: "finnhub",
        };
      } catch (err: any) {
        return null;
      }
    });

    const validResults = results.filter(Boolean);

    if (validResults.length === 0) {
      throw new Error("Finnhub returned no valid stock quotes");
    }

    return stockSymbols.map((s: any, idx: any) => {
      return results[idx] || mockQuote(s);
    });
  }

  // Fetch stock candles from Finnhub
  async function fetchFinnhubChart(symbol: string, days: any) {
    const apiKey = env.FINNHUB_API_KEY;
    if (!apiKey) throw new Error("Finnhub API key not configured");

    const yahooSymbol = `${symbol}.NS`;
    let resolution = "60";
    const to = Math.floor(Date.now() / 1000);
    const from = to - days * 86400;

    const d = parseInt(days, 10);
    if (d <= 1) {
      resolution = "5";
    } else if (d <= 7) {
      resolution = "60";
    } else if (d <= 30) {
      resolution = "60";
    } else if (d <= 90) {
      resolution = "D";
    } else {
      resolution = "D";
    }

    const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(yahooSymbol)}&resolution=${resolution}&from=${from}&to=${to}`;
    const response = await fetch(url, { signal: makeTimeoutSignal(6000), headers: { "X-Finnhub-Token": apiKey } });
    if (!response.ok)
      throw new Error(`Finnhub candles returned status ${response.status}`);
    const json = await response.json();

    if (json.s !== "ok" || !Array.isArray(json.t) || !Array.isArray(json.c)) {
      throw new Error("Finnhub returned no chart data");
    }

    const prices = [];
    for (let i = 0; i < json.t.length; i++) {
      prices.push([json.t[i] * 1000, +json.c[i].toFixed(2)]);
    }
    return prices;
  }

  // Fetch live stock prices from Yahoo Finance
  async function fetchYahooQuotes(stockSymbols: any[]) {
    const batchSize = 20;
    const chunks = [];
    for (let i = 0; i < stockSymbols.length; i += batchSize) {
      chunks.push(stockSymbols.slice(i, i + batchSize));
    }

    const mergedData: Record<string, any> = {};

    try {
      const promises = chunks.map(async (chunk) => {
        try {
          const yahooTickers = chunk.map((s) => `${s.symbol}.NS`);
          const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(yahooTickers.join(","))}&range=7d&interval=1h`;

          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            signal: makeTimeoutSignal(8000),
          });

          if (!res.ok) {
            throw new Error(
              `Yahoo Finance spark API returned status ${res.status}`,
            );
          }

          const data = await res.json();
          if (data && typeof data === "object") {
            Object.assign(mergedData, data);
          }
        } catch (chunkErr: any) {
          console.error(
            "[Yahoo Finance Spark Chunk Fetch Error]",
            chunkErr.message,
          );
        }
      });

      await Promise.all(promises);
    } catch (err: any) {
      console.error("[Yahoo Finance Fetch Error]", err.message);
    }

    return stockSymbols.map((s: any) => {
      const ticker = `${s.symbol}.NS`;
      const q =
        mergedData[ticker] ||
        mergedData[ticker.toUpperCase()] ||
        mergedData[ticker.toLowerCase()];

      const domain = STOCK_DOMAIN[s.symbol] || "";
      const image = domain
        ? `https://logo.clearbit.com/${domain}`
        : `https://ui-avatars.com/api/?name=${encodeURIComponent(s.symbol)}&background=111927&color=00e5a0&size=128&font-size=0.4&bold=true`;

      if (q && Array.isArray(q.close) && q.close.length > 0) {
        const validCloses = q.close.filter(
          (p: any) => p != null && Number.isFinite(p),
        );
        const price =
          validCloses.length > 0 ? validCloses[validCloses.length - 1] : s.base;

        const prevClose =
          q.previousClose ?? (validCloses.length > 0 ? validCloses[0] : s.base);
        const changePercent = prevClose
          ? ((price - prevClose) / prevClose) * 100
          : 0;

        const bucket = Math.floor(Date.now() / STOCKS_CACHE_TTL);
        const vol = Math.floor(
          rng(bucket * 13 + s.symbol.charCodeAt(0)) * 10_000_000 + 500_000,
        );

        const firstClose = validCloses[0];
        const change7d = firstClose
          ? ((price - firstClose) / firstClose) * 100
          : 0;

        return {
          id: s.symbol.toLowerCase(),
          symbol: s.symbol,
          name: s.name,
          category: s.cat,
          domain: domain,
          image: image,
          current_price: price,
          price_change_percentage_24h: +changePercent.toFixed(2),
          price_change_percentage_1h_in_currency: +(changePercent / 24).toFixed(
            2,
          ),
          price_change_percentage_7d_in_currency: +change7d.toFixed(2),
          market_cap: getStockMarketCap(price, s.cat),
          total_volume: vol,
          sparkline_in_7d: { price: validCloses },
          source: "yahoo",
        };
      } else {
        return mockQuote(s);
      }
    });
  }

  function symbolToCoindcxPair(symbol: string, vs_currency: string) {
    const sym = String(symbol || "").toUpperCase();
    const vs = String(vs_currency || "").toUpperCase();
    if (vs === "INR") return `B-${sym}_INR`;
    if (vs === "USDT") return `B-${sym}_USDT`;
    if (vs === "USD") return `B-${sym}_USD`;
    return `B-${sym}_INR`;
  }

  // ─── PORTFOLIO CRUD ──────────────────────────────────────────
  router.get("/portfolio", requireAuth, rateLimit({ windowMs: 60000, max: 60 }), async (req, res) => {
    try {
      const userId = req.session.userId as number;
      const items = await prisma.portfolio.findMany({
        where: { user_id: userId },
        orderBy: { created_at: "desc" },
      });
      return res.json(items);
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/portfolio", requireAuth, rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    const parsed = addHoldingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const { symbol: sym, name, quantity, buy_price, asset_type } = parsed.data;
    const userId = req.session.userId as number;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.portfolio.upsert({
          where: {
            user_id_symbol: {
              user_id: userId,
              symbol: sym,
            },
          },
          create: {
            user_id: userId,
            symbol: sym,
            name,
            quantity,
            buy_price,
            asset_type,
          },
          update: {
            quantity,
            buy_price,
          },
        });

        const total = quantity * buy_price;
        await tx.tradeHistory.create({
          data: {
            user_id: userId,
            trade_id: `manual-add-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            symbol: sym,
            side: "buy",
            quantity,
            price: buy_price,
            total,
            created_at: new Date().toISOString(),
          },
        });
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/portfolio/:id", requireAuth, rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    try {
      const portfolioId = Number(req.params.id);
      const userId = req.session.userId as number;
      await prisma.$transaction(async (tx) => {
        const old = await tx.portfolio.findUnique({
          where: { id: portfolioId },
        });
        if (old && old.user_id === userId) {
          await tx.portfolio.delete({
            where: { id: portfolioId },
          });

          // Log manual SELL for all of it
          const total = old.quantity * old.buy_price;
          await tx.tradeHistory.create({
            data: {
              user_id: userId,
              trade_id: `manual-del-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
              symbol: old.symbol,
              side: "sell",
              quantity: old.quantity,
              price: old.buy_price,
              total,
              created_at: new Date().toISOString(),
            },
          });
        }
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.put("/portfolio/:id", requireAuth, rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    const parsed = editHoldingSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const { quantity, buy_price } = parsed.data;
    const portfolioId = Number(req.params.id);
    const userId = req.session.userId as number;
    try {
      await prisma.$transaction(async (tx) => {
        const old = await tx.portfolio.findUnique({
          where: { id: portfolioId },
        });
        if (old && old.user_id === userId) {
          const updateData: Record<string, any> = {};
          if (quantity !== undefined) updateData.quantity = quantity;
          if (buy_price !== undefined) updateData.buy_price = buy_price;

          if (Object.keys(updateData).length > 0) {
            await tx.portfolio.update({
              where: { id: portfolioId },
              data: updateData,
            });
          }

          if (quantity !== undefined && quantity !== old.quantity) {
            const diff = quantity - old.quantity;
            const side = diff > 0 ? "buy" : "sell";
            const tradeQty = Math.abs(diff);
            const tradePrice =
              buy_price !== undefined ? buy_price : old.buy_price;
            const total = tradeQty * tradePrice;

            await tx.tradeHistory.create({
              data: {
                user_id: userId,
                trade_id: `manual-update-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                symbol: old.symbol,
                side,
                quantity: tradeQty,
                price: tradePrice,
                total,
                created_at: new Date().toISOString(),
              },
            });
          } else if (buy_price !== undefined && buy_price !== old.buy_price) {
            // Price only update: log a manual trade history record with 0 qty to mark manual interaction
            await tx.tradeHistory.create({
              data: {
                user_id: userId,
                trade_id: `manual-price-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                symbol: old.symbol,
                side: "buy",
                quantity: 0,
                price: buy_price,
                total: 0,
                created_at: new Date().toISOString(),
              },
            });
          }
        }
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/trade-history", requireAuth, rateLimit({ windowMs: 60000, max: 60 }), async (req, res) => {
    try {
      const take = Math.min(Math.max(parseInt(String(req.query.take || 500), 10) || 500, 1), 5000);
      const skip = Math.max(parseInt(String(req.query.skip || 0), 10) || 0, 0);
      const userId = req.session.userId as number;
      const items = await prisma.tradeHistory.findMany({
        where: { user_id: userId },
        orderBy: { id: "desc" },
        take,
        skip,
      });
      const mapped = items.map((item) => {
        let formattedTime = item.created_at;
        try {
          const d = new Date(item.created_at || "");
          if (!isNaN(d.getTime())) {
            const pad = (n: any) => String(n).padStart(2, "0");
            formattedTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
          }
        } catch (e: any) {}

        return {
          time: formattedTime,
          created_at: item.created_at,
          pair: item.symbol,
          type: item.side,
          qty: item.quantity,
          price: item.price,
          total: item.total || item.quantity * item.price,
          trade_id: item.trade_id,
        };
      });
      return res.json(mapped);
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── STOCKS ──────────────────────────────────────────────────
  router.get("/stocks", async (req, res) => {
    const now = Date.now();
    const cat = String(req.query.category || "all").toLowerCase();
    const forceFresh = req.query.fresh === "1" || req.query.nocache === "1";
    const stockSymbolsOnly = STOCK_SYMBOLS.filter((s) => s.cat !== "crypto");

    const isCacheValid =
      stocksCache &&
      Array.isArray(stocksCache) &&
      now - stocksCacheTime < STOCKS_CACHE_TTL;

    if (!forceFresh && isCacheValid) {
      const filtered =
        cat === "all"
          ? stocksCache
          : stocksCache.filter((s: any) => s.category === cat);
      return res.json(filtered);
    }

    if (env.FINNHUB_API_KEY) {
      try {
        const quotes = await fetchFinnhubQuotes(stockSymbolsOnly);
        stocksCache = quotes;
        stocksCacheTime = now;
        const filtered =
          cat === "all" ? quotes : quotes.filter((s: any) => s.category === cat);
        return res.json(filtered);
      } catch (e: any) {
        console.warn("[Finnhub Failed, falling back to Yahoo]", e.message);
      }
    }

    try {
      const quotes = await fetchYahooQuotes(stockSymbolsOnly);
      stocksCache = quotes;
      stocksCacheTime = now;
      const filtered =
        cat === "all" ? quotes : quotes.filter((s: any) => s.category === cat);
      return res.json(filtered);
    } catch (e: any) {
      console.error("Stocks API error:", e.message);
      if (stocksCache && Array.isArray(stocksCache)) {
        const filtered =
          cat === "all"
            ? stocksCache
            : stocksCache.filter((s) => s.category === cat);
        return res.json(filtered);
      }
      const quotes = stockSymbolsOnly.map(mockQuote);
      const filtered =
        cat === "all" ? quotes : quotes.filter((s) => s.category === cat);
      return res.json(filtered);
    }
  });

  router.get("/stocks/:symbol/chart", async (req, res) => {
    const { symbol } = req.params;
    const daysRaw = req.query.days;
    const days = parseInt(String(daysRaw || 7), 10) || 7;

    const row = STOCK_SYMBOLS.find(
      (s) => s.symbol.toUpperCase() === symbol.toUpperCase(),
    );
    if (!row) return res.json({ prices: [] });

    if (env.FINNHUB_API_KEY) {
      try {
        const prices = await fetchFinnhubChart(row.symbol, days);
        return res.json({ prices });
      } catch (err: any) {
        console.warn(
          `[Finnhub Chart Failed for ${symbol}, trying Yahoo]`,
          err.message,
        );
      }
    }

    const yahooSymbol = `${row.symbol}.NS`;
    let range = "7d";
    let interval = "1h";
    if (days <= 1) {
      range = "1d";
      interval = "5m";
    } else if (days <= 7) {
      range = "7d";
      interval = "1h";
    } else if (days <= 30) {
      range = "30d";
      interval = "1h";
    } else if (days <= 90) {
      range = "90d";
      interval = "1d";
    } else {
      range = "1y";
      interval = "1d";
    }

    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=${range}&interval=${interval}`;
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        signal: makeTimeoutSignal(8000),
      });
      if (!response.ok)
        throw new Error(`Yahoo chart API returned status ${response.status}`);
      const json = await response.json();
      const result = json?.chart?.result?.[0];
      const timestamps = result?.timestamp || [];
      const closes = result?.indicators?.quote?.[0]?.close || [];

      const prices = [];
      for (let i = 0; i < timestamps.length; i++) {
        const p = closes[i];
        if (p != null && Number.isFinite(p)) {
          prices.push([timestamps[i] * 1000, +p.toFixed(2)]);
        }
      }
      return res.json({ prices });
    } catch (err: any) {
      console.error(`[Yahoo Chart Fetch Error for ${symbol}]`, err.message);
      const bucket = Math.floor(Date.now() / STOCKS_CACHE_TTL);
      const basePrice = row.base;
      const ts = Date.now() - days * 86400_000;
      const points = Math.min(days * 24, 168);
      const prices = [];
      for (let i = 0; i < points; i++) {
        const jitter = (rng(bucket * 19 + i) - 0.5) * basePrice * 0.04;
        prices.push([ts + i * 3600_000, +(basePrice + jitter).toFixed(2)]);
      }
      return res.json({ prices });
    }
  });

  // ─── COINDCX BALANCE & PRIVATE SYNC ──────────────────────────
  router.get("/coindcx/balances", requireAuth, async (req, res) => {
    const userId = req.session.userId as number;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { coindcx_key: true, coindcx_secret: true }
    });
    if (!user || !user.coindcx_key || !user.coindcx_secret) {
      return res
        .status(400)
        .json({ error: "Missing CoinDCX API keys. Please add them first." });
    }
    const decKey = safeDecrypt(user.coindcx_key);
    const decSecret = safeDecrypt(user.coindcx_secret);
    try {
      const timeStamp = Date.now().toString();
      const payload = JSON.stringify({ timestamp: timeStamp });
      const signature = crypto
        .createHmac("sha256", decSecret.trim())
        .update(payload)
        .digest("hex");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(
        "https://api.coindcx.com/exchange/v1/users/balances",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AUTH-APIKEY": decKey.trim(),
            "X-AUTH-SIGNATURE": signature,
          },
          body: payload,
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        console.error("CoinDCX returned invalid response:", text.substring(0, 200));
        return res.status(500).json({
          error: "Invalid response from exchange. Please try again later.",
        });
      }

      if (!response.ok) {
        console.error(`CoinDCX error (${response.status}):`, data);
        return res.status(401).json({
          error: "Exchange authentication failed. Verify your API key and secret are correct.",
        });
      }

      if (!Array.isArray(data)) {
        return res
          .status(500)
          .json({ error: `Unexpected response format from CoinDCX` });
      }

      const nonZero = data.filter((b: any) => parseFloat(b.balance) > 0);
      return res.json(nonZero);
    } catch (e: any) {
      console.error("CoinDCX error:", e.message, e.stack);
      if (e.name === "AbortError") {
        return res
          .status(504)
          .json({ error: "CoinDCX request timed out. Please try again." });
      } else {
        console.error(e); return res.status(500).json({ error: "Internal server error" });
      }
    }
  });

  router.post("/sync-coindcx", requireAuth, rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
    const userId = req.session.userId as number;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { coindcx_key: true, coindcx_secret: true, coindcx_sync_status: true }
    });
    if (!user || !user.coindcx_key || !user.coindcx_secret) {
      return res
        .status(400)
        .json({ error: "Missing CoinDCX API keys. Please add them first." });
    }

    // Atomic check-and-set: only proceed if not already syncing
    const updated = await prisma.user.updateMany({
      where: { id: userId, coindcx_sync_status: { not: "syncing" } },
      data: { coindcx_sync_status: "syncing" }
    });
    if (updated.count === 0) {
      return res
        .status(409)
        .json({ error: "A synchronization is already in progress." });
    }

    let apiKey: string, apiSecret: string;
    try {
      apiKey = safeDecrypt(user.coindcx_key).trim();
      apiSecret = safeDecrypt(user.coindcx_secret).trim();
    } catch (decErr: any) {
      await prisma.user.update({
        where: { id: userId },
        data: { coindcx_sync_status: "", coindcx_sync_error: "Key decryption failed" }
      });
      console.error(`[sync] Decryption failed for user ${userId}:`, decErr.message);
      return res.status(500).json({
        error: "Failed to decrypt stored API keys. Please re-enter them on the Profile page."
      });
    }
    if (!apiKey || !apiSecret) {
      await prisma.user.update({
        where: { id: userId },
        data: { coindcx_sync_status: "", coindcx_sync_error: "Stored keys are empty" }
      });
      return res.status(400).json({
        error: "Stored API keys are empty. Please re-enter them on the Profile page."
      });
    }

    function cdxSign(payload: string) {
      return crypto
        .createHmac("sha256", apiSecret!)
        .update(payload)
        .digest("hex");
    }

    (async () => {
      try {
        const balPayload = JSON.stringify({ timestamp: Date.now().toString() });
        const balResp = await fetch(
          "https://api.coindcx.com/exchange/v1/users/balances",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-AUTH-APIKEY": apiKey,
              "X-AUTH-SIGNATURE": cdxSign(balPayload),
            },
            body: balPayload,
            signal: makeTimeoutSignal(15000),
          },
        );
        const balText = await balResp.text();
        let balData;
        try {
          balData = JSON.parse(balText);
        } catch {
          throw new Error("CoinDCX returned invalid response");
        }
        if (!balResp.ok) {
          const errMsg =
            (balData && balData.message) ||
            (balData && balData.error) ||
            "Invalid API key or secret";
          throw new Error(`CoinDCX Authentication failed: ${errMsg}`);
        }
        if (!Array.isArray(balData))
          throw new Error("Unexpected response format");

        const nonZero = balData
          .map((b) => ({
            ...b,
            totalBalance:
              parseFloat(b.balance || 0) + parseFloat(b.locked_balance || 0),
          }))
          .filter(
            (b) =>
              b.totalBalance > 0 &&
              b.currency &&
              b.currency.toUpperCase() !== "INR",
          );

        // Fetch live USDTINR rate from CoinDCX ticker (fall back to 92.0 if unavailable)
        let usdToInrRate = 92.0;
        try {
          const rateResp = await fetch("https://api.coindcx.com/exchange/ticker", {
            headers: { "User-Agent": "StockWise/1.0" },
            signal: makeTimeoutSignal(6000),
          });
          if (rateResp.ok) {
            const rateTickers = await rateResp.json();
            if (Array.isArray(rateTickers)) {
              const usdtInrTick = rateTickers.find(
                (t) => String(t.market || "").toUpperCase() === "USDTINR"
              );
              if (usdtInrTick) {
                const parsedRate = parseFloat(
                  usdtInrTick.last_price || usdtInrTick.lastPrice || usdtInrTick.price || 0
                );
                if (parsedRate > 50 && parsedRate < 200) usdToInrRate = parsedRate;
              }
            }
          }
        } catch (rateErr: any) {
          console.warn("[sync] Could not fetch live USDTINR rate, using fallback 92.0:", rateErr.message);
        }

        let tradeHistory: any[] = [];
        let fromId: any = null;
        const MAX_TRADE_PAGES = 10; // Up to 5000 trades for users with deep history
        for (let page = 0; page < MAX_TRADE_PAGES; page++) {
          try {
            const thBody = fromId
              ? {
                  timestamp: Date.now().toString(),
                  limit: 500,
                  from_id: fromId,
                }
              : { timestamp: Date.now().toString(), limit: 500 };
            const thPayload = JSON.stringify(thBody);
            const thResp = await fetch(
              "https://api.coindcx.com/exchange/v1/orders/trade_history",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "X-AUTH-APIKEY": apiKey,
                  "X-AUTH-SIGNATURE": cdxSign(thPayload),
                },
                body: thPayload,
                signal: makeTimeoutSignal(10000),
              },
            );
            if (!thResp.ok) break;
            const pageTrades = await thResp.json();
            if (!Array.isArray(pageTrades) || pageTrades.length === 0) break;
            tradeHistory = tradeHistory.concat(pageTrades);
            if (pageTrades.length < 500) break;
            fromId = pageTrades[pageTrades.length - 1].id;
          } catch (e: any) {
            break;
          }
        }

        const pairToCoin: Record<string, string> = {};
        const allCoinsFromTrades = new Set<string>();

        if (Array.isArray(tradeHistory)) {
          tradeHistory.forEach((t) => {
            let sym = (t.symbol || "").toUpperCase();
            if (sym.includes("_")) {
              sym = sym.replace(/^B-/, "").replace(/^I-/, "").replace("_", "");
            }
            if (sym.endsWith("INR")) {
              allCoinsFromTrades.add(sym.slice(0, -3));
            } else if (sym.endsWith("USDT")) {
              allCoinsFromTrades.add(sym.slice(0, -4));
            } else if (sym.endsWith("USD")) {
              allCoinsFromTrades.add(sym.slice(0, -3));
            }
          });
        }

        [
          ...allCoinsFromTrades,
          ...nonZero.map((b) => b.currency.toUpperCase()),
        ].forEach((cur) => {
          pairToCoin[cur + "INR"] = cur;
          pairToCoin[cur + "USDT"] = cur;
          pairToCoin[cur + "USD"] = cur;
          pairToCoin[cur + "BTC"] = cur;
          pairToCoin["B-" + cur + "_INR"] = cur;
          pairToCoin["B-" + cur + "_USDT"] = cur;
          pairToCoin["B-" + cur + "_USD"] = cur;
          pairToCoin["I-" + cur + "_INR"] = cur;
        });

        const buyPricesINR: Record<string, number> = {};
        const coinLotCosts: Record<string, any[]> = {};

        if (Array.isArray(tradeHistory)) {
          const sortedTrades = tradeHistory.slice().sort((a, b) => {
            const ta = new Date(a.created_at || a.timestamp || 0).getTime();
            const tb = new Date(b.created_at || b.timestamp || 0).getTime();
            return ta - tb;
          });

          sortedTrades.forEach((t: any) => {
            let sym = (t.symbol || "").toUpperCase();
            if (sym.includes("_")) {
              sym = sym.replace(/^B-/, "").replace(/^I-/, "").replace("_", "");
            }
            const baseCoin = pairToCoin[sym];
            if (!baseCoin) return;

            const tradePrice = parseFloat(t.price || 0);
            const tradeQty = parseFloat(t.quantity || 0);
            if (!tradePrice || !tradeQty) return;

            let tradePriceINR = tradePrice;
            if (sym.endsWith("INR")) {
              tradePriceINR = tradePrice;
            } else if (sym.endsWith("USDT") || sym.endsWith("USD")) {
              tradePriceINR = tradePrice * usdToInrRate;
            } else {
              return;
            }

            if (!coinLotCosts[baseCoin]) coinLotCosts[baseCoin] = [];

            if (t.side === "buy") {
              coinLotCosts[baseCoin].push({
                qty: tradeQty,
                costINR: tradePriceINR * tradeQty,
              });
            } else if (t.side === "sell") {
              let remaining = tradeQty;
              while (remaining > 0 && coinLotCosts[baseCoin].length > 0) {
                const lot = coinLotCosts[baseCoin][0];
                if (lot.qty <= remaining) {
                  remaining -= lot.qty;
                  coinLotCosts[baseCoin].shift();
                } else {
                  lot.qty -= remaining;
                  lot.costINR -=
                    (lot.costINR / (lot.qty + remaining)) * remaining;
                  remaining = 0;
                }
              }
            }
          });
        }

        let totalInvestedINR = 0;
        for (const cur in coinLotCosts) {
          const lots = coinLotCosts[cur];
          totalInvestedINR += lots.reduce((s, l) => s + l.costINR, 0);
        }

        await prisma.$transaction(async (tx) => {
          const activeSymbols = nonZero.map((b) => b.currency.toUpperCase());

          // Smart deletion: only remove holdings that were synced from CoinDCX
          // (i.e. all their trade history has numeric CoinDCX IDs).
          // Holdings where ALL trades start with "manual-" are user-entered and are preserved.
          const existingHoldings = await tx.portfolio.findMany({
            where: { user_id: userId, asset_type: "crypto", symbol: { notIn: activeSymbols } }
          });
          if (existingHoldings.length > 0) {
            const allSymbols = existingHoldings.map(h => h.symbol);
            const allTrades = await tx.tradeHistory.findMany({
              where: { user_id: userId, symbol: { in: allSymbols } }
            });
            const tradesBySymbol = new Map();
            for (const t of allTrades) {
              if (!tradesBySymbol.has(t.symbol)) tradesBySymbol.set(t.symbol, []);
              tradesBySymbol.get(t.symbol).push(t);
            }
            for (const holding of existingHoldings) {
              const holdingTrades = tradesBySymbol.get(holding.symbol) || [];
              const isManualOnly = holdingTrades.length === 0 ||
                holdingTrades.every((t: any) => t.trade_id.startsWith("manual-"));
              if (!isManualOnly) {
                await tx.portfolio.delete({ where: { id: holding.id } });
              }
            }
          }

          const existingHoldingsMap = new Map<string, number>();
          const existingRows = await tx.portfolio.findMany({
            where: { user_id: userId, symbol: { in: nonZero.map(b => b.currency.toUpperCase()) } }
          });
          for (const row of existingRows) existingHoldingsMap.set(row.symbol, row.buy_price);

          for (const b of nonZero) {
            const symbol = b.currency.toUpperCase();
            const existingBuyPrice = existingHoldingsMap.get(symbol) || 0;

            await tx.portfolio.upsert({
              where: {
                user_id_symbol: {
                  user_id: userId,
                  symbol
                }
              },
              create: {
                user_id: userId,
                symbol,
                name: COINDCX_NAME_MAP[symbol] || symbol,
                quantity: b.totalBalance,
                buy_price: 0,
                asset_type: "crypto"
              },
              update: {
                quantity: b.totalBalance,
                ...(existingBuyPrice === 0 ? { buy_price: 0 } : {})
              }
            });
          }

          for (const t of tradeHistory) {
            if (!t.id) continue;
            const side = t.side || (t.type === "buy" ? "buy" : "sell");
            const price = parseFloat(t.price || 0);
            const qty = parseFloat(t.quantity || t.qty || 0);
            const total = price * qty;
            let createdAt =
              t.created_at || t.timestamp || new Date().toISOString();
            if (typeof createdAt === "number" || !isNaN(createdAt)) {
              createdAt = new Date(Number(createdAt)).toISOString();
            }

            await tx.tradeHistory.upsert({
              where: { trade_id: String(t.id) },
              create: {
                user_id: userId,
                trade_id: String(t.id),
                symbol: (t.symbol || "").toUpperCase(),
                side,
                quantity: qty,
                price,
                total,
                created_at: createdAt
              },
              update: {}
            });
          }
        });

        const nowIso = new Date().toISOString();
        await prisma.user.update({
          where: { id: userId },
          data: {
            coindcx_sync_status: "success",
            coindcx_last_synced: nowIso,
            coindcx_total_invested: String(totalInvestedINR > 0 ? Math.round(totalInvestedINR) : 0)
          }
        });
        logger.info({ userId }, "[SYNC SUCCESS] CoinDCX sync job completed");
      } catch (err) {
        logger.error({ userId, err }, "[SYNC FAILURE] CoinDCX sync failed");
        await prisma.user.update({
          where: { id: userId },
          data: {
            coindcx_sync_status: "failed",
            coindcx_sync_error: "Sync failed. Check your API keys and try again."
          }
        });
      }
    })();

    return res.json({
      status: "queued",
      message: "Synchronization job queued in background.",
    });
  });

  router.post("/coindcx/test", requireAuth, rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
    const { key: bodyKey, secret: bodySecret } = req.body;
    const userId = req.session.userId as number;
    const dbUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { coindcx_key: true, coindcx_secret: true }
    });
    const decKey = dbUser ? safeDecrypt(dbUser.coindcx_key) : "";
    const decSecret = dbUser ? safeDecrypt(dbUser.coindcx_secret) : "";
    const apiKey = (bodyKey && bodyKey !== "••••••••••••••••") ? bodyKey.trim() : decKey;
    const apiSecret = (bodySecret && bodySecret !== "••••••••••••••••") ? bodySecret.trim() : decSecret;
    if (!apiKey || !apiSecret)
      return res
        .status(400)
        .json({ ok: false, error: "API key and secret are required." });
    try {
      const timeStamp = Date.now().toString();
      const payload = JSON.stringify({ timestamp: timeStamp });
      const signature = crypto
        .createHmac("sha256", apiSecret)
        .update(payload)
        .digest("hex");

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(
        "https://api.coindcx.com/exchange/v1/users/balances",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-AUTH-APIKEY": apiKey,
            "X-AUTH-SIGNATURE": signature,
          },
          body: payload,
          signal: controller.signal,
        },
      );
      clearTimeout(timeoutId);

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        return res.json({
          ok: false,
          error: "CoinDCX returned invalid response",
        });
      }
      if (!response.ok) {
        return res.json({ ok: false, error: "Exchange authentication failed. Verify your API key and secret are correct." });
      }
      const count = Array.isArray(data)
        ? data.filter((b: any) => parseFloat(b.balance) > 0).length
        : 0;
      return res.json({
        ok: true,
        message: `Connected! Found ${count} non-zero balance(s).`,
      });
    } catch (e: any) {
      if (e.name === "AbortError") {
        return res.json({ ok: false, error: "Request timed out. Please try again." });
      } else {
        console.error(e); return res.json({ ok: false, error: "Internal server error" });
      }
    }
  });

  router.get("/coindcx/orderbook", async (req, res) => {
    const pair = String(req.query.pair || "");
    if (!pair)
      return res.status(400).json({ error: "Missing ?pair= parameter" });
    try {
      const obRes = await fetch(
        `https://public.coindcx.com/market_data/orderbook?pair=${encodeURIComponent(pair)}`,
        {
          signal: makeTimeoutSignal(8000),
        },
      );
      if (!obRes.ok)
        return res
          .status(obRes.status)
          .json({ error: "CoinDCX orderbook fetch failed" });
      const ob = await obRes.json();
      const asksObj = ob.asks || {};
      const bidsObj = ob.bids || {};

      const asks = Object.entries(asksObj)
        .map(([p, q]: any[]) => [parseFloat(String(p)), parseFloat(String(q))])
        .sort((a, b) => a[0] - b[0]);

      const bids = Object.entries(bidsObj)
        .map(([p, q]: any[]) => [parseFloat(String(p)), parseFloat(String(q))])
        .sort((a, b) => b[0] - a[0]);

      const bestAsk = asks.length > 0 ? asks[0][0] : null;
      const bestBid = bids.length > 0 ? bids[0][0] : null;
      const spread =
        bestAsk && bestBid
          ? (((bestAsk - bestBid) / bestAsk) * 100).toFixed(4)
          : null;

      return res.json({
        pair,
        bestAsk,
        bestBid,
        spreadPct: spread,
        asks: asks.slice(0, 8),
        bids: bids.slice(0, 8),
      });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/coindcx/market-trades", async (req, res) => {
    const pair = String(req.query.pair || "");
    if (!pair)
      return res.status(400).json({ error: "Missing ?pair= parameter" });
    try {
      const tRes = await fetch(
        `https://public.coindcx.com/market_data/trade_history?pair=${encodeURIComponent(pair)}`,
        {
          signal: makeTimeoutSignal(8000),
        },
      );
      if (!tRes.ok)
        return res
          .status(tRes.status)
          .json({ error: "Trade history fetch failed" });
      const trades = await tRes.json();
      return res.json(Array.isArray(trades) ? trades.slice(0, 20) : []);
    } catch (e: any) {
      console.error(e); return res
        .status(500)
        .json({ error: "Internal server error" });
    }
  });

  router.get("/coindcx/buy-price", async (req, res) => {
    const symbol = String(req.query.symbol || "");
    const vs = String(req.query.vs_currency || "INR");
    if (!symbol)
      return res.status(400).json({ error: "Missing ?symbol= parameter" });

    try {
      const pair = symbolToCoindcxPair(symbol, vs);
      const obRes = await fetch(
        `https://public.coindcx.com/market_data/orderbook?pair=${encodeURIComponent(pair)}`,
        {
          signal: makeTimeoutSignal(8000),
        },
      );
      if (!obRes.ok)
        return res
          .status(obRes.status)
          .json({ error: "CoinDCX orderbook fetch failed" });

      const ob = await obRes.json();
      const asksObj = ob.asks || {};
      const bidsObj = ob.bids || {};

      const asks = Object.entries(asksObj)
        .map(([p, q]: any[]) => [parseFloat(String(p)), parseFloat(String(q))])
        .filter(([p]) => Number.isFinite(p))
        .sort((a, b) => a[0] - b[0]);

      const bids = Object.entries(bidsObj)
        .map(([p, q]: any[]) => [parseFloat(String(p)), parseFloat(String(q))])
        .filter(([p]) => Number.isFinite(p))
        .sort((a, b) => b[0] - a[0]);

      const bestAsk = asks.length ? asks[0][0] : null;
      const bestBid = bids.length ? bids[0][0] : null;
      const spreadPct =
        bestAsk && bestBid
          ? (((bestAsk - bestBid) / bestAsk) * 100).toFixed(4)
          : null;

      return res.json({
        symbol: String(symbol).toUpperCase(),
        pair,
        buy_price: bestAsk,
        sell_price: bestBid,
        spreadPct,
      });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/coindcx/buy-prices", async (req, res) => {
    const symbolsRaw = req.query.symbols;
    const vs = String(req.query.vs_currency || "INR");
    if (!symbolsRaw)
      return res.status(400).json({ error: "Missing ?symbols= parameter" });

    const symbols = String(symbolsRaw)
      .split(",")
      .map((s) =>
        String(s || "")
          .trim()
          .toUpperCase(),
      )
      .filter(Boolean);

    try {
      const results = await Promise.all(
        symbols.map(async (sym) => {
          try {
            const pair = symbolToCoindcxPair(sym, vs);
            const obRes = await fetch(
              `https://public.coindcx.com/market_data/orderbook?pair=${encodeURIComponent(pair)}`,
              {
                signal: makeTimeoutSignal(8000),
              },
            );
            if (!obRes.ok)
              return { symbol: sym, buy_price: null, sell_price: null };
            const ob = await obRes.json();
            const asksObj = ob.asks || {};
            const bidsObj = ob.bids || {};

            const bestAsk = Object.keys(asksObj).length
              ? Math.min(
                  ...Object.keys(asksObj)
                    .map((p) => parseFloat(p))
                    .filter((n) => Number.isFinite(n)),
                )
              : null;

            const bestBid = Object.keys(bidsObj).length
              ? Math.max(
                  ...Object.keys(bidsObj)
                    .map((p) => parseFloat(p))
                    .filter((n) => Number.isFinite(n)),
                )
              : null;

            return { symbol: sym, pair, buy_price: bestAsk, sell_price: bestBid };
          } catch (err: any) {
            console.error(`[buy-prices] Error for symbol ${sym}:`, err.message);
            return { symbol: sym, buy_price: null, sell_price: null };
          }
        }),
      );

      return res.json(results);
    } catch (e: any) {
      console.error(e); return res
        .status(500)
        .json({ error: "Internal server error" });
    }
  });

  router.get("/coindcx/markets", async (req, res) => {
    const now = Date.now();
    const vs = String(req.query.vs_currency || "inr").toLowerCase();
    const forceFresh = req.query.fresh === "1" || req.query.nocache === "1";

    if (
      !forceFresh &&
      coindcxCache &&
      now - coindcxCacheTime < COINDCX_CACHE_TTL
    ) {
      return res.json(coindcxCache);
    }

    try {
      const r = await fetch("https://api.coindcx.com/exchange/ticker", {
        headers: { "User-Agent": "StockWise/1.0" },
        signal: makeTimeoutSignal(8000),
      });
      if (!r.ok) throw new Error(`CoinDCX HTTP ${r.status}`);
      const tickers = await r.json();
      if (!Array.isArray(tickers))
        throw new Error("Unexpected CoinDCX response");

      let normalized: any[] = [];
      if (vs === "inr") {
        const usdtInrTicker = tickers.find(
          (t) => String(t.market || "").toUpperCase() === "USDTINR",
        );
        const usdtInrPrice = usdtInrTicker
          ? parseFloat(
              usdtInrTicker.last_price ||
                usdtInrTicker.lastPrice ||
                usdtInrTicker.price ||
                101.23,
            )
          : 101.23;

        const inrPairs: Record<string, any> = {};
        const usdtPairs: Record<string, any> = {};

        tickers.forEach((t: any) => {
          const market = String(t.market || "").toUpperCase();
          if (market.endsWith("INR")) {
            const base = market.slice(0, -3);
            inrPairs[base] = t;
          } else if (market.endsWith("USDT")) {
            const base = market.slice(0, -4);
            usdtPairs[base] = t;
          }
        });

        const bases = new Set([
          ...Object.keys(inrPairs),
          ...Object.keys(usdtPairs),
        ]);

        bases.forEach((base) => {
          let t = inrPairs[base];
          let isConverted = false;
          if (!t && usdtPairs[base]) {
            t = usdtPairs[base];
            isConverted = true;
          }

          if (t) {
            let last = parseFloat(t.last_price || t.lastPrice || t.price || 0);
            if (isConverted) {
              last = last * usdtInrPrice;
            }
            const chg = parseFloat(
              t.change_24_hour ||
                t["24h_change"] ||
                t.change_24_percent ||
                t.change ||
                0,
            );
            const vol = parseFloat(t.volume || t.volume_24h || 0);
            const sym = base.toUpperCase();

            normalized.push({
              id: sym.toLowerCase(),
              symbol: sym,
              name: COINDCX_NAME_MAP[sym] || sym,
              image:
                COINGECKO_LOGO_MAP[sym] ||
                `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`,
              current_price: last,
              price_change_percentage_24h: chg,
              price_change_percentage_1h_in_currency: 0,
              price_change_percentage_7d_in_currency: 0,
              market_cap: 0,
              total_volume: vol,
              sparkline_in_7d: { price: [] },
              coindcx_market: t.market,
            });
          }
        });
      } else {
        let filtered = tickers;
        if (vs === "usdt") {
          filtered = tickers.filter((t) =>
            String(t.market || "")
              .toUpperCase()
              .endsWith("USDT"),
          );
        } else if (vs === "usd") {
          filtered = tickers.filter((t) =>
            String(t.market || "")
              .toUpperCase()
              .endsWith("USD"),
          );
        }

        normalized = filtered
          .map((t) => {
            const market = String(t.market || "").toUpperCase();
            let base = market;
            if (market.endsWith("INR")) {
              base = market.slice(0, -3);
            } else if (market.endsWith("USDT")) {
              base = market.slice(0, -4);
            } else if (market.endsWith("USD")) {
              base = market.slice(0, -3);
            } else return null;

            const last = parseFloat(
              t.last_price || t.lastPrice || t.price || 0,
            );
            const chg = parseFloat(
              t.change_24_hour || t["24h_change"] || t.change || 0,
            );
            const vol = parseFloat(t.volume || t.volume_24h || 0);

            const sym = base.toUpperCase();
            return {
              id: sym.toLowerCase(),
              symbol: sym,
              name: COINDCX_NAME_MAP[sym] || sym,
              image:
                COINGECKO_LOGO_MAP[sym] ||
                `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`,
              current_price: last,
              price_change_percentage_24h: chg,
              price_change_percentage_1h_in_currency: 0,
              price_change_percentage_7d_in_currency: 0,
              market_cap: 0,
              total_volume: vol,
              sparkline_in_7d: { price: [] },
              coindcx_market: market,
            };
          })
          .filter(Boolean);
      }

      coindcxCache = normalized;
      coindcxCacheTime = now;
      return res.json(normalized);
    } catch (e: any) {
      console.error("CoinDCX ticker error:", e.message);
      if (coindcxCache) return res.json(coindcxCache);
      const offlineTickers = [
        {
          market: "BTCINR",
          last_price: "5867965",
          change_24_hour: "3.09",
          volume: "1240",
        },
        {
          market: "ETHINR",
          last_price: "161928",
          change_24_hour: "5.94",
          volume: "4200",
        },
        {
          market: "SOLINR",
          last_price: "7678",
          change_24_hour: "4.86",
          volume: "18500",
        },
        {
          market: "XRPINR",
          last_price: "104.22",
          change_24_hour: "3.55",
          volume: "65000",
        },
        {
          market: "ADAINR",
          last_price: "15.26",
          change_24_hour: "3.44",
          volume: "22000",
        },
        {
          market: "DOTINR",
          last_price: "81.49",
          change_24_hour: "1.92",
          volume: "9500",
        },
      ];
      const normalizedOffline = offlineTickers.map((t) => {
        const market = t.market;
        const base = market.slice(0, -3);
        const last = parseFloat(t.last_price);
        const chg = parseFloat(t.change_24_hour);
        const vol = parseFloat(t.volume);
        const sym = base.toUpperCase();
        return {
          id: sym.toLowerCase(),
          symbol: sym,
          name: COINDCX_NAME_MAP[sym] || sym,
          image:
            COINGECKO_LOGO_MAP[sym] ||
            `https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/128/color/${sym.toLowerCase()}.png`,
          current_price: last,
          price_change_percentage_24h: chg,
          price_change_percentage_1h_in_currency: 0,
          price_change_percentage_7d_in_currency: 0,
          market_cap: last * 100000,
          total_volume: vol * last,
          sparkline_in_7d: {
            price: Array.from(
              { length: 24 },
              (_, i) => last * (1 + Math.sin(i / 3) * 0.02),
            ),
          },
          coindcx_market: market,
        };
      });
      return res.json(normalizedOffline);
    }
  });

  // ─── MARKET TRENDS ─────────────────────────────────────────────
  router.get("/market-trends", async (req, res) => {
    try {
      const activeKey = await getActiveGeckoKey(req);
      const headers: Record<string, string> = { "User-Agent": "StockWise/1.0" };
      if (activeKey) headers[cgAuthHeaderName(activeKey)] = activeKey;
      const baseUrl = cgBaseUrl(activeKey);

      const options = { headers, signal: makeTimeoutSignal(10000) };
      const [trendRes, fgRes, globalRes] = await Promise.allSettled([
        fetch(`${baseUrl}/api/v3/search/trending`, options),
        fetch("https://api.alternative.me/fng/?limit=1", options),
        fetch(`${baseUrl}/api/v3/global`, options),
      ]);
      const trending =
        trendRes.status === "fulfilled" && trendRes.value.ok
          ? await trendRes.value.json()
          : { coins: [] };
      const fg =
        fgRes.status === "fulfilled" && fgRes.value.ok
          ? await fgRes.value.json()
          : { data: [{ value: "50", value_classification: "Neutral" }] };
      const global =
        globalRes.status === "fulfilled" && globalRes.value.ok
          ? await globalRes.value.json()
          : { data: {} };
      return res.json({
        trending: trending.coins?.slice(0, 7) || [],
        fearGreed: fg.data?.[0] || {},
        global: global.data || {},
      });
    } catch (e: any) {
      return res.json({ trending: [], fearGreed: {}, global: {} });
    }
  });

  // ─── NEWS PROXY ────────────────────────────────────────────────
  const newsCache = new Map<string, { data: any; ts: number }>();
  const NEWS_CACHE_TTL = 10 * 60 * 1000;

  async function fetchFromRss(isStock: boolean): Promise<any[]> {
    const rssUrl = isStock
      ? "https://news.google.com/rss/search?q=stock+market&hl=en-US&gl=US&ceid=US:en"
      : "https://www.coindesk.com/arc/outboundfeeds/rss/";
    const url = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;
    try {
      const r = await fetch(url, { signal: makeTimeoutSignal(8000) });
      if (!r.ok) return [];
      const data = await r.json();
      if (data?.items && Array.isArray(data.items)) {
        return data.items.map((a: any) => ({
          title: a.title,
          url: a.link,
          published_on: new Date(a.pubDate || Date.now()).getTime() / 1000,
          source: { title: a.source?.name || (a.author ? `Google News (${a.author})` : isStock ? "Google News" : "CoinDesk") },
        }));
      }
    } catch {
    }
    return [];
  }

  async function fetchFromNewsApi(query: string): Promise<any[]> {
    if (!NEWSAPI_KEY) return [];
    const isStock = query.includes("stock") || query.includes("finance") || query.includes("wallstreet");
    const q = isStock ? "stock market OR finance" : "cryptocurrency OR bitcoin OR ethereum OR crypto";
    const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${NEWSAPI_KEY}`;
    try {
      const r = await fetch(url, { signal: makeTimeoutSignal(8000) });
      if (!r.ok) return [];
      const data = await r.json();
      if (data.status === "error") return [];
      return (data.articles || []).map((a: any) => ({
        title: a.title,
        url: a.url,
        published_on: new Date(a.publishedAt || Date.now()).getTime() / 1000,
        source: { title: a.source?.name || "NewsAPI" },
      }));
    } catch {
      return [];
    }
  }

  async function fetchFromCryptoCompare(categories: string): Promise<any[]> {
    if (!CRYPTOCOMPARE_API_KEY) return [];
    const url = `https://min-api.cryptocompare.com/data/v2/news/?lang=EN&categories=${encodeURIComponent(categories)}`;
    const headers: Record<string, string> = { "User-Agent": "StockWise/1.0", "api_key": CRYPTOCOMPARE_API_KEY };
    try {
      const r = await fetch(url, { headers, signal: makeTimeoutSignal(8000) });
      if (!r.ok) return [];
      const data = await r.json();
      if (data?.Data && Array.isArray(data.Data)) {
        return data.Data.map((a: any) => ({
          title: a.title,
          url: a.url,
          published_on: a.published_on,
          source: { title: a.source_info?.name || a.source || "CryptoCompare" },
        }));
      }
    } catch {
    }
    return [];
  }

  router.get("/news", publicRL, async (req, res) => {
    const q = String(req.query.q || "").toLowerCase();
    const cacheKey = q || "default";
    const cached = newsCache.get(cacheKey);
    if (cached && Date.now() - cached.ts < NEWS_CACHE_TTL) {
      return res.json(cached.data);
    }

    try {
      const isStock = q.includes("stock") || q.includes("wallstreet") || q.includes("finance");
      const categories = isStock ? "Finance" : "BTC,ETH,SOL,ADA,XRP";

      let results = await fetchFromRss(isStock);
      if (results.length === 0) results = await fetchFromNewsApi(q);
      if (results.length === 0) results = await fetchFromCryptoCompare(categories);

      const payload = { results };
      newsCache.set(cacheKey, { data: payload, ts: Date.now() });
      return res.json(payload);
    } catch {
      if (cached) return res.json(cached.data);
      return res.json({ results: [] });
    }
  });

  // ─── COINGECKO PROXY ──────────────────────────────────────────
  router.get("/trending", publicRL, async (req, res) => {
    const now = Date.now();
    if (trendingCache && now - trendingCacheTime < CACHE_TTL) {
      return res.json(trendingCache);
    }
    try {
      const activeKey = await getActiveGeckoKey(req);
      const baseUrl =
        !activeKey || activeKey.startsWith("CG-")
          ? "https://api.coingecko.com"
          : "https://pro-api.coingecko.com";
      const headers: Record<string, string> = {
        "User-Agent": "StockWise/1.0",
        "Cache-Control": "no-cache",
      };
      if (activeKey)
        headers[
          activeKey.startsWith("CG-") ? "x-cg-demo-api-key" : "x-cg-pro-api-key"
        ] = activeKey;

      const r = await fetch(`${baseUrl}/api/v3/search/trending`, {
        headers,
        signal: makeTimeoutSignal(12000),
      });
      if (!r.ok) {
        if (trendingCache) return res.json(trendingCache);
        return res.status(502).json({ coins: [] });
      }
      const data = await r.json();
      trendingCache = data;
      trendingCacheTime = now;
      return res.json(data);
    } catch {
      return res.json({ coins: [] });
    }
  });

  router.get("/markets", publicRL, async (req, res) => {
    const now = Date.now();
    const currency = String(req.query.vs_currency || "usd");
    const categoryId = String(req.query.category || "");
    const isSparkline =
      req.query.sparkline === "true" || req.query.sparkline === "1";
    const per_page = String(req.query.per_page || "");
    const order = String(req.query.order || "");
    const price_change_percentage = String(req.query.price_change_percentage || "");
    const cacheKey = `${currency}_${isSparkline ? "1" : "0"}_${categoryId}_${per_page || "*"}_${price_change_percentage || "*"}`;
    const cacheTTL = currency === "usd" ? MARKETS_CACHE_TTL : 30000;
    const forceFresh =
      req.query.fresh === "1" ||
      req.query.nocache === "1" ||
      req.query.force === "1";

    if (
      !forceFresh &&
      marketsCache[cacheKey] &&
      now - marketsCacheTime[cacheKey] < cacheTTL
    ) {
      return res.json(marketsCache[cacheKey]);
    }

    try {
      let ids = String(req.query.ids || "");
      const params = new URLSearchParams({ vs_currency: currency });

      if (per_page) params.set("per_page", per_page);
      if (order) params.set("order", order);
      if (isSparkline) params.set("sparkline", "true");
      if (price_change_percentage)
        params.set("price_change_percentage", price_change_percentage);

      const headers: Record<string, string> = {
        "User-Agent": "StockWise/1.0",
        "Cache-Control": "no-cache",
      };

      const activeGeckoKey = await getActiveGeckoKey(req);
      const baseUrl = cgBaseUrl(activeGeckoKey);
      if (activeGeckoKey)
        headers[cgAuthHeaderName(activeGeckoKey)] = activeGeckoKey;

      if (categoryId === "trending") {
        let trendData;
        if (trendingCache && now - trendingCacheTime < CACHE_TTL) {
          trendData = trendingCache;
        } else {
          try {
            const trendingUrl = `${baseUrl}/api/v3/search/trending`;
            if (activeGeckoKey)
              headers[cgAuthHeaderName(activeGeckoKey)] = activeGeckoKey;

            const r = await fetch(trendingUrl, {
              headers,
              signal: makeTimeoutSignal(8000),
            });
            if (r.ok) {
              const data = await r.json();
              trendingCache = data;
              trendingCacheTime = now;
              trendData = data;
            } else {
              trendData = trendingCache;
            }
          } catch (e: any) {
            console.error("Error fetching trending search:", e.message);
            trendData = trendingCache;
          }
        }

        if (trendData && Array.isArray(trendData.coins)) {
          const trendingIds = trendData.coins.map((c: any) => c.item.id).join(",");
          if (trendingIds) {
            ids = trendingIds;
          }
        }

        if (!ids) {
          if (marketsCache[cacheKey]) return res.json(marketsCache[cacheKey]);
          return res
            .status(502)
            .json({ error: "Could not fetch trending coins list" });
        }
      } else if (categoryId) {
        params.set("category", categoryId);
      }

      if (ids) {
        params.set("ids", ids);
      }

      headers["User-Agent"] = "StockWise/1.0";
      headers["Cache-Control"] = "no-cache";
      if (activeGeckoKey)
        headers[cgAuthHeaderName(activeGeckoKey)] = activeGeckoKey;

      const r = await fetch(`${baseUrl}/api/v3/coins/markets?${params}`, {
        headers,
        signal: makeTimeoutSignal(12000),
      });

      if (!r.ok) {
        if (r.status === 429) rotateGeckoKey();
        const errData = await r.json().catch(() => ({}));
        console.error(`CoinGecko API Error (${r.status}):`, errData);
        if (marketsCache[cacheKey]) return res.json(marketsCache[cacheKey]);
        return res
          .status(r.status)
          .json({ error: errData.error || `HTTP ${r.status}` });
      }

      const data = await r.json();
      if (!Array.isArray(data)) {
        if (marketsCache[cacheKey]) return res.json(marketsCache[cacheKey]);
        return res.status(502).json({ error: "Invalid market data format" });
      }
      if (data.length > 0) {
        marketsCache[cacheKey] = data;
        marketsCacheTime[cacheKey] = now;
      }
      return res.json(data);
    } catch (e: any) {
      console.error("Markets fetch error:", e.message);
      if (marketsCache[cacheKey]) return res.json(marketsCache[cacheKey]);

      const seed = Math.floor(Date.now() / 86400000);
      function seeded(i: number) {
        const x = Math.sin(seed * 9301 + i * 49297) * 49297;
        return x - Math.floor(x);
      }

      const topCoins = [
        ["bitcoin","btc","Bitcoin",61585,3.09,1234825975150,28000000000],
        ["ethereum","eth","Ethereum",1699.47,5.94,205092847457,15000000000],
        ["solana","sol","Solana",80.58,4.86,46823654230,3500000000],
        ["ripple","xrp","Ripple",1.094,3.55,68080622540,850000000],
        ["cardano","ada","Cardano",0.1601,3.44,5966587249,420000000],
        ["dogecoin","doge","Dogecoin",0.0746,2.71,11554004185,1200000000],
        ["avalanche","avax","Avalanche",6.76,1.09,2918688913,520000000],
        ["polkadot","dot","Polkadot",0.855,1.92,1446983745,380000000],
        ["chainlink","link","Chainlink",7.86,6.64,5878344070,480000000],
        ["tron","trx","TRON",0.318,0.15,30198156308,290000000],
        ["polygon","matic","Polygon",0.0731,2.81,780527605,310000000],
        ["litecoin","ltc","Litecoin",43.49,3.51,3364248688,290000000],
        ["shiba-inu","shib","Shiba Inu",0.00000432,0.39,2543681274,210000000],
        ["bitcoin-cash","bch","Bitcoin Cash",215.34,2.58,4318823155,180000000],
        ["uniswap","uni","Uniswap",3.2,14.71,1987945546,260000000],
        ["stellar","xlm","Stellar",0.199,-0.61,6769746859,95000000],
        ["cosmos","atom","Cosmos",1.56,1.84,805797893,140000000],
        ["ethereum-classic","etc","Ethereum Classic",7.15,2.63,1119384591,190000000],
        ["monero","xmr","Monero",311.17,1.45,5841470195,78000000],
        ["filecoin","fil","Filecoin",0.777,5.04,618231970,160000000],
        ["aptos","apt","Aptos",0.615,3.66,512288906,290000000],
        ["arbitrum","arb","Arbitrum",0.0779,0.23,495536193,180000000],
        ["optimism","op","Optimism",0.0995,3.24,214929453,120000000],
        ["near","near","NEAR Protocol",1.92,5.14,2494836693,310000000],
        ["vechain","vet","VeChain",0.00457,0.93,393155336,88000000],
        ["algorand","algo","Algorand",0.0867,2.27,775561158,56000000],
        ["internet-computer","icp","Internet Computer",2.22,1.93,1229845442,130000000],
        ["aave","aave","Aave",86.81,0.16,1318015870,95000000],
        ["maker","mkr","Maker",1296.31,5.15,1200000000,42000000],
        ["hedera","hbar","Hedera",0.052,2.1,2600000000,51000000],
        ["the-graph","grt","The Graph",0.0183,2.68,197191987,78000000],
        ["tezos","xtz","Tezos",0.214,1.88,233526251,32000000],
        ["fantom","ftm","Fantom",0.0333,10.35,100000000,140000000],
        ["decentraland","mana","Decentraland",0.0643,1.20,125994219,65000000],
        ["sandbox","sand","The Sandbox",0.065,1.9,870000000,72000000],
        ["axie-infinity","axs","Axie Infinity",1.2,-3.2,1000000000,68000000],
        ["pepe","pepe","Pepe",0.0000065,8.5,5100000000,380000000],
        ["flow","flow","Flow",0.38,-1.4,750000000,39000000],
        ["gala","gala","GALA",0.016,2.7,1100000000,95000000],
        ["immutable","imx","Immutable X",0.52,4.2,3200000000,110000000],
        ["render","rndr","Render",4.85,3.9,3000000000,120000000],
        ["sei","sei","Sei",0.18,6.2,1400000000,98000000],
        ["dydx","dydx","dYdX",0.65,-1.8,1300000000,82000000],
        ["injective","inj","Injective",5.8,8.1,2400000000,150000000],
        ["starknet","strk","StarkNet",0.16,3.5,2100000000,130000000],
        ["celestia","tia","Celestia",2.1,5.2,1400000000,95000000],
        ["sui","sui","Sui",0.62,6.7,4500000000,280000000],
        ["ordi","ordi","ORDI",8.5,-2.5,800000000,65000000],
        ["bonk","bonk","Bonk",0.0000085,9.2,1700000000,190000000],
        ["worldcoin","wld","Worldcoin",0.85,-3.8,1800000000,140000000],
        ["pyth","pyth","Pyth Network",0.14,1.2,1700000000,52000000],
        ["ondo","ondo","Ondo",0.38,4.8,1600000000,78000000],
        ["akash","akt","Akash Network",1.2,2.4,1000000000,38000000],
        ["mina","mina","Mina Protocol",0.18,-0.6,870000000,31000000],
        ["arweave","ar","Arweave",8.5,5.5,2100000000,56000000],
        ["quant","qnt","Quant",52,1.8,1200000000,28000000],
        ["chiliz","chz","Chiliz",0.038,2.1,580000000,41000000],
        ["basic-attention","bat","Basic Attention Token",0.068,-0.9,330000000,18000000],
        ["enjin","enj","Enjin Coin",0.085,1.5,420000000,25000000],
        ["zcash","zec","Zcash",440.67,6.68,7399246997,23000000],
        ["iota","iota","IOTA",0.16,0.7,720000000,28000000],
        ["neo","neo","NEO",1.96,-1.2,137940287,35000000],
        ["celo","celo","Celo",0.22,2.8,460000000,22000000],
        ["kava","kava","Kava",0.18,-0.5,780000000,32000000],
        ["wemix","wemix","WEMIX",0.65,1.8,820000000,25000000],
        ["iotex","iotx","IoTeX",0.012,3.2,420000000,18000000],
        ["oasis","rose","Oasis Network",0.028,1.5,820000000,45000000],
        ["harmony","one","Harmony",0.0052,-0.8,250000000,12000000],
        ["kujira","kuji","Kujira",0.45,4.2,220000000,15000000],
        ["radix","xrd","Radix",0.012,-1.5,400000000,8500000],
        ["casper","cspr","Casper",0.0085,-0.3,380000000,11000000],
        ["multiversx","egld","MultiversX",18.5,3.8,1100000000,42000000],
        ["theta","theta","Theta Network",0.65,2.2,1800000000,45000000],
        ["bittorrent","btt","BitTorrent",0.00000052,0.5,1200000000,28000000],
        ["hive","hive","Hive",0.085,-1.1,150000000,8500000],
        ["waves","waves","Waves",0.55,0.8,210000000,12000000],
        ["skale","skl","SKALE",0.018,3.5,310000000,22000000],
        ["zilliqa","zil","Zilliqa",0.0065,-0.6,380000000,18000000],
        ["nano","xno","Nano",0.65,1.5,160000000,4500000],
      ];

      const offlineCoins = topCoins.map((c, i) => {
        const id = c[0] as string;
        const sym = c[1] as string;
        const name = c[2] as string;
        let basePrice = c[3] as number;
        const baseChange = c[4] as number;
        let baseMcap = c[5] as number;
        let baseVol = c[6] as number;

        const jitter = (seeded(i) - 0.5) * 0.04;
        const price = +(basePrice * (1 + jitter)).toFixed(basePrice < 1 ? 6 : 2);
        const change = +((seeded(i + 100) - 0.5) * 6).toFixed(2);
        const mcap = Math.round(baseMcap * (1 + (seeded(i + 200) - 0.5) * 0.1));
        const vol = Math.round(baseVol * (1 + (seeded(i + 300) - 0.5) * 0.2));

        return {
          id, symbol: sym, name,
          image: `https://ui-avatars.com/api/?name=${sym}&background=111927&color=00e5a0&size=128&font-size=0.4&bold=true`,
          current_price: price,
          price_change_percentage_24h: change,
          price_change_percentage_1h_in_currency: +(change / 24).toFixed(2),
          price_change_percentage_7d_in_currency: +((seeded(i + 400) - 0.5) * 12).toFixed(2),
          market_cap: mcap,
          total_volume: vol,
          sparkline_in_7d: {
            price: Array.from({ length: 24 }, (_, idx) => +(price * (1 + Math.sin(idx / 2.5 + seeded(i + 500) * 6) * 0.015 * seeded(i + 600) + seeded(i + 700) * 0.005)).toFixed(4)),
          },
        };
      });

      const multiplier = currency === "inr" ? 95.3 : 1;
      const normalizedCoins = offlineCoins.map((c) => ({
        ...c,
        current_price: c.current_price * multiplier,
        market_cap: c.market_cap * multiplier,
        total_volume: c.total_volume * multiplier,
        sparkline_in_7d: {
          price: c.sparkline_in_7d.price.map((p: number) => +(p * multiplier).toFixed(4)),
        },
      }));
      return res.json(normalizedCoins);
    }
  });

  router.get("/coingecko-pro-price", publicRL, async (req, res) => {
    const activeKey = await getActiveGeckoKey(req);
    if (!activeKey) {
      console.warn("[CoinGecko Pro] Key not configured. Using fallback mock prices.");
      const mockPrices = {
        bitcoin: {
          usd: 61585,
          eur: 53783,
          btc: 1.0,
          usd_market_cap: 1234825975150,
          usd_24h_change: 3.09,
        },
        ethereum: {
          usd: 1699.47,
          eur: 1484.25,
          btc: 0.0276,
          usd_market_cap: 205092847457,
          usd_24h_change: 5.94,
        },
        solana: {
          usd: 80.58,
          eur: 70.35,
          btc: 0.00131,
          usd_market_cap: 46823654230,
          usd_24h_change: 4.86,
        },
        cardano: {
          usd: 0.1601,
          eur: 0.14,
          btc: 0.0000026,
          usd_market_cap: 5966587249,
          usd_24h_change: 3.44,
        },
      };
      return res.json(mockPrices);
    }

    const ids = String(req.query.ids || "bitcoin,ethereum,solana,cardano");
    const vs_currencies = String(req.query.vs_currencies || "usd,eur,btc");
    const include_market_cap =
      req.query.include_market_cap === "true" ? "true" : "true";
    const include_24hr_change =
      req.query.include_24hr_change === "true" ? "true" : "true";

    const params = new URLSearchParams({
      ids,
      vs_currencies,
      include_market_cap,
      include_24hr_change,
    });

    try {
      const r = await fetch(
        `${cgBaseUrl(activeKey)}/api/v3/simple/price?${params.toString()}`,
        {
          headers: {
            [cgAuthHeaderName(activeKey)]: activeKey,
            "User-Agent": "StockWise/1.0",
          },
          signal: makeTimeoutSignal(10000),
        },
      );

      if (!r.ok) {
        const errBody = await r.text().catch(() => "");
        console.error("CoinGecko Pro error:", r.status, errBody);
        return res
          .status(r.status)
          .json({ error: "CoinGecko Pro request failed" });
      }

      const data = await r.json();
      return res.json(data);
    } catch (e: any) {
      console.error("CoinGecko Pro fetch error:", e.message);
      const mockPrices = {
        bitcoin: {
          usd: 68500,
          eur: 63200,
          btc: 1.0,
          usd_market_cap: 1350000000000,
          usd_24h_change: 2.5,
        },
        ethereum: {
          usd: 3650,
          eur: 3370,
          btc: 0.053,
          usd_market_cap: 440000000000,
          usd_24h_change: -1.2,
        },
        solana: {
          usd: 155,
          eur: 143,
          btc: 0.0022,
          usd_market_cap: 70000000000,
          usd_24h_change: 5.8,
        },
        cardano: {
          usd: 0.48,
          eur: 0.44,
          btc: 0.000007,
          usd_market_cap: 17000000000,
          usd_24h_change: -2.1,
        },
      };
      return res.json(mockPrices);
    }
  });

  router.get("/coingecko-categories", publicRL, async (req, res) => {
    try {
      const activeKey = await getActiveGeckoKey(req);
      const baseUrl = cgBaseUrl(activeKey);
      const headers: Record<string, string> = { "User-Agent": "StockWise/1.0" };
      if (activeKey) headers[cgAuthHeaderName(activeKey)] = activeKey;

      const r = await fetch(`${baseUrl}/api/v3/coins/categories/list`, {
        headers,
        signal: makeTimeoutSignal(10000),
      });
      if (!r.ok) return res.json([]);
      const data = await r.json();
      return res.json(data);
    } catch {
      return res.json([]);
    }
  });

  router.get("/fear-greed", publicRL, async (req, res) => {
    const now = Date.now();
    if (fearGreedCache && now - fearGreedCacheTime < CACHE_TTL) {
      return res.json(fearGreedCache);
    }
    try {
      const r = await fetch("https://api.alternative.me/fng/?limit=1", {
        headers: { "User-Agent": "StockWise/1.0" },
        signal: makeTimeoutSignal(8000),
      });
      if (!r.ok) {
        if (fearGreedCache) return res.json(fearGreedCache);
        return res.status(502).json({ data: [] });
      }
      const data = await r.json();
      fearGreedCache = data;
      fearGreedCacheTime = now;
      return res.json(data);
    } catch {
      return res.json({ data: [] });
    }
  });

  router.get("/coins/:id/chart", publicRL, async (req, res) => {
    const { id } = req.params;
    const { days = 7, currency = "usd" } = req.query;
    const vsCurr = currency === "usdt" ? "usd" : currency;
    try {
      const activeKey = await getActiveGeckoKey(req);
      const baseUrl = cgBaseUrl(activeKey);
      const headers: Record<string, string> = { "User-Agent": "StockWise/1.0" };
      if (activeKey) headers[cgAuthHeaderName(activeKey)] = activeKey;

      const r = await fetch(
        `${baseUrl}/api/v3/coins/${id}/market_chart?vs_currency=${vsCurr}&days=${days}`,
        {
          headers,
          signal: makeTimeoutSignal(10000),
        },
      );
      if (!r.ok)
        return res.status(502).json({ error: "Failed to fetch chart data" });
      const data = await r.json();
      return res.json(data);
    } catch {
      return res.status(502).json({ error: "Failed to fetch chart data" });
    }
  });

  router.get("/rates", publicRL, async (req, res) => {
    const now = Date.now();
    if (rateCacheTime && now - rateCacheTime < 60000) {
      return res.json({ usd_inr: inrUsdRate });
    }
    try {
      const r = await fetch("https://api.coindcx.com/exchange/ticker", {
        headers: { "User-Agent": "StockWise/1.0" },
        signal: makeTimeoutSignal(8000),
      });
      if (r.ok) {
        const tickers = await r.json();
        if (Array.isArray(tickers)) {
          const usdtInrTicker = tickers.find(
            (t) => String(t.market || "").toUpperCase() === "USDTINR",
          );
          if (usdtInrTicker) {
            const price = parseFloat(
              usdtInrTicker.last_price ||
                usdtInrTicker.lastPrice ||
                usdtInrTicker.price ||
                0,
            );
            if (price > 0) {
              inrUsdRate = price;
              rateCacheTime = now;
              return res.json({ usd_inr: inrUsdRate });
            }
          }
        }
      }
    } catch (e: any) {
      console.error("[rates] CoinDCX rate fetch error:", e);
    }

    try {
      const activeKey = await getActiveGeckoKey(req);
      const baseUrl = cgBaseUrl(activeKey);
      const headers: Record<string, string> = { "User-Agent": "StockWise/1.0" };
      if (activeKey) headers[cgAuthHeaderName(activeKey)] = activeKey;

      const r = await fetch(
        `${baseUrl}/api/v3/simple/price?ids=tether&vs_currencies=inr`,
        {
          headers,
          signal: makeTimeoutSignal(8000),
        },
      );
      const data = await r.json();
      if (data.tether?.inr) {
        inrUsdRate = data.tether.inr;
        rateCacheTime = now;
      }
      return res.json({ usd_inr: inrUsdRate });
    } catch {
      return res.json({ usd_inr: inrUsdRate });
    }
  });

  // ─── LIVE CANDLES PROXY ENDPOINT ───────────────────────────
  router.get("/live-candles", publicRL, async (req, res) => {
    const symbol = String(req.query.symbol || "BTC");
    const currency = String(req.query.currency || "USDT");
    const timeframe = String(req.query.timeframe || "1h");
    const limit = parseInt(String(req.query.limit), 10) || 60;

    try {
      if (currency === "INR") {
        const pair = `I-${symbol}_INR`;
        const url = `https://public.coindcx.com/market_data/candles?pair=${pair}&interval=${timeframe}&limit=${limit}`;
        const r = await fetch(url, { signal: makeTimeoutSignal(8000) });
        if (r.ok) {
          const data = await r.json();
          return res.json(data);
        }
      } else {
        const binanceSym = `${symbol}USDT`;
        const url = `https://api.binance.com/api/v3/klines?symbol=${binanceSym}&interval=${timeframe}&limit=${limit}`;
        const r = await fetch(url, { signal: makeTimeoutSignal(8000) });
        if (r.ok) {
          const data = await r.json();
          return res.json(data);
        }
      }
      return res
        .status(502)
        .json({ error: "Failed to fetch live candles from external APIs" });
    } catch (e: any) {
      console.error("live-candles proxy error:", e.message);
      return res.status(502).json({ error: "Failed to fetch live candles" });
    }
  });

  return router;
};
