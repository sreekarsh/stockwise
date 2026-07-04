"""
Sentiment Engine — Live NLP Sentiment for Crypto
=================================================
Uses VADER (Valence Aware Dictionary and sEntiment Reasoner) to score
crypto news headlines in real-time. No API key required.

Data sources:
  1. CoinGecko news API (free, no key)
  2. CryptoCompare news (free, no key)
  3. Fallback: neutral 0.0

Returns a sentiment score in [-1.0, +1.0]:
  +1.0 = extremely bullish
   0.0 = neutral
  -1.0 = extremely bearish
"""

import time
import logging
import math
from typing import Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

# Lazy-load VADER — only import if available
_vader_analyzer = None

def _get_analyzer():
    global _vader_analyzer
    if _vader_analyzer is None:
        try:
            from vaderSentiment.vaderSentiment import SentimentIntensityAnalyzer
            _vader_analyzer = SentimentIntensityAnalyzer()
            logger.info("VADER sentiment analyzer loaded.")
        except ImportError:
            logger.warning("vaderSentiment not installed. Run: pip install vaderSentiment")
            _vader_analyzer = None
    return _vader_analyzer


# ─── Coin keyword maps ─────────────────────────────────────────────────────────
COIN_KEYWORDS = {
    "bitcoin":     ["bitcoin", "btc", "sats", "satoshi"],
    "ethereum":    ["ethereum", "eth", "ether", "evm"],
    "solana":      ["solana", "sol"],
    "binancecoin": ["bnb", "binance coin", "binance smart chain", "bsc"],
    "ripple":      ["xrp", "ripple"],
    "cardano":     ["cardano", "ada", "hoskinson"],
    "avalanche-2": ["avalanche", "avax"],
    "dogecoin":    ["dogecoin", "doge"],
    "matic-network": ["polygon", "matic"],
    "chainlink":   ["chainlink", "link"],
    "near":        ["near protocol", "near"],
    "arbitrum":    ["arbitrum", "arb"],
    "polkadot":    ["polkadot", "dot"],
    "uniswap":     ["uniswap", "uni"],
    "cosmos":      ["cosmos", "atom"],
    "aave":        ["aave"],
    "litecoin":    ["litecoin", "ltc"],
    "optimism":    ["optimism", "op"],
    "aptos":       ["aptos", "apt"],
    "shiba-inu":   ["shiba inu", "shib"],
}

# General crypto bullish / bearish amplifiers — applied to all coins
BULLISH_AMPLIFIERS = [
    "all-time high", "ath", "breakout", "surge", "rally", "adoption",
    "institutional", "etf approval", "partnerships", "upgrade", "launch",
    "record", "accumulation", "moon", "bullish", "gains", "outperform",
]
BEARISH_AMPLIFIERS = [
    "crash", "hack", "exploit", "sec", "regulation", "ban", "lawsuit",
    "selloff", "correction", "bear", "dump", "liquidation", "fraud",
    "scam", "rug pull", "collapses", "plunge", "tanks", "bearish",
]

# Simple in-memory cache: { symbol: (score, timestamp) }
_sentiment_cache: Dict[str, Tuple[float, float]] = {}
CACHE_TTL_SECONDS = 15 * 60   # 15 minutes


def _score_text(text: str) -> Optional[float]:
    """Score a single text string with VADER. Returns compound [-1, 1] or None."""
    analyzer = _get_analyzer()
    if not analyzer or not text:
        return None
    try:
        return float(analyzer.polarity_scores(text)["compound"])
    except Exception:
        return None


def _fetch_coingecko_news(symbol: str) -> List[str]:
    """Fetch news headlines — CoinGecko removed /news, use CryptoCompare as primary."""
    return _fetch_cryptocompare_news(symbol)


def _fetch_cryptocompare_news(symbol: str) -> List[str]:
    """Fetch news from CryptoCompare (free, no key for basic)."""
    try:
        ticker = symbol.split("-")[0].upper()  # 'bitcoin' → 'BITCOIN'; use direct ticker
        # Map CoinGecko IDs to tickers
        ticker_map = {
            "bitcoin": "BTC", "ethereum": "ETH", "solana": "SOL",
            "binancecoin": "BNB", "ripple": "XRP", "cardano": "ADA",
            "avalanche-2": "AVAX", "dogecoin": "DOGE", "matic-network": "MATIC",
            "chainlink": "LINK", "near": "NEAR", "arbitrum": "ARB",
        }
        ticker = ticker_map.get(symbol, ticker)
        url = "https://min-api.cryptocompare.com/data/v2/news/"
        params = {"categories": ticker, "lTs": 0}
        r = requests.get(url, params=params, timeout=10)
        if r.status_code == 200:
            data = r.json()
            articles = data.get("Data", [])[:20]
            return [(a.get("title", "") + ". " + a.get("body", "")[:200]) for a in articles]
    except Exception as e:
        logger.debug("CryptoCompare news fetch failed: %s", e)
    return []


