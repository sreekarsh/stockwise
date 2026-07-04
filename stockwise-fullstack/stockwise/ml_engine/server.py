"""
StockWise ML Inference Server v3 — FastAPI REST
=================================================
Port: 8100
Upgraded endpoints:
  POST /api/ml/predict?model=gbm   — Gradient Boosting Model
  POST /api/ml/predict?model=lstm  — PyTorch sequential LSTM model
  POST /api/ml/predict?model=rl    — SB3 PPO policy model
"""

import os
import sys
import json
import logging
import time
from typing import Dict, List, Optional, Any
import asyncio

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("ml")

_SENTRY_INITIALIZED = False
if os.getenv("SENTRY_DSN"):
    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        sentry_sdk.init(
            dsn=os.getenv("SENTRY_DSN"),
            environment=os.getenv("NODE_ENV", "development"),
            integrations=[FastApiIntegration()],
        )
        _SENTRY_INITIALIZED = True
        logger.info("Sentry DSN detected — error tracking active")
    except ImportError:
        logger.warning("sentry_sdk not installed; skipping Sentry initialization")

# Silence Windows asyncio proactor pipe noise (harmless ConnectionResetError)
if sys.platform == "win32":
    logging.getLogger("asyncio").addFilter(lambda r: not (
        r.getMessage().startswith("Exception in callback _ProactorBasePipeTransport")
        and "ConnectionResetError" in r.getMessage()
    ))

import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from features import compute_features
from model    import get_predictor, LABEL_MAP, MODEL_VERSION, FEATURE_NAMES

# Lazy load PyTorch and Stable-Baselines3
try:
    import torch
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

try:
    from stable_baselines3 import PPO
    HAS_SB3 = True
except ImportError:
    HAS_SB3 = False

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app):
    import concurrent.futures
    loop = asyncio.get_running_loop()
    loop.set_default_executor(concurrent.futures.ThreadPoolExecutor(max_workers=250))
    # Run boot in background — don't block server startup
    _boot_task = loop.run_in_executor(None, _boot)
    yield
    _boot_task.cancel()

app = FastAPI(
    title    = "StockWise ML Inference v3",
    version  = "3.0.0",
    docs_url = "/docs",
    lifespan = lifespan,
)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ─── health ───────────────────────────────────────────────────────────────────
@app.get("/health")
def health() -> Dict:
    p = get_predictor()
    return {
        "status": "ok",
        "model_version": MODEL_VERSION,
        "is_fitted": p._is_fitted,
        "timestamp": int(time.time()),
    }

@app.get("/meta")
def meta() -> Dict:
    p = get_predictor()
    return {
        "model_version":    MODEL_VERSION,
        "features":         p._feature_names,
        "feature_count":    len(p._feature_names),
        "classes":          {v: k for k, v in LABEL_MAP.items()},
        "forecast_h":       p.forecast_horizon,
        "is_fitted":        p._is_fitted,
        "conformal_alerts": len(p.conformal_residuals),
    }

# ─── request / response models ─────────────────────────────────────────────────
class MarketSnapshot(BaseModel):
    symbol:          str  = Field(..., description="Ticker / CoinGecko ID")
    prices:          List[float] = Field(..., description="Recent close prices (≥ 30)")
    volumes:         Optional[List[float]] = None
    highs:           Optional[List[float]] = None
    lows:            Optional[List[float]] = None
    opens:           Optional[List[float]] = None
    sentiment_score: Optional[float]       = Field(None, ge=-1.0, le=1.0,
                                                   description="Override sentiment (null = auto-fetch)")
    funding_rate:    Optional[float]       = Field(0.0, description="Perpetual funding rate (e.g. 0.0001)")
    oi_change_pct:   Optional[float]       = Field(0.0, description="OI % change vs 4H ago")
    forecast_hours:  Optional[int]         = Field(4,   gt=0, le=168)

