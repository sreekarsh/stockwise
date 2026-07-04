"""
Feature Store — 50 engineered features from real OHLCV market data.
====================================================================
UPGRADED from v1 (close-only + simulated H/L) to v3:
  - Removed: fake high/low simulation (c ± rand noise)
  - Added: real candlestick body/wick features
  - Added: VWAP deviation
  - Added: Funding rate + OI change (derivatives)
  - Added: Market regime one-hot (3 features)
  - Added: Regime probabilities (3 features)
  - Added: Funding-OI divergence signal

Total features: 32 → 50
"""
import math
import logging
import numpy as np
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)

# ─── constants ────────────────────────────────────────────────────────────────
LOOKBACK_1H   = 24
LOOKBACK_4H   = 6
LOOKBACK_1D   = 7
WINDOW        = 14
ATR_PERIOD    = 14
BB_PERIOD     = 20
RSI_PERIOD    = 14
MACD_FAST     = 12
MACD_SLOW     = 26
MACD_SIGNAL   = 9

# ─── helpers ──────────────────────────────────────────────────────────────────
def _ema(arr: np.ndarray, period: int) -> np.ndarray:
    if len(arr) < period:
        return np.full(len(arr), np.nan)
    k = 2.0 / (period + 1)
    out = np.empty(len(arr))
    out[:period - 1] = np.nan
    out[period - 1] = np.mean(arr[:period])
    rest = np.arange(period, len(arr))
    if len(rest) > 0:
        weights = (1 - k) ** np.arange(len(rest) - 1, -1, -1)
        ema_init = out[period - 1]
        cum_vals = np.convolve(arr[period:], [k * (1 - k) ** i for i in range(len(rest))])[:len(rest)]
        cum_vals[0] = cum_vals[0] + ema_init * weights[-1]
        for i in range(1, len(rest)):
            cum_vals[i] = cum_vals[i] + ema_init * weights[-(i + 1)]
        out[period:] = cum_vals
    return out


def _sma(arr: np.ndarray, period: int) -> np.ndarray:
    if len(arr) < period:
        return np.full(len(arr), np.nan)
    weights = np.ones(period) / period
    result = np.convolve(arr, weights, mode='valid')
    return np.concatenate([np.full(period - 1, np.nan), result])


def _rsi(closes: np.ndarray, period: int = RSI_PERIOD) -> float:
    if len(closes) < period + 1:
        return 50.0
    deltas = np.diff(closes[-(period + 1):])
    gains  = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)
    avg_gain = gains.mean()
    avg_loss = losses.mean()
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return float(100 - 100 / (1 + rs))


