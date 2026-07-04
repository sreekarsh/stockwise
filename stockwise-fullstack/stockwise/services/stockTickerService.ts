import { latestPrices } from "./websocketService.js";

const STOCK_SYMBOLS = [
  { symbol: "RELIANCE", base: 2900 }, { symbol: "TCS", base: 3950 },
  { symbol: "HDFCBANK", base: 1740 }, { symbol: "INFY", base: 1800 },
  { symbol: "ICICIBANK", base: 1240 }, { symbol: "HINDUNILVR", base: 2640 },
  { symbol: "SBIN", base: 830 }, { symbol: "BHARTIARTL", base: 1680 },
  { symbol: "TATAMOTORS", base: 880 }, { symbol: "KOTAKBANK", base: 1850 },
  { symbol: "ITC", base: 455 }, { symbol: "AXISBANK", base: 1180 },
  { symbol: "LT", base: 3500 }, { symbol: "JSWSTEEL", base: 850 },
  { symbol: "ASIANPAINT", base: 2950 }, { symbol: "NTPC", base: 330 },
  { symbol: "MARUTI", base: 12800 }, { symbol: "NESTLEIND", base: 2280 },
  { symbol: "ONGC", base: 305 }, { symbol: "COALINDIA", base: 465 },
  { symbol: "ULTRACEMCO", base: 11200 }, { symbol: "TITAN", base: 3200 },
  { symbol: "TATASTEEL", base: 175 }, { symbol: "SUNPHARMA", base: 1780 },
  { symbol: "DMART", base: 4280 }, { symbol: "WIPRO", base: 290 },
  { symbol: "HCLTECH", base: 1750 }, { symbol: "SBILIFE", base: 1650 },
  { symbol: "HDFCLIFE", base: 680 }, { symbol: "POWERGRID", base: 320 },
  { symbol: "CIPLA", base: 1850 }, { symbol: "TECHM", base: 1780 },
  { symbol: "BAJAJFINSV", base: 1680 }, { symbol: "BRITANNIA", base: 5350 },
  { symbol: "GODREJCP", base: 1620 }, { symbol: "PIDILITIND", base: 3150 },
  { symbol: "M&M", base: 3120 }, { symbol: "EICHERMOT", base: 8350 },
  { symbol: "SHREECEM", base: 25000 }, { symbol: "DRREDDY", base: 1180 },
  { symbol: "INDUSINDBK", base: 580 }, { symbol: "IOC", base: 145 },
  { symbol: "HEROMOTOCO", base: 6200 }, { symbol: "BAJAJ-AUTO", base: 9350 },
  { symbol: "ADANIPORTS", base: 1580 }, { symbol: "BPCL", base: 520 },
  { symbol: "ADANIENT", base: 2950 }, { symbol: "BAJFINANCE", base: 7300 },
  { symbol: "VEDL", base: 480 },   { symbol: "ZOMATO", base: 245 },
  // ── NIFTY NEXT 50 ──────────────────────────────────────────
  { symbol: "SIEMENS", base: 7800 }, { symbol: "AMBUJACEM", base: 620 },
  { symbol: "DABUR", base: 575 }, { symbol: "MARICO", base: 630 },
  { symbol: "MUTHOOTFIN", base: 1700 }, { symbol: "NAUKRI", base: 8500 },
  { symbol: "HAVELLS", base: 1850 }, { symbol: "TORNTPHARM", base: 2700 },
  { symbol: "INDHOTEL", base: 800 }, { symbol: "TATACOMM", base: 1950 },
  { symbol: "LUPIN", base: 1650 }, { symbol: "AUROPHARMA", base: 1300 },
  { symbol: "GAIL", base: 210 }, { symbol: "INDIGO", base: 4300 },
  { symbol: "BANKBARODA", base: 265 }, { symbol: "CANBK", base: 120 },
  { symbol: "COLPAL", base: 2800 }, { symbol: "BERGEPAINT", base: 520 },
  { symbol: "ALKEM", base: 5400 }, { symbol: "GLAND", base: 2000 },
  { symbol: "TATAPOWER", base: 460 }, { symbol: "SAIL", base: 160 },
  { symbol: "PETRONET", base: 330 }, { symbol: "CONCOR", base: 1100 },
  { symbol: "PAGEIND", base: 42000 }, { symbol: "MPHASIS", base: 3000 },
  { symbol: "COFORGE", base: 6800 }, { symbol: "LTI", base: 5600 },
  { symbol: "PERSISTENT", base: 8800 }, { symbol: "POLYCAB", base: 6800 },
  { symbol: "ABCAPITAL", base: 200 }, { symbol: "FEDERALBNK", base: 165 },
  { symbol: "EXIDEIND", base: 380 }, { symbol: "SUPREMEIND", base: 5800 },
  { symbol: "TATAELXSI", base: 7500 }, { symbol: "LAURUSLABS", base: 430 },
  { symbol: "STARHEALTH", base: 580 }, { symbol: "SUNDRMFAST", base: 1400 },
  { symbol: "IPCALAB", base: 1500 }, { symbol: "ICICIPRULI", base: 650 },
  { symbol: "CUMMINSIND", base: 3800 }, { symbol: "GLAXO", base: 2800 },
  { symbol: "HONAUT", base: 58000 }, { symbol: "BBTC", base: 1800 },
  { symbol: "KAJARIACER", base: 1500 }, { symbol: "AAVAS", base: 1900 },
  { symbol: "KANSAINER", base: 330 }, { symbol: "CROMPTON", base: 390 },
  { symbol: "VBL", base: 1700 }, { symbol: "ASTRAL", base: 2200 },
  { symbol: "IRCTC", base: 1200 }, { symbol: "ABFRL", base: 260 },
  { symbol: "ATUL", base: 7500 }, { symbol: "BAJAJHFL", base: 400 },
  { symbol: "CEATLTD", base: 3200 }, { symbol: "CHOLAFIN", base: 1300 },
  { symbol: "DELHIVERY", base: 470 }, { symbol: "DEEPAKNI", base: 3000 },
  { symbol: "JKCEMENT", base: 4500 }, { symbol: "KPITTECH", base: 1800 },
  { symbol: "NYKAA", base: 165 }, { symbol: "PAYTM", base: 900 },
  { symbol: "POLICYBZR", base: 1400 }, { symbol: "TRENT", base: 5500 },
  { symbol: "SBICARD", base: 750 }, { symbol: "CLEAN", base: 1500 },
  { symbol: "HFCL", base: 100 }, { symbol: "IDFC", base: 125 },
  { symbol: "IDFCFIRSTB", base: 85 }, { symbol: "IRFC", base: 185 },
  { symbol: "JYOTHYLAB", base: 550 }, { symbol: "NATCOPHARM", base: 1650 },
  { symbol: "PGHH", base: 18000 }, { symbol: "RATNAMANI", base: 3800 },
  { symbol: "SUNDARBFIN", base: 4800 }, { symbol: "TEXRAIL", base: 200 },
  { symbol: "UJJIVANSFB", base: 55 }, { symbol: "VSTIND", base: 4200 },
  { symbol: "WHIRLPOOL", base: 1600 }, { symbol: "ZYDUSLIFE", base: 1100 },
  { symbol: "ANGELONE", base: 3200 }, { symbol: "BIKAJI", base: 800 },
  { symbol: "BALRAMCHIN", base: 600 }, { symbol: "CAMPUS", base: 280 },
  { symbol: "DELTACORP", base: 150 }, { symbol: "EMAMILTD", base: 600 },
  { symbol: "FINEORG", base: 5500 }, { symbol: "GESHIP", base: 1200 },
  { symbol: "HAPPYFORGE", base: 1200 }, { symbol: "IDEAFORGE", base: 700 },
  { symbol: "JUBLPHARMA", base: 800 }, { symbol: "KFINTECH", base: 1200 },
  { symbol: "LATENTVIEW", base: 580 }, { symbol: "METROPOLIS", base: 2100 },
  { symbol: "NAZARA", base: 900 }, { symbol: "OLECTRA", base: 1600 },
  { symbol: "RAINBOW", base: 1600 }, { symbol: "SAPPHIRE", base: 350 },
  { symbol: "SENCO", base: 500 }, { symbol: "TEAMLEASE", base: 3200 },
];