class SignalResponse(BaseModel):
    model_config = {"protected_namespaces": ()}
    symbol:              str
    signal:              str
    confidence:          float
    forecast:            Dict[str, Any]
    trading_plan:        Dict[str, Any]
    probabilities:       Dict[str, float]
    confidence_interval: Dict[str, Any]
    shap_top5:           List[Dict[str, Any]]
    shap_all:            Optional[List[Dict[str, Any]]] = None
    model_version:       str
    signal_extra:        Optional[Dict[str, Any]] = None

# ─── prediction endpoint ───────────────────────────────────────────────────────
@app.post("/api/ml/predict", response_model=SignalResponse)
async def predict(
    snap: MarketSnapshot,
    model: str = Query("gbm", description="Model type: gbm, lstm, or rl"),
    fetch_real: bool = True
):
    predictor = get_predictor()
    if not predictor._is_fitted and model == "gbm":
        raise HTTPException(503, "GBM model not trained yet. Run ml_engine/trainer.py")

    predictor.forecast_horizon = snap.forecast_hours or 4

    # Initialize with provided data
    prices = snap.prices
    volumes = snap.volumes or []
    highs = snap.highs or []
    lows = snap.lows or []
    opens = snap.opens or []

    # Auto-detect synthetic prices and fetch real OHLCV if needed
    prices_arr = np.array(prices)
    if len(prices) >= 2:
        log_rets = np.diff(np.log(prices_arr + 1e-12))
        price_std = float(np.std(log_rets))
    else:
        price_std = 0.0
        
    has_real_ohlcv = len(highs) >= len(prices) and len(lows) >= len(prices) and len(opens) >= len(prices)
    
    # LSTM and RL require at least 60 sequential observations + 30 lookback bars (total 90)
    required_len = 90 if model in ["lstm", "rl"] else 30
    
    if fetch_real and (len(prices) < required_len or price_std < 0.001 or not has_real_ohlcv):
        try:
            from data_ingestion import fetch_binance_ohlcv, COINGECKO_TO_BINANCE
            cg_id = snap.symbol.lower()
            binance_sym = COINGECKO_TO_BINANCE.get(cg_id, cg_id.upper().replace("-", "") + "USDT")
            candles = await asyncio.wait_for(
                asyncio.to_thread(fetch_binance_ohlcv, binance_sym, interval="1h", limit=120),
                timeout=10.0,
            )
            if candles:
                prices = [c["close"] for c in candles]
                volumes = [c["volume"] for c in candles]
                highs   = [c["high"] for c in candles]
                lows    = [c["low"] for c in candles]
                opens   = [c["open"] for c in candles]
                logger.info("Successfully fetched %d real candles for %s", len(candles), snap.symbol)
            else:
                raise ValueError("No candles returned")
        except Exception as e:
            logger.warning("Could not fetch real OHLCV for %s: %s", snap.symbol, e)

    # Auto-fetch live sentiment if not provided
    sentiment = snap.sentiment_score
    if sentiment is None:
        if fetch_real:
            try:
                from sentiment import compute_sentiment
                sentiment = await asyncio.wait_for(
                    asyncio.to_thread(compute_sentiment, snap.symbol.lower()),
                    timeout=5.0,
                )
            except Exception:
                sentiment = 0.0
        else:
            sentiment = 0.0

    # Auto-fetch derivatives data if funding_rate or open interest change not provided
    funding_rate = snap.funding_rate if snap.funding_rate is not None else 0.0
    oi_change_pct = snap.oi_change_pct if snap.oi_change_pct is not None else 0.0
    if (funding_rate == 0.0 or oi_change_pct == 0.0) and fetch_real:
        try:
            from data_ingestion import fetch_derivatives_snapshot
            deriv = await asyncio.wait_for(
                asyncio.to_thread(fetch_derivatives_snapshot, snap.symbol.lower()),
                timeout=5.0,
            )
            funding_rate = snap.funding_rate if snap.funding_rate is not None else deriv["funding_rate"]
            oi_change_pct = snap.oi_change_pct if snap.oi_change_pct is not None else deriv["oi_change_pct"]
        except Exception:
            pass

    # Auto-fetch regime if HMM is ready
    regime_feats = {"regime_state_0": 0.0, "regime_state_1": 1.0, "regime_state_2": 0.0}
    try:
        from regime import get_regime_detector
        det = get_regime_detector()
        if det._is_fitted:
            regime_feats = det.predict_features(prices, volumes)
    except Exception:
        pass

    # Calculate current feature step vector
    features = compute_features(
        prices          = prices,
        volumes         = volumes,
        highs           = highs,
        lows            = lows,
        opens           = opens,
        sentiment_score = sentiment,
        symbol          = snap.symbol,
        funding_rate    = funding_rate,
        oi_change_pct   = oi_change_pct,
        regime_state_0  = regime_feats.get("regime_state_0", 0.0),
        regime_state_1  = regime_feats.get("regime_state_1", 1.0),
        regime_state_2  = regime_feats.get("regime_state_2", 0.0),
        sp500_return_24h = 0.0,
        dxy_return_24h   = 0.0,
        btc_dominance    = 50.0,
    )

    if not features:
        raise HTTPException(500, "Feature computation failed")

    # Serve prediction based on model type
    if model == "gbm":
        result = predictor.predict(features, symbol=snap.symbol)
        result["symbol"] = snap.symbol
        return result

    elif model == "lstm":
        if not HAS_TORCH:
            raise HTTPException(503, "PyTorch/LSTM modeling dependencies are not installed.")
            
        # Compile sequential feature matrices of length 60
        if len(prices) < 89:
            raise HTTPException(400, f"LSTM requires >= 89 price bars, got {len(prices)}")
        seq_features = []
        lookback_len = 30
        for i in range(len(prices) - 60 + 1, len(prices) + 1):
            slice_prices = prices[i - lookback_len : i]
            slice_volumes = volumes[i - lookback_len : i] if volumes else None
            slice_highs = highs[i - lookback_len : i] if highs else None
            slice_lows = lows[i - lookback_len : i] if lows else None
            slice_opens = opens[i - lookback_len : i] if opens else None
            
            f = compute_features(
                prices = slice_prices,
                volumes = slice_volumes,
                highs = slice_highs,
                lows = slice_lows,
                opens = slice_opens,
                sentiment_score = sentiment,
                symbol = snap.symbol,
                funding_rate = funding_rate,
                oi_change_pct = oi_change_pct,
                regime_state_0 = regime_feats.get("regime_state_0", 0.0),
                regime_state_1 = regime_feats.get("regime_state_1", 1.0),
                regime_state_2 = regime_feats.get("regime_state_2", 0.0),
                sp500_return_24h = 0.0,
                dxy_return_24h   = 0.0,
                btc_dominance    = 50.0,
            )
            seq_features.append(f)
            
        from lstm_model import predict_lstm
        lstm_out = predict_lstm(seq_features, FEATURE_NAMES)
        
        # Base trading plan on final step prediction
        result = predictor.predict(features, symbol=snap.symbol)
        result["symbol"] = snap.symbol
        result["signal"] = lstm_out["signal"]
        result["confidence"] = lstm_out["confidence"]
        result["probabilities"] = lstm_out["probabilities"]
        result["model_version"] = "v3.0-lstm-sequential"
        return result

    elif model == "rl":
        if not HAS_SB3:
            raise HTTPException(503, "Stable-Baselines3 dependencies are not installed.")
            
        ppo_path = os.path.join(os.path.dirname(__file__), "ppo_model.zip")
        if not os.path.exists(ppo_path):
            raise HTTPException(404, "Trained RL model ppo_model.zip not found. Run trainer.py first.")
            
        try:
            agent = PPO.load(ppo_path)
        except Exception as e:
            raise HTTPException(500, f"Failed to load RL model: {e}")
            
        obs_features = [features.get(name, 0.0) for name in FEATURE_NAMES]
        # RL state: 50 features + position state (assume 0) + floating P&L (assume 0)
        obs = np.array(obs_features + [0.0, 0.0], dtype=np.float32)
        
        action, _states = agent.predict(obs, deterministic=True)
        action_map = {0: "HOLD", 1: "BUY", 2: "SELL"}
        rl_signal = action_map.get(int(action), "HOLD")
        
        result = predictor.predict(features, symbol=snap.symbol)
        result["symbol"] = snap.symbol
        result["signal"] = rl_signal
        result["confidence"] = 90.0
        
        probs = {"HOLD": 0.0, "BUY": 0.0, "SELL": 0.0}
        probs[rl_signal] = 100.0
        result["probabilities"] = probs
        result["model_version"] = "v3.0-ppo-rl-policy"
        return result

    else:
        raise HTTPException(400, f"Unsupported model type: {model}")

