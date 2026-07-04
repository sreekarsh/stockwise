"""
Data Ingestion — Binance Public REST API
========================================
Fetches real OHLCV (Open, High, Low, Close, Volume) candle data,
funding rates, and open interest from Binance without any API key.

All public endpoints — no authentication required.
"""

import time
import logging
import math
from typing import Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

BINANCE_BASE  = "https://api.binance.com"
BINANCE_FAPI  = "https://fapi.binance.com"   # futures — for funding/OI
TIMEOUT       = 20
MAX_RETRIES   = 5

# CoinGecko id → Binance USDT perpetual symbol mapping
COINGECKO_TO_BINANCE = {
    "bitcoin":        "BTCUSDT",
    "ethereum":       "ETHUSDT",
    "solana":         "SOLUSDT",
    "binancecoin":    "BNBUSDT",
    "ripple":         "XRPUSDT",
    "cardano":        "ADAUSDT",
    "avalanche-2":    "AVAXUSDT",
    "dogecoin":       "DOGEUSDT",
    "matic-network":  "MATICUSDT",
    "chainlink":      "LINKUSDT",
    "near":           "NEARUSDT",
    "arbitrum":       "ARBUSDT",
    "polkadot":       "DOTUSDT",
    "uniswap":        "UNIUSDT",
    "cosmos":         "ATOMUSDT",
    "shiba-inu":      "SHIBUSDT",
    "litecoin":       "LTCUSDT",
    "optimism":       "OPUSDT",
    "aptos":          "APTUSDT",
    "aave":           "AAVEUSDT",
}

def _get(url: str, params: dict = None) -> dict:
    """HTTP GET with exponential backoff."""
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            r = requests.get(url, params=params, timeout=TIMEOUT)
            if r.status_code == 429:
                wait = 10 * attempt
                logger.warning("Rate limit hit. Sleeping %ds (attempt %d/%d)", wait, attempt, MAX_RETRIES)
                time.sleep(wait)
                continue
            r.raise_for_status()
            return r.json()
        except requests.exceptions.RequestException as e:
            # If it's a client error (e.g. 400 Bad Request), do not retry
            if isinstance(e, requests.exceptions.HTTPError) and e.response is not None and 400 <= e.response.status_code < 500:
                raise
            if attempt == MAX_RETRIES:
                raise
            wait = 2 ** attempt
            logger.warning("Request failed (%s), retry %d/%d in %ds", e, attempt, MAX_RETRIES, wait)
            time.sleep(wait)
    raise RuntimeError(f"All retries exhausted for {url}")


def fetch_binance_ohlcv(
    binance_symbol: str,
    interval: str = "1h",
    limit: int = 500,
) -> List[Dict]:
    """
    Fetch OHLCV candles from Binance spot klines.

    Returns list of dicts:
      { timestamp_ms, open, high, low, close, volume }
    sorted ascending by time.
    """
    url = f"{BINANCE_BASE}/api/v3/klines"
    params = {"symbol": binance_symbol, "interval": interval, "limit": limit}
    data = _get(url, params)
    result = []
    for candle in data:
        result.append({
            "timestamp_ms": int(candle[0]),
            "open":   float(candle[1]),
            "high":   float(candle[2]),
            "low":    float(candle[3]),
            "close":  float(candle[4]),
            "volume": float(candle[5]),
        })
    result.sort(key=lambda x: x["timestamp_ms"])
    return result


def fetch_funding_rate(binance_symbol: str) -> float:
    """
    Fetch the latest perpetual futures funding rate for a symbol.
    Returns the funding rate as a float (e.g., 0.0001 = 0.01%).
    Returns 0.0 if not available (e.g., not a futures market).
    """
    try:
        url = f"{BINANCE_FAPI}/fapi/v1/fundingRate"
        params = {"symbol": binance_symbol, "limit": 1}
        data = _get(url, params)
        if data and isinstance(data, list):
            return float(data[-1].get("fundingRate", 0.0))
    except Exception as e:
        logger.debug("Funding rate unavailable for %s: %s", binance_symbol, e)
    return 0.0