const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 10000;

export function startStockTickerStream(io: any) {
  if (!io) {
    console.warn("[StockTicker] No Socket.IO instance provided.");
    return;
  }

  let timer: any = null;

  async function pollStocks() {
    try {
      const chunks: any[][] = [];
      for (let i = 0; i < STOCK_SYMBOLS.length; i += BATCH_SIZE) {
        chunks.push(STOCK_SYMBOLS.slice(i, i + BATCH_SIZE));
      }

      const responses = await Promise.allSettled(
        chunks.map(async (chunk) => {
          const yahooTickers = chunk.map((s) => `${s.symbol}.NS`);
          const url = `https://query1.finance.yahoo.com/v8/finance/spark?symbols=${encodeURIComponent(yahooTickers.join(","))}&range=1d&interval=5m`;
          const ac = new AbortController();
          const t = setTimeout(() => ac.abort(), 10000);
          t.unref();
          const res = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            },
            signal: ac.signal,
          });
          clearTimeout(t);
          if (!res.ok) throw new Error(`Yahoo returned ${res.status}`);
          return res.json();
        }),
      );

      const updates: Array<{ symbol: string; current_price: number; price_change_percentage_24h: number }> = [];

      for (const result of responses) {
        if (result.status !== "fulfilled" || !result.value) continue;
        const data = result.value;
        if (!data || typeof data !== "object") continue;
        for (const [ticker, info] of Object.entries(data)) {
          if (!info || typeof info !== "object") continue;
          const r = info as any;
          if (!Array.isArray(r.close)) continue;
          const closes = r.close.filter((p: any) => p != null && Number.isFinite(p));
          if (closes.length === 0) continue;
          const price = closes[closes.length - 1];
          const prevClose = r.previousClose != null ? r.previousClose : closes[0];
          const changePercent = prevClose ? ((price - prevClose) / prevClose) * 100 : 0;
          const symbol = (ticker as string).replace(".NS", "");
          updates.push({
            symbol,
            current_price: price,
            price_change_percentage_24h: +changePercent.toFixed(2),
          });
        }
      }

      if (updates.length > 0) {
        for (const u of updates) {
          latestPrices[u.symbol] = u.current_price;
        }
        io.emit("stockUpdates", updates);
      }
    } catch (err) {
      console.error("[StockTicker] Poll failed:", err);
    }
  }

  pollStocks();
  timer = setInterval(pollStocks, POLL_INTERVAL_MS);

  return () => {
    if (timer) clearInterval(timer);
  };
}