# ─── simple in-memory cache ───────────────────────────────────────────────────
_regime_cache: Dict[str, Any] = {"data": None, "time": 0}
_sentiment_cache: Dict[str, Any] = {"data": None, "time": 0}
_CACHE_TTL = 600  # seconds (10 min)

def _cache_get(cache: dict, key: str = "default") -> Any:
    if cache["data"] is not None and time.time() - cache["time"] < _CACHE_TTL:
        return cache["data"]
    return None

def _cache_set(cache: dict, data: Any) -> None:
    cache["data"] = data
    cache["time"] = time.time()

# ─── live regime endpoint ─────────────────────────────────────────────────
@app.get("/api/ml/regime")
async def regime_endpoint(symbol: str = Query("bitcoin", description="CoinGecko ID or ticker")) -> Dict:
    try:
        cached = _cache_get(_regime_cache)
        if cached and cached.get("_symbol") == symbol:
            return {k: v for k, v in cached.items() if not k.startswith("_")}

        from regime import get_regime_detector
        from data_ingestion import fetch_binance_ohlcv, COINGECKO_TO_BINANCE

        binance_sym = COINGECKO_TO_BINANCE.get(symbol.lower(), symbol.upper() + "USDT")
        candles     = await asyncio.to_thread(fetch_binance_ohlcv, binance_sym, interval="1h", limit=200)
        if not candles:
            fallback = {"symbol": symbol, "regime": "unknown", "state": 1, "probabilities": {}}
            _cache_set(_regime_cache, {"_symbol": symbol, **fallback})
            return fallback

        closes  = [c["close"]  for c in candles]
        volumes = [c["volume"] for c in candles]

        det = get_regime_detector()
        if not det._is_fitted:
            fallback = {"symbol": symbol, "regime": "crab", "state": 1,
                        "probabilities": {"bear": 0.33, "crab": 0.34, "bull": 0.33}}
            _cache_set(_regime_cache, {"_symbol": symbol, **fallback})
            return fallback

        state, probs = det.predict(closes, volumes)
        labels = {0: "bear", 1: "crab", 2: "bull"}
        result = {
            "symbol": symbol,
            "regime": labels.get(state, "unknown"),
            "state":  state,
            "probabilities": {
                "bear": round(float(probs[0]), 3),
                "crab": round(float(probs[1]), 3),
                "bull": round(float(probs[2]), 3),
            },
        }
        _cache_set(_regime_cache, {"_symbol": symbol, **result})
        return result
    except Exception as e:
        cached = _cache_get(_regime_cache)
        if cached:
            return cached
        return {"symbol": symbol, "regime": "crab", "state": 1,
                "probabilities": {"bear": 0.33, "crab": 0.34, "bull": 0.33},
                "note": f"Regime detection failed: {e}"}