def fetch_open_interest(binance_symbol: str) -> Tuple[float, float]:
    """
    Fetch current open interest + 4H-ago open interest for divergence calc.
    Returns (current_oi_usd, pct_change_4h).
    """
    try:
        # Current OI
        url_now = f"{BINANCE_FAPI}/fapi/v1/openInterest"
        now_data = _get(url_now, {"symbol": binance_symbol}, base=BINANCE_FAPI)
        current_oi = float(now_data.get("openInterest", 0.0))

        # Historical OI for 4H change (index 1 ≈ 4 hours ago with limit=5, period=1h)
        url_hist = f"{BINANCE_FAPI}/futures/data/openInterestHist"
        hist_data = _get(url_hist, {
            "symbol": binance_symbol,
            "period": "1h",
            "limit": 5,
        })

        if hist_data and len(hist_data) >= 2:
            oi_4h_ago = float(hist_data[1].get("sumOpenInterest", current_oi))
            oi_change_pct = (current_oi - oi_4h_ago) / (oi_4h_ago + 1e-12) * 100
            return current_oi, oi_change_pct
    except Exception as e:
        logger.debug("OI unavailable for %s: %s", binance_symbol, e)
    return 0.0, 0.0


def fetch_multi_symbol_ohlcv(
    coingecko_ids: List[str],
    days: int = 90,
    interval: str = "1h",
) -> Dict[str, List[Dict]]:
    """
    Fetch OHLCV candles for multiple symbols.
    Returns { coingecko_id: [candle_dict, ...] }.

    Automatically maps CoinGecko IDs → Binance symbols.
    Skips any symbol not in the mapping (gracefully).
    """
    # Binance max per request depends on interval
    # 1h → 500 candles ≈ 20 days; for 90 days we need ~2160 candles
    # We paginate: fetch in chunks of 500

    hours_needed = days * 24
    candles_per_req = 500

    result = {}
    interval_ms = {
        "1h": 3_600_000,
        "4h": 14_400_000,
        "1d": 86_400_000,
    }.get(interval, 3_600_000)

    for cg_id in coingecko_ids:
        binance_sym = COINGECKO_TO_BINANCE.get(cg_id)
        if not binance_sym:
            logger.warning("No Binance mapping for %s — skipping", cg_id)
            continue

        logger.info("Fetching %s (%s) — %d days hourly...", cg_id, binance_sym, days)
        all_candles = []

        end_time_ms = int(time.time() * 1000)
        start_time_ms = end_time_ms - hours_needed * interval_ms

        current_start = start_time_ms
        consecutive_failures = 0
        max_consecutive_failures = 3
        
        while current_start < end_time_ms:
            current_end = min(current_start + candles_per_req * interval_ms, end_time_ms)
            try:
                url = f"{BINANCE_BASE}/api/v3/klines"
                params = {
                    "symbol":    binance_sym,
                    "interval":  interval,
                    "startTime": current_start,
                    "endTime":   current_end,
                    "limit":     candles_per_req,
                }
                raw = _get(url, params)
                
                if not raw:
                    # No more data available
                    logger.debug("No data returned for %s at %d, stopping", cg_id, current_start)
                    break
                
                batch = [{
                    "timestamp_ms": int(c[0]),
                    "open":   float(c[1]),
                    "high":   float(c[2]),
                    "low":    float(c[3]),
                    "close":  float(c[4]),
                    "volume": float(c[5]),
                } for c in raw]
                all_candles.extend(batch)
                
                # Move to next batch - use the last timestamp + interval
                last_timestamp = int(raw[-1][0])
                current_start = last_timestamp + interval_ms
                consecutive_failures = 0
                time.sleep(0.15)   # be nice to Binance rate limits
                
            except Exception as e:
                consecutive_failures += 1
                logger.error("Failed batch for %s at %d: %s (failure %d/%d)", cg_id, current_start, e, consecutive_failures, max_consecutive_failures)
                if consecutive_failures >= max_consecutive_failures:
                    logger.error("Too many consecutive failures for %s, stopping", cg_id)
                    break
                # Move forward anyway to avoid infinite loop
                current_start = min(current_start + candles_per_req * interval_ms, end_time_ms)
                time.sleep(2 ** consecutive_failures)  # exponential backoff

        if all_candles:
            all_candles.sort(key=lambda x: x["timestamp_ms"])
            # Deduplicate by timestamp
            seen = set()
            deduped = []
            for c in all_candles:
                if c["timestamp_ms"] not in seen:
                    seen.add(c["timestamp_ms"])
                    deduped.append(c)
            result[cg_id] = deduped
            logger.info("  %s: %d candles fetched", cg_id, len(deduped))
        else:
            logger.warning("  %s: no candles received", cg_id)

        time.sleep(0.5)   # inter-symbol pause

    return result