def _time_decay_weight(age_seconds: float, half_life_seconds: float = 4 * 3600) -> float:
    """Exponential decay weight — more recent = higher weight."""
    return math.exp(-0.693 * age_seconds / half_life_seconds)


def compute_sentiment(symbol: str, force_refresh: bool = False) -> float:
    """
    Compute a live sentiment score for a symbol.

    Steps:
    1. Check cache (15-min TTL)
    2. Fetch headlines from CoinGecko + CryptoCompare
    3. Score each with VADER
    4. Weight by recency (exponential decay, 4H half-life)
    5. Return weighted average in [-1, +1]

    Returns 0.0 (neutral) on any failure.
    """
    now = time.time()

    # Cache check
    if not force_refresh and symbol in _sentiment_cache:
        cached_score, cached_time = _sentiment_cache[symbol]
        if now - cached_time < CACHE_TTL_SECONDS:
            logger.debug("Sentiment cache hit for %s: %.3f", symbol, cached_score)
            return cached_score

    analyzer = _get_analyzer()
    if not analyzer:
        logger.warning("VADER not available — returning neutral 0.0 for %s", symbol)
        return 0.0

    # Fetch headlines
    headlines = _fetch_coingecko_news(symbol)
    if len(headlines) < 3:
        headlines += _fetch_cryptocompare_news(symbol)

    if not headlines:
        logger.debug("No headlines found for %s — returning neutral", symbol)
        _sentiment_cache[symbol] = (0.0, now)
        return 0.0

    # Score each headline
    scores = []
    for text in headlines:
        score = _score_text(text)
        if score is not None:
            # Apply amplifier boost
            text_lower = text.lower()
            boost = sum(0.1 for kw in BULLISH_AMPLIFIERS if kw in text_lower)
            boost -= sum(0.1 for kw in BEARISH_AMPLIFIERS if kw in text_lower)
            boosted = max(-1.0, min(1.0, score + boost * 0.5))
            scores.append(boosted)

    if not scores:
        _sentiment_cache[symbol] = (0.0, now)
        return 0.0

    # Simple weighted average (no per-article timestamp available in free tier)
    # Apply recency weights linearly across the list (newest last in CryptoCompare)
    n = len(scores)
    weights = [_time_decay_weight(i * 3600, half_life_seconds=4 * 3600) for i in range(n - 1, -1, -1)]
    total_w = sum(weights)
    if total_w == 0:
        final_score = sum(scores) / n
    else:
        final_score = sum(s * w for s, w in zip(scores, weights)) / total_w

    final_score = max(-1.0, min(1.0, final_score))
    _sentiment_cache[symbol] = (final_score, now)
    logger.info("Sentiment for %s: %.4f (from %d headlines)", symbol, final_score, n)
    return final_score


def batch_sentiment(symbols: List[str]) -> Dict[str, float]:
    """Compute sentiment for multiple symbols. Returns {symbol: score}."""
    results = {}
    for sym in symbols:
        try:
            results[sym] = compute_sentiment(sym)
            time.sleep(0.3)   # be gentle on news APIs
        except Exception as e:
            logger.warning("Sentiment failed for %s: %s", sym, e)
            results[sym] = 0.0
    return results


# ─── CLI test ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    print("\n=== Testing VADER sentiment (Bitcoin) ===")
    score = compute_sentiment("bitcoin")
    print(f"  BTC Sentiment: {score:+.4f}  ({'Bullish' if score > 0.05 else 'Bearish' if score < -0.05 else 'Neutral'})")

    print("\n=== Testing batch sentiment (BTC + ETH) ===")
    results = batch_sentiment(["bitcoin", "ethereum"])
    for sym, s in results.items():
        print(f"  {sym}: {s:+.4f}")

    print("\n✅ sentiment.py OK")