# ─── live sentiment endpoint ──────────────────────────────────────────────
@app.get("/api/ml/sentiment")
async def sentiment_endpoint(symbol: str = Query("bitcoin", description="CoinGecko ID")) -> Dict:
    try:
        cached = _cache_get(_sentiment_cache)
        if cached and cached.get("_symbol") == symbol:
            return {k: v for k, v in cached.items() if not k.startswith("_")}

        from sentiment import compute_sentiment
        score = await asyncio.to_thread(compute_sentiment, symbol.lower(), False)
        label = "bullish" if score > 0.05 else "bearish" if score < -0.05 else "neutral"
        result = {
            "symbol":    symbol,
            "score":     round(float(score), 4),
            "sentiment": label,
            "scale":     "[-1.0 bearish .. 0.0 neutral .. +1.0 bullish]",
        }
        _cache_set(_sentiment_cache, {"_symbol": symbol, **result})
        return result
    except Exception as e:
        cached = _cache_get(_sentiment_cache)
        if cached:
            return cached
        return {"symbol": symbol, "score": 0.0, "sentiment": "neutral",
                "scale": "[-1.0 bearish .. 0.0 neutral .. +1.0 bullish]",
                "note": f"Sentiment failed: {e}"}

# ─── performance metrics ───────────────────────────────────────────────────────
@app.get("/api/ml/performance")
def performance() -> Dict:
    p = get_predictor()

    marker_path = os.path.join(os.path.dirname(__file__), "trained.marker.json")
    marker = {}
    if os.path.exists(marker_path):
        try:
            with open(marker_path, "r") as f:
                marker = json.load(f)
        except Exception:
            pass

    return {
        "model_version":       marker.get("model_version", MODEL_VERSION),
        "is_fitted":           p._is_fitted,
        "n_samples":           marker.get("n_samples", "unknown"),
        "n_features":          len(p._feature_names),
        "forecast_horizon_h":  p.forecast_horizon,
        "conformal_sample_n":  len(p.conformal_residuals),
        "holdout_metrics":     marker.get("holdout", {}),
        "cv_metrics":          marker.get("cv_results", {}),
        "class_counts":        marker.get("class_counts", {}),
        "trained_at":          marker.get("trained_at", None),
    }