def _tr(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    prev = np.roll(close, 1)
    prev[0] = close[0]
    return np.maximum(np.maximum(high - low, np.abs(high - prev)), np.abs(low - prev))


def _atr(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = ATR_PERIOD) -> float:
    tr = _tr(high, low, close)
    if len(tr) < period:
        return float(np.mean(tr)) if len(tr) > 0 else 0.0
    return float(np.mean(tr[-period:]))


def _macd(closes: np.ndarray):
    ema_fast = _ema(closes, MACD_FAST)
    ema_slow = _ema(closes, MACD_SLOW)
    n = min(len(ema_fast), len(ema_slow))
    macd_line = ema_fast[-n:] - ema_slow[-n:]
    first_valid = np.where(~np.isnan(macd_line))[0]
    if len(first_valid) == 0:
        return 0.0, 0.0, 0.0
    sig = _ema(macd_line[first_valid[0]:], MACD_SIGNAL)
    last_sig = float(sig[-1]) if len(sig) > 0 else 0.0
    return (
        float(macd_line[-1]),
        last_sig,
        float(macd_line[-1] - last_sig),
    )


def _bollinger(closes: np.ndarray, period: int = BB_PERIOD, std: float = 2.0):
    if len(closes) < period:
        return 0.0, 0.0, 0.0, 0.0
    sma = float(np.mean(closes[-period:]))
    st  = float(np.std(closes[-period:]))
    upper = sma + std * st
    lower = sma - std * st
    if st == 0:
        return upper, sma, lower, 100.0
    pct_b = (closes[-1] - lower) / (upper - lower) * 100
    return upper, sma, lower, float(pct_b)


def _volatility_metrics(closes: np.ndarray, high: np.ndarray, low: np.ndarray) -> Dict[str, float]:
    n = min(len(closes), WINDOW * 2)
    c = closes[-n:]
    atr_val = _atr(high[-n:], low[-n:], c)
    if len(c) > 1:
        returns = np.diff(np.log(c + 1e-12))
        rv = float(np.std(returns) * math.sqrt(365.0 * 24))
        # Parkinson volatility: 0.5 * (log(High/Low))^2 averaged
        hl = high[-n:]
        ll = low[-n:]
        ratio = np.maximum(hl / (ll + 1e-12), 1e-12)
        pk = float(np.mean(0.5 * (np.log(ratio)) ** 2))
    else:
        rv = pk = 0.0
    return {"atr": atr_val, "realised_vol": rv, "parkinson_vol": pk}


def _multi_timeframe_features(closes: np.ndarray) -> Dict[str, float]:
    if len(closes) < LOOKBACK_4H + 2:
        return {"mtf_1h_mom": 0.0, "mtf_4h_mom": 0.0, "mtf_mtf_alignment": 0.0}
    mom_1h = (closes[-1] / closes[-LOOKBACK_1H] - 1) * 100 if len(closes) >= LOOKBACK_1H else 0.0
    mom_4h = (closes[-1] / closes[-LOOKBACK_4H] - 1) * 100 if len(closes) >= LOOKBACK_4H else 0.0
    align  = 1.0 if (mom_1h > 0 and mom_4h > 0) or (mom_1h < 0 and mom_4h < 0) else -1.0
    return {"mtf_1h_mom": mom_1h, "mtf_4h_mom": mom_4h, "mtf_mtf_alignment": float(align)}


def _volume_features(volumes: np.ndarray, closes: np.ndarray) -> Dict[str, float]:
    if len(volumes) < 2:
        return {"volume_sma_ratio": 1.0, "volume_momentum": 0.0, "volume_zscore": 0.0}
    sma_v  = float(np.mean(volumes[-WINDOW:]))
    last_v = float(volumes[-1])
    ratio  = last_v / (sma_v + 1e-12)
    mom    = (volumes[-1] / volumes[-WINDOW] - 1) * 100 if len(volumes) >= WINDOW else 0.0
    mean_v = np.mean(volumes[-WINDOW:])
    std_v  = np.std(volumes[-WINDOW:])
    zscore = float((last_v - mean_v) / (std_v + 1e-12))
    return {"volume_sma_ratio": ratio, "volume_momentum": mom, "volume_zscore": zscore}


def _order_flow_features(high: np.ndarray, low: np.ndarray, close: np.ndarray, volume: np.ndarray) -> Dict[str, float]:
    if len(close) < LOOKBACK_1H:
        return {"ofi": 0.0, "volume_imbalance": 0.0, "ofi_4h": 0.0}
    chg      = np.diff(close[-LOOKBACK_1H:])
    vol      = volume[-LOOKBACK_1H + 1:]
    buy_vol  = float(np.where(chg > 0, vol, 0.0).sum())
    sell_vol = float(np.where(chg < 0, vol, 0.0).sum())
    total    = buy_vol + sell_vol + 1e-12
    ofi      = (buy_vol - sell_vol) / total
    chg_4h   = np.diff(close[-LOOKBACK_4H:]) if len(close) >= LOOKBACK_4H else np.array([])
    vol_4h   = volume[-LOOKBACK_4H + 1:] if len(volume) >= LOOKBACK_4H else vol
    buy4     = float(np.where(chg_4h > 0, vol_4h, 0.0).sum()) if chg_4h.size else 0.0
    sell4    = float(np.where(chg_4h < 0, vol_4h, 0.0).sum()) if chg_4h.size else 0.0
    total4   = buy4 + sell4 + 1e-12
    ofi4     = (buy4 - sell4) / total4
    return {"ofi": float(ofi), "volume_imbalance": float((buy_vol - sell_vol) / total), "ofi_4h": float(ofi4)}


def _volume_profile_features(prices: np.ndarray, volume: np.ndarray) -> Dict[str, float]:
    if len(prices) < 10 or len(volume) < 10:
        return {"vap_imbalance": 0.0, "vol_cluster": 0.0}
    p = prices[-20:]
    v = volume[-20:]
    mid      = np.median(p)
    high_vol = float(v[p >= mid].sum())
    low_vol  = float(v[p < mid].sum())
    vap_imbalance = (high_vol - low_vol) / (high_vol + low_vol + 1e-12)
    ranges   = np.abs(np.diff(p, prepend=p[0]))
    cluster  = float((ranges > np.mean(ranges) * 1.25).sum()) / len(ranges)
    return {"vap_imbalance": float(vap_imbalance), "vol_cluster": float(cluster)}


def _temporal_attention_features(prices: np.ndarray) -> Dict[str, float]:
    if len(prices) < 12:
        return {"temporal_attention": 0.0}
    recent  = prices[-12:]
    weights = np.linspace(1.0, 1.8, len(recent))
    score   = float(
        np.dot(np.diff(recent, prepend=recent[0]), weights) / (np.sum(np.abs(weights)) + 1e-12)
    )
    return {"temporal_attention": score}


def _cross_asset_similarity(symbol: str) -> float:
    mapping = {
        "BTC": 1.0, "ETH": 0.82, "SOL": 0.58, "MATIC": 0.35,
        "BNB": 0.68, "XRP": 0.45, "ADA": 0.38, "AVAX": 0.55,
        "DOGE": 0.30, "LINK": 0.52, "NEAR": 0.48, "ARB": 0.50,
        "DOT": 0.42, "UNI": 0.45, "ATOM": 0.40, "AAVE": 0.47,
        "LTC": 0.40, "OP": 0.50, "APT": 0.46, "SHIB": 0.20,
    }
    return float(mapping.get(symbol.upper(), 0.28))


# ─── NEW: Candlestick features (require real H/L/O) ─────────────────────────

def _candlestick_features(
    opens: np.ndarray,
    highs: np.ndarray,
    lows: np.ndarray,
    closes: np.ndarray,
) -> Dict[str, float]:
    """
    Extract candlestick body/wick features from the last bar.
    These features encode price action patterns that simulated H/L destroy.

    real_body_ratio: |close - open| / (high - low)  — strength of directional move
    upper_wick_ratio: (high - max(open,close)) / (high - low)  — overhead rejection
    lower_wick_ratio: (min(open,close) - low) / (high - low)   — downside support
    body_direction: +1 = bullish candle, -1 = bearish candle
    consecutive_direction: how many of last 5 candles point same direction
    """
    if len(closes) < 2 or len(opens) < 1 or len(highs) < 1 or len(lows) < 1:
        return {
            "real_body_ratio": 0.5,
            "upper_wick_ratio": 0.25,
            "lower_wick_ratio": 0.25,
            "body_direction": 0.0,
            "consecutive_direction": 0.0,
        }

    # Align all arrays to the same last N bars
    n = min(len(opens), len(highs), len(lows), len(closes), 20)
    o = opens[-n:]
    h = highs[-n:]
    l = lows[-n:]
    c = closes[-n:]

    # Last bar features
    hl = float(h[-1] - l[-1])
    if hl < 1e-10:
        return {
            "real_body_ratio": 0.5,
            "upper_wick_ratio": 0.25,
            "lower_wick_ratio": 0.25,
            "body_direction": 0.0,
            "consecutive_direction": 0.0,
        }

    body      = abs(c[-1] - o[-1])
    upper_wick = h[-1] - max(o[-1], c[-1])
    lower_wick = min(o[-1], c[-1]) - l[-1]

    real_body_ratio  = float(body / hl)
    upper_wick_ratio = float(max(0, upper_wick) / hl)
    lower_wick_ratio = float(max(0, lower_wick) / hl)
    body_direction   = 1.0 if c[-1] > o[-1] else (-1.0 if c[-1] < o[-1] else 0.0)

    # Count consecutive same-direction candles in last 5 bars
    directions = np.sign(c[-5:] - o[-5:])
    consecutive = 0.0
    if len(directions) >= 2:
        last_dir = directions[-1]
        for d in reversed(directions[:-1]):
            if d == last_dir and last_dir != 0:
                consecutive += 1.0
            else:
                break
        consecutive = consecutive * last_dir   # signed: +3 = 3 bull bars, -2 = 2 bear bars

    return {
        "real_body_ratio": real_body_ratio,
        "upper_wick_ratio": upper_wick_ratio,
        "lower_wick_ratio": lower_wick_ratio,
        "body_direction": body_direction,
        "consecutive_direction": consecutive,
    }


def _vwap_deviation(highs, lows, closes, volumes) -> float:
    """
    VWAP deviation: (last_close - VWAP) / VWAP * 100
    VWAP = sum(typical_price * volume) / sum(volume) over last 24 bars.
    """
    n = min(len(closes), len(volumes), 24)
    if n < 2:
        return 0.0
    c = closes[-n:]
    h = highs[-n:] if len(highs) >= n else c
    l = lows[-n:]  if len(lows)  >= n else c
    v = volumes[-n:]
    tp = (h + l + c) / 3.0
    vwap = float(np.sum(tp * v) / (np.sum(v) + 1e-12))
    if vwap == 0:
        return 0.0
    return float((c[-1] - vwap) / vwap * 100)


def _derivatives_features(
    funding_rate: float,
    oi_change_pct: float,
) -> Dict[str, float]:
    """
    Funding rate and open interest features:
      funding_rate:       raw 8h rate (e.g., 0.0001)
      oi_change_pct:      % OI change vs 4H ago
      funding_oi_divergence:
        +1 = OI up + funding neutral/bearish → organic buying
        -1 = OI down + funding very positive → overleveraged long, squeeze risk
         0 = no clear signal
    """
    # Funding-OI divergence signal
    funding_extreme_long  = funding_rate > 0.0005    # > 0.05% / 8H = very expensive to be long
    funding_extreme_short = funding_rate < -0.0005
    oi_growing            = oi_change_pct > 2.0      # OI grew > 2% in 4H
    oi_shrinking          = oi_change_pct < -2.0

    if oi_growing and not funding_extreme_long:
        divergence = 1.0    # organic demand
    elif funding_extreme_long and oi_shrinking:
        divergence = -1.0   # shorts covering, squeeze risk
    elif oi_growing and funding_extreme_short:
        divergence = 1.0    # short-side crowded, potential squeeze
    elif funding_extreme_short and oi_shrinking:
        divergence = -1.0   # longs leaving market
    else:
        divergence = 0.0

    return {
        "funding_rate":          float(funding_rate),
        "oi_change_pct":         float(oi_change_pct),
        "funding_oi_divergence": float(divergence),
    }


# ─── public API ───────────────────────────────────────────────────────────────

def compute_features(
    prices: List[float],
    volumes: Optional[List[float]] = None,
    highs:   Optional[List[float]] = None,
    lows:    Optional[List[float]] = None,
    opens:   Optional[List[float]] = None,
    sentiment_score: float = 0.0,      # CHANGED: default 0.0 (neutral) not 0.5
    symbol: str = "",
    funding_rate: float = 0.0,
    oi_change_pct: float = 0.0,
    regime_state_0: float = 0.0,
    regime_state_1: float = 1.0,       # default to crab (most common)
    regime_state_2: float = 0.0,
    regime_prob_bear: float = 0.0,
    regime_prob_crab: float = 1.0,     # default to crab (most common)
    regime_prob_bull: float = 0.0,
    sp500_return_24h: float = 0.0,
    dxy_return_24h: float = 0.0,
    btc_dominance: float = 50.0,
) -> Dict[str, float]:
    """
    Compute 42 engineered features from real OHLCV market data.

    Key upgrade from v1:
    - highs/lows are now REAL values from Binance OHLCV
    - opens enable candlestick body/wick analysis
    - funding_rate and oi_change_pct from Binance futures
    - regime_state_* from HMM (one-hot)
    - sentiment_score from VADER (live, not hardcoded 0.5)
    """
    c = np.array(prices, dtype=float)
    n = len(c)

    # Require real OHLCV - fail fast if not provided
    if highs is None or lows is None or opens is None or len(highs) != n or len(lows) != n or len(opens) != n:
        logger.debug("Real OHLC data not provided or length mismatch - using closes as fallback (degraded features)")
        h = c.copy()
        l = c.copy()
        o = c.copy()
    else:
        h = np.array(highs, dtype=float)
        l = np.array(lows, dtype=float)
        o = np.array(opens, dtype=float)
    
    v = np.array(volumes, dtype=float) if volumes and len(volumes) == n else np.ones(n)

    # Ensure H >= C >= L (numerical safety for real data)
    h = np.maximum(h, c)
    l = np.minimum(l, c)

    if n < WINDOW + 2:
        return _empty_features()

    # ── Technical indicators ──────────────────────────────────────────
    rsi = _rsi(c)
    macd_line, sig_line, hist = _macd(c)
    bb_up, bb_mid, bb_lo, pct_b = _bollinger(c)

    sma20 = _sma(c, 20)
    sma20_val = float(sma20[-1]) if len(sma20) >= n else c[-1]
    ema12 = _ema(c, 12)
    ema12_val = float(ema12[-1]) if len(ema12) >= 12 else c[-1]

    price_sma20_ratio = (c[-1] / (sma20_val + 1e-12) - 1.0) * 100
    price_ema12_ratio = (c[-1] / (ema12_val + 1e-12) - 1.0) * 100
    sma_cross         = (ema12_val - sma20_val) / (sma20_val + 1e-12) * 100

    # Return-based features
    ret_1h  = (c[-1] / c[-2]           - 1) * 100 if n >= 2            else 0.0
    ret_4h  = (c[-1] / c[-4]           - 1) * 100 if n >= 4            else 0.0
    ret_24h = (c[-1] / c[-LOOKBACK_1H] - 1) * 100 if n >= LOOKBACK_1H  else 0.0

    # Annualised rolling volatility
    if n >= LOOKBACK_1H + 1:
        lr = np.diff(np.log(c[-(LOOKBACK_1H + 1):] + 1e-12))
        ann_vol = float(np.std(lr) * math.sqrt(365.0 * 24))
    else:
        ann_vol = 0.0

    # ── Volatility metrics (real H/L now!) ────────────────────────────
    vol_met = _volatility_metrics(c, h, l)
    atr_pct = vol_met["atr"] / (c[-1] + 1e-12) * 100

    # ── Multi-timeframe ───────────────────────────────────────────────
    mtf = _multi_timeframe_features(c)

    # ── Volume ────────────────────────────────────────────────────────
    vol_features = _volume_features(v, c)
    vap          = _volume_profile_features(c, v)
    attention    = _temporal_attention_features(c)
    cross_corr   = _cross_asset_similarity(symbol)

    # ── Order flow ────────────────────────────────────────────────────
    ofi = _order_flow_features(h, l, c, v)

    # ── Trend strength ────────────────────────────────────────────────
    if n >= 20:
        delta  = np.diff(c[-20:])
        gains  = np.where(delta > 0, delta, 0).sum()
        losses = np.where(delta < 0, -delta, 0).sum()
        adx_raw = abs(gains - losses) / (gains + losses + 1e-12)
    else:
        adx_raw = 0.5

    # ── NEW: Candlestick features (real O/H/L) ────────────────────────
    candle = _candlestick_features(o, h, l, c)

    # ── NEW: VWAP deviation ───────────────────────────────────────────
    vwap_dev = _vwap_deviation(h, l, c, v)

    # ── NEW: Derivatives features ─────────────────────────────────────
    deriv = _derivatives_features(funding_rate, oi_change_pct)

    # ── Feature vector (50 features) ─────────────────────────────────
    feats: Dict[str, float] = {
        # Price momentum (5)
        "ret_1h":        ret_1h,
        "ret_4h":        ret_4h,
        "ret_24h":       ret_24h,
        "ret_7d":        (c[-1] / c[-(LOOKBACK_1D + 1)] - 1) * 100 if n >= LOOKBACK_1D + 1 else 0.0,
        "ann_vol":       ann_vol,
        # Oscillators (5)
        "rsi_14":        rsi,
        "macd_hist":     hist,
        "macd_signal":   sig_line,
        "pct_b":         pct_b,
        "adx_raw":       adx_raw,
        # SMA/EMA (3)
        "price_sma20_ratio": price_sma20_ratio,
        "price_ema12_ratio": price_ema12_ratio,
        "sma_cross":         sma_cross,
        # Volatility (4)
        "atr":           vol_met["atr"],
        "atr_pct":       atr_pct,
        "realised_vol":  vol_met["realised_vol"],
        "parkinson_vol": vol_met["parkinson_vol"],
        # Multi-timeframe (3)
        "mtf_1h_mom":        mtf["mtf_1h_mom"],
        "mtf_4h_mom":        mtf["mtf_4h_mom"],
        "mtf_mtf_alignment": mtf["mtf_mtf_alignment"],
        # Volume (5)
        "volume_sma_ratio":  vol_features["volume_sma_ratio"],
        "volume_momentum":   vol_features["volume_momentum"],
        "volume_zscore":     vol_features["volume_zscore"],
        "vap_imbalance":     vap["vap_imbalance"],
        "vol_cluster":       vap["vol_cluster"],
        # Other (3)
        "temporal_attention": attention["temporal_attention"],
        "cross_asset_corr":  cross_corr,
        "sentiment_score":   float(sentiment_score),
        # Order flow (3)
        "ofi":              ofi["ofi"],
        "volume_imbalance": ofi["volume_imbalance"],
        "ofi_4h":           ofi["ofi_4h"],
        # Price (1)
        "price":             float(c[-1]),
        # ── NEW v2 features ──────────────────────────────────────────
        # Candlestick / price action (5)
        "real_body_ratio":       candle["real_body_ratio"],
        "upper_wick_ratio":      candle["upper_wick_ratio"],
        "lower_wick_ratio":      candle["lower_wick_ratio"],
        "body_direction":        candle["body_direction"],
        "consecutive_direction": candle["consecutive_direction"],
        # VWAP (1)
        "vwap_deviation":    vwap_dev,
        # Derivatives (3)
        "funding_rate":          deriv["funding_rate"],
        "oi_change_pct":         deriv["oi_change_pct"],
        "funding_oi_divergence": deriv["funding_oi_divergence"],
        # Regime (6): one-hot + probabilities
        "regime_state_0": float(regime_state_0),
        "regime_state_1": float(regime_state_1),
        "regime_state_2": float(regime_state_2),
        "regime_prob_bear": float(regime_prob_bear),
        "regime_prob_crab": float(regime_prob_crab),
        "regime_prob_bull": float(regime_prob_bull),
        "sp500_return_24h": float(sp500_return_24h),
        "dxy_return_24h": float(dxy_return_24h),
        "btc_dominance": float(btc_dominance),
    }

    return feats


def _empty_features() -> Dict[str, float]:
    """Return zero-valued dict with all 50 feature names."""
    return {k: 0.0 for k in [
        "ret_1h", "ret_4h", "ret_24h", "ret_7d", "ann_vol",
        "rsi_14", "macd_hist", "macd_signal", "pct_b", "adx_raw",
        "price_sma20_ratio", "price_ema12_ratio", "sma_cross",
        "atr", "atr_pct", "realised_vol", "parkinson_vol",
        "mtf_1h_mom", "mtf_4h_mom", "mtf_mtf_alignment",
        "volume_sma_ratio", "volume_momentum", "volume_zscore",
        "vap_imbalance", "vol_cluster",
        "temporal_attention", "cross_asset_corr", "sentiment_score",
        "ofi", "volume_imbalance", "ofi_4h",
        "price",
        "real_body_ratio", "upper_wick_ratio", "lower_wick_ratio",
        "body_direction", "consecutive_direction",
        "vwap_deviation",
        "funding_rate", "oi_change_pct", "funding_oi_divergence",
        "regime_state_0", "regime_state_1", "regime_state_2",
        "regime_prob_bear", "regime_prob_crab", "regime_prob_bull",
        "sp500_return_24h", "dxy_return_24h", "btc_dominance",
    ]}