def fetch_derivatives_snapshot(coingecko_id: str) -> Dict[str, float]:
    """
    Fetch funding rate + open interest for a given coin.
    Returns dict with 'funding_rate' and 'oi_change_pct'.
    """
    binance_sym = COINGECKO_TO_BINANCE.get(coingecko_id, "")
    if not binance_sym:
        return {"funding_rate": 0.0, "oi_change_pct": 0.0}

    funding = fetch_funding_rate(binance_sym)
    oi_current, oi_change = fetch_open_interest(binance_sym)
    return {
        "funding_rate": funding,
        "oi_change_pct": oi_change,
        "oi_usd": oi_current,
    }


def fetch_global_indicators(days: int = 90) -> Dict[str, Dict[int, float]]:
    """
    Fetch S&P 500 (^GSPC) and US Dollar Index (DX-Y.NYB) hourly close prices using yfinance.
    Returns a dict mapping ticker name to a dictionary of { timestamp_ms: close_price }.
    """
    import yfinance as yf
    from datetime import datetime, timedelta

    end_dt = datetime.utcnow()
    start_dt = end_dt - timedelta(days=days)
    
    tickers = ["^GSPC", "DX-Y.NYB"]
    result = {"^GSPC": {}, "DX-Y.NYB": {}}
    
    try:
        data = yf.download(tickers, start=start_dt, end=end_dt, interval="1h", group_by="ticker", progress=False)
        for ticker in tickers:
            if ticker in data.columns.levels[0]:
                df = data[ticker]
                for idx, row in df.iterrows():
                    ts_ms = int(idx.timestamp() * 1000)
                    close_val = float(row["Close"])
                    if not math.isnan(close_val):
                        result[ticker][ts_ms] = close_val
    except Exception as e:
        logger.error("Failed to fetch global indicators via yfinance: %s", e)
        
    return result


def fetch_btc_dominance() -> float:
    """
    Fetch the latest Bitcoin market cap dominance percentage from CoinGecko.
    Returns value as a percentage float (e.g., 52.42).
    """
    try:
        url = "https://api.coingecko.com/api/v3/global"
        r = requests.get(url, timeout=TIMEOUT)
        r.raise_for_status()
        res = r.json()
        if "data" in res and "market_cap_percentage" in res["data"]:
            return float(res["data"]["market_cap_percentage"].get("btc", 50.0))
    except Exception as e:
        logger.warning("Failed to fetch BTC dominance from CoinGecko: %s. Using default 50.0.", e)
    return 50.0


# ─── CLI test ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import json
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    print("\n=== Testing Binance OHLCV fetch (BTC, last 5 candles) ===")
    candles = fetch_binance_ohlcv("BTCUSDT", interval="1h", limit=5)
    for c in candles:
        print(f"  {c['timestamp_ms']}  O={c['open']:.2f}  H={c['high']:.2f}  L={c['low']:.2f}  C={c['close']:.2f}  V={c['volume']:.2f}")

    print("\n=== Testing derivatives snapshot (BTC) ===")
    deriv = fetch_derivatives_snapshot("bitcoin")
    print(json.dumps(deriv, indent=2))

    print("\n=== Testing multi-symbol (BTC + ETH, 3 days) ===")
    multi = fetch_multi_symbol_ohlcv(["bitcoin", "ethereum"], days=3)
    for sym, candles in multi.items():
        print(f"  {sym}: {len(candles)} candles, last close={candles[-1]['close']:.2f}")
    print("\n✅ data_ingestion.py OK")