# ─── batch prediction ──────────────────────────────────────────────────────────
class BatchRequest(BaseModel):
    snapshots: List[MarketSnapshot]

@app.post("/api/ml/signals")
async def batch_signals(req: BatchRequest, model: str = "gbm") -> List[SignalResponse]:
    tasks = [predict(s, model=model, fetch_real=False) for s in req.snapshots]
    return await asyncio.gather(*tasks)

# ─── model reload ──────────────────────────────────────────────────────────────
@app.post("/api/ml/reload")
def reload_model() -> Dict:
    from model_persistence import load_state
    predictor = get_predictor()
    old_fitted = predictor._is_fitted
    ok = load_state(predictor)
    if ok:
        logger.info("Model reloaded from disk")
        return {"status": "ok", "reloaded": True, "is_fitted": True}
    else:
        logger.warning("Model reload failed — no valid model on disk")
        return {"status": "error", "reloaded": False, "is_fitted": old_fitted}

# ─── boot ─────────────────────────────────────────────────────────────────────
def _boot():
    logger.info("ML Server v3 boot — loading model and regime detector...")
    try:
        from model_persistence import load_state
        predictor = get_predictor()
        ok = load_state(predictor)
        if ok:
            logger.info("✅ ML model loaded (%d features).", len(predictor._feature_names))
        else:
            logger.warning("⚠  No persisted model found. Run ml_engine/trainer.py first.")
    except Exception as e:
        logger.exception("Failed to load ML model: %s", e)

    try:
        from regime import load_regime_on_startup
        ok = load_regime_on_startup()
        if ok:
            logger.info("✅ Regime detector loaded.")
        else:
            logger.warning("⚠  No regime model found. Will use neutral regime.")
    except Exception as e:
        logger.warning("Regime load failed: %s", e)

if __name__ == "__main__":
    ML_PORT = int(os.getenv("ML_PORT", "8100"))
    ML_HOST = os.getenv("ML_HOST", "127.0.0.1")
    uvicorn.run("server:app", host=ML_HOST, port=ML_PORT, log_level="info", reload=False)
