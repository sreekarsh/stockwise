"""
StockWise ML Trainer v3 — Real OHLCV + Sentiment + Regime + Derivatives
========================================================================
Upgraded to support:
  1. Global indicators (S&P 500 ^GSPC, Dollar Index DX-Y.NYB, BTC dominance)
  2. Multi-asset features aligned and forward-filled for traditional markets
  3. Model training toggles: GBM, PyTorch sequential LSTM, and SB3 PPO RL agent
  4. Chronological walk-forward validation for sequential neural networks
  5. DB persistence to PostgreSQL (via Prisma mapping) with SQLite fallback
"""

import os
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"

if os.getenv("SENTRY_DSN"):
    import sentry_sdk
    sentry_sdk.init(
        dsn=os.getenv("SENTRY_DSN"),
        environment=os.getenv("NODE_ENV", "development"),
    )

import sys
import time
import math
import json
import shutil
import logging
import argparse
from typing import Dict, List, Tuple

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data_ingestion  import (
    fetch_multi_symbol_ohlcv,
    fetch_global_indicators,
    fetch_btc_dominance,
)

COINGECKO_TO_TICKER = {
    "bitcoin": "BTC", "ethereum": "ETH", "solana": "SOL",
    "binancecoin": "BNB", "ripple": "XRP", "cardano": "ADA",
    "avalanche-2": "AVAX", "dogecoin": "DOGE", "matic-network": "MATIC",
    "chainlink": "LINK", "near": "NEAR", "arbitrum": "ARB",
    "polkadot": "DOT", "uniswap": "UNI", "cosmos": "ATOM",
    "shiba-inu": "SHIB", "litecoin": "LTC", "optimism": "OP",
    "aptos": "APT", "aave": "AAVE",
}
from features        import compute_features
from model           import FEATURE_NAMES, MLPredictor, MODEL_VERSION
from regime          import RegimeDetector
from sentiment       import compute_sentiment

# Lazy load PyTorch and Stable-Baselines3
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from lstm_model import train_lstm_model, prepare_sequential_data, LSTMClassifier
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False

try:
    from stable_baselines3 import PPO
    from rl_env import TradingEnv
    HAS_SB3 = True
except ImportError:
    HAS_SB3 = False

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("trainer_v3")
if os.getenv("SENTRY_DSN"):
    logger.info("Sentry DSN detected — error tracking active")

# ─── Training config ──────────────────────────────────────────────────────────
TRAIN_SYMBOLS = [
    "bitcoin", "ethereum", "solana", "binancecoin", "ripple",
    "cardano", "avalanche-2", "dogecoin", "matic-network", "chainlink",
    "near", "arbitrum", "polkadot", "uniswap", "cosmos",
    "shiba-inu", "litecoin", "optimism", "aptos", "aave",
]
DAYS              = int(os.getenv("TRAIN_DAYS",      "90"))
HORIZON_HOURS     = int(os.getenv("HORIZON_HOURS",   "4"))
LOOKBACK_WINDOW   = int(os.getenv("LOOKBACK_WINDOW", "60"))
THRESHOLD_PCT     = float(os.getenv("THRESHOLD_PCT", "0.5"))
TRAIN_SPLIT       = 0.80


def _candles_to_arrays(candles: List[dict]) -> dict:
    return {
        "opens":   np.array([c["open"]   for c in candles], dtype=float),
        "highs":   np.array([c["high"]   for c in candles], dtype=float),
        "lows":    np.array([c["low"]    for c in candles], dtype=float),
        "closes":  np.array([c["close"]  for c in candles], dtype=float),
        "volumes": np.array([c["volume"] for c in candles], dtype=float),
    }


def align_global_indicators(candles: List[dict], global_indicators: dict) -> Tuple[np.ndarray, np.ndarray]:
    """
    Align S&P 500 and DXY prices to crypto candle timestamps using forward-filling.
    Calculates 24-hour return percentage.
    """
    # NEEDED: Offline fallback values to prevent training from getting stuck
    # when external data sources fail or rate limit
    FALLBACK_GSPC_CLOSE = 4550.0  # Current market cap level
    FALLBACK_DXY_CLOSE = 105.0   # Current dollar index level
    
    gspc_prices = global_indicators.get("^GSPC", {})
    dxy_prices = global_indicators.get("DX-Y.NYB", {})
    
    # Check if we have any valid data - if not, use fallbacks immediately
    if not gspc_prices or not dxy_prices:
        logger.warning("Global indicators not available - using offline fallback values")
        sp500_ret_24h = np.zeros(len(candles))
        dxy_ret_24h = np.zeros(len(candles))
        return sp500_ret_24h, dxy_ret_24h
    
    gspc_timestamps = sorted(gspc_prices.keys())
    dxy_timestamps = sorted(dxy_prices.keys())
    
    sp500_closes = []
    dxy_closes = []
    
    last_gspc = None
    last_dxy = None
    
    gspc_idx = 0
    dxy_idx = 0
    
    for c in candles:
        ts = c["timestamp_ms"]
        
        while gspc_idx < len(gspc_timestamps) and gspc_timestamps[gspc_idx] <= ts:
            try:
                last_gspc = float(gspc_prices[gspc_timestamps[gspc_idx]])
                gspc_idx += 1
            except (ValueError, TypeError):
                # Skip malformed data
                gspc_idx += 1
                continue
            
        while dxy_idx < len(dxy_timestamps) and dxy_timestamps[dxy_idx] <= ts:
            try:
                last_dxy = float(dxy_prices[dxy_timestamps[dxy_idx]])
                dxy_idx += 1
            except (ValueError, TypeError):
                # Skip malformed data
                dxy_idx += 1
                continue
            
        sp500_closes.append(last_gspc if last_gspc is not None else FALLBACK_GSPC_CLOSE)
        dxy_closes.append(last_dxy if last_dxy is not None else FALLBACK_DXY_CLOSE)
        
    sp500_arr = np.array(sp500_closes, dtype=float)
    dxy_arr = np.array(dxy_closes, dtype=float)
    
    # Fill any None/NaN values
    first_gspc = next((x for x in sp500_arr if not np.isnan(x)), FALLBACK_GSPC_CLOSE)
    first_dxy = next((x for x in dxy_arr if not np.isnan(x)), FALLBACK_DXY_CLOSE)
    
    last_gspc = None
    last_dxy = None
    for i in range(len(sp500_arr)):
        if np.isnan(sp500_arr[i]):
            sp500_arr[i] = last_gspc if last_gspc is not None else first_gspc
        else:
            last_gspc = sp500_arr[i]
            
        if np.isnan(dxy_arr[i]):
            dxy_arr[i] = last_dxy if last_dxy is not None else first_dxy
        else:
            last_dxy = dxy_arr[i]
            
    # Compute 24-hour return (using 24-period lookback)
    sp500_ret_24h = np.zeros(len(candles))
    dxy_ret_24h = np.zeros(len(candles))
    
    for i in range(len(candles)):
        if i >= 24:
            if not np.isnan(sp500_arr[i]) and not np.isnan(sp500_arr[i - 24]) and sp500_arr[i - 24] != 0:
                sp500_ret_24h[i] = (sp500_arr[i] - sp500_arr[i - 24]) / sp500_arr[i - 24] * 100
            if not np.isnan(dxy_arr[i]) and not np.isnan(dxy_arr[i - 24]) and dxy_arr[i - 24] != 0:
                dxy_ret_24h[i] = (dxy_arr[i] - dxy_arr[i - 24]) / dxy_arr[i - 24] * 100
            
    return sp500_ret_24h, dxy_ret_24h


def build_dataset(
    ohlcv_by_symbol: Dict[str, List[dict]],
    regime_by_symbol: Dict[str, RegimeDetector],
    sentiments: Dict[str, float],
    global_indicators: dict,
    btc_dom: float,
    horizon: int = HORIZON_HOURS,
    lookback: int = LOOKBACK_WINDOW,
    threshold: float = THRESHOLD_PCT,
) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """
    Build (X, y, t) dataset including standard technical features and global indicators.
    """
    X_rows, y_rows, t_rows, ts_rows = [], [], [], []

    # Map BTC closes by timestamp for cross-asset lead-lag calculation
    btc_candles = ohlcv_by_symbol.get("bitcoin", [])
    btc_closes_map = {c["timestamp_ms"]: c["close"] for c in btc_candles}
    btc_timestamps = sorted(btc_closes_map.keys())

    for sym, candles in ohlcv_by_symbol.items():
        if len(candles) < lookback + horizon + 5:
            logger.warning("%s: not enough candles (%d). Skipping.", sym, len(candles))
            continue

        arrays   = _candles_to_arrays(candles)
        closes   = arrays["closes"]
        opens    = arrays["opens"]
        highs    = arrays["highs"]
        lows     = arrays["lows"]
        volumes  = arrays["volumes"]

        sentiment = sentiments.get(sym, 0.0)
        detector  = regime_by_symbol.get(sym)
        
        sp500_ret_24h_arr, dxy_ret_24h_arr = align_global_indicators(candles, global_indicators)

        logger.info("Building dataset for %s (%d candles)...", sym, len(candles))

        for end_idx in range(lookback, len(candles) - horizon):
            window_candles = candles[end_idx - lookback : end_idx]
            window_closes  = closes[end_idx - lookback : end_idx].tolist()
            window_highs   = highs [end_idx - lookback : end_idx].tolist()
            window_lows    = lows  [end_idx - lookback : end_idx].tolist()
            window_opens   = opens [end_idx - lookback : end_idx].tolist()
            window_volumes = volumes[end_idx - lookback : end_idx].tolist()

            # Align BTC closes — nearest BTC timestamp forward-filled
            window_btc_closes = []
            btc_idx = 0
            for c_in_w in window_candles:
                ts = c_in_w["timestamp_ms"]
                while btc_idx < len(btc_timestamps) - 1 and btc_timestamps[btc_idx + 1] <= ts:
                    btc_idx += 1
                if btc_idx < len(btc_timestamps):
                    window_btc_closes.append(btc_closes_map[btc_timestamps[btc_idx]])
                else:
                    window_btc_closes.append(btc_closes_map[btc_timestamps[-1]] if btc_timestamps else c_in_w["close"])

            now_price = closes[end_idx - 1]
            future_pct = (closes[end_idx + horizon - 1] - now_price) / (now_price + 1e-12) * 100

            # Compute window ATR to define dynamic Triple Barrier margins
            tr_vals = []
            for idx in range(max(1, lookback - 14), lookback):
                h_val = window_highs[idx]
                l_val = window_lows[idx]
                prev_c = window_closes[idx - 1]
                tr = max(h_val - l_val, abs(h_val - prev_c), abs(l_val - prev_c))
                tr_vals.append(tr)
            atr_val = np.mean(tr_vals) if tr_vals else now_price * 0.015

            # Triple Barrier labeling
            label = 0
            fut_ret = future_pct / 100.0
            for f_idx in range(end_idx, end_idx + horizon):
                f_high = highs[f_idx]
                f_low = lows[f_idx]
                
                hit_buy = f_high >= now_price + 1.5 * atr_val
                hit_sell = f_low <= now_price - 1.2 * atr_val
                
                if hit_buy and hit_sell:
                    label = 0
                    fut_ret = 0.0
                    break
                elif hit_buy:
                    label = 1
                    fut_ret = (1.5 * atr_val) / (now_price + 1e-12)
                    break
                elif hit_sell:
                    label = 2
                    fut_ret = (-1.2 * atr_val) / (now_price + 1e-12)
                    break

            regime_feats = detector.predict_features(window_closes, window_volumes) if detector and detector._is_fitted else {
                "regime_state_0": 0.0, "regime_state_1": 1.0, "regime_state_2": 0.0,
                "regime_prob_bear": 0.0, "regime_prob_crab": 1.0, "regime_prob_bull": 0.0
            }

            sp_ret = float(sp500_ret_24h_arr[end_idx - 1])
            dxy_ret = float(dxy_ret_24h_arr[end_idx - 1])

            feats = compute_features(
                prices            = window_closes,
                volumes           = window_volumes,
                highs             = window_highs,
                lows              = window_lows,
                opens             = window_opens,
                sentiment_score   = sentiment,
                symbol            = COINGECKO_TO_TICKER.get(sym, sym.split("-")[0].upper()),
                funding_rate      = 0.0,
                oi_change_pct     = 0.0,
                regime_state_0    = regime_feats.get("regime_state_0", 0.0),
                regime_state_1    = regime_feats.get("regime_state_1", 1.0),
                regime_state_2    = regime_feats.get("regime_state_2", 0.0),
                regime_prob_bear  = regime_feats.get("regime_prob_bear", 0.0),
                regime_prob_crab  = regime_feats.get("regime_prob_crab", 1.0),
                regime_prob_bull  = regime_feats.get("regime_prob_bull", 0.0),
                sp500_return_24h  = sp_ret,
                dxy_return_24h    = dxy_ret,
                btc_dominance     = btc_dom,
            )

            row = [float(feats.get(name, 0.0)) for name in FEATURE_NAMES]
            X_rows.append(row)
            y_rows.append(label)
            t_rows.append(float(fut_ret))
            ts_rows.append(candles[end_idx - 1]["timestamp_ms"])

    if not X_rows:
        raise RuntimeError("Dataset is empty. Check data ingestion logs.")

    # Sort by timestamp (chronological ordering across all symbols)
    sort_idx = np.argsort(ts_rows)
    return (
        np.asarray(X_rows, dtype=float)[sort_idx],
        np.asarray(y_rows, dtype=int)[sort_idx],
        np.asarray(t_rows, dtype=float)[sort_idx],
    )


def rolling_cv_score(X: np.ndarray, y: np.ndarray, t: np.ndarray, n_splits: int = 5) -> dict:
    n = len(X)
    fold_size = n // (n_splits + 1)
    win_rates = []
    sharpes   = []

    fold_progress = {
        "model_type": "gbm",
        "current": 1,
        "total": n_splits,
        "completed": []
    }
    write_training_status(True, current_model="Gradient Boosting (GBM)", fold_progress=fold_progress)

    for fold in range(n_splits):
        train_end  = fold_size * (fold + 1)
        test_start = train_end
        test_end   = min(train_end + fold_size, n)

        if test_end - test_start < 10:
            continue

        X_tr, y_tr, t_tr = X[:train_end], y[:train_end], t[:train_end]
        X_te, t_te = X[test_start:test_end], t[test_start:test_end]

        fold_progress["current"] = fold + 1
        log_start = f"Starting Fold {fold + 1} of {n_splits}..."
        logger.info(log_start)
        write_training_status(True, current_model="Gradient Boosting (GBM)", log_line=log_start, fold_progress=fold_progress)

        try:
            val = MLPredictor(seed=fold)
            val.fit(X_tr, y_tr, t_tr)
            Xs_te = val.scaler.transform(X_te)
            preds = val.clf.predict(Xs_te)

            wins   = ((preds == 1) & (t_te > 0)).sum() + ((preds == 2) & (t_te < 0)).sum()
            trades = ((preds == 1) | (preds == 2)).sum()
            wr     = float(wins / trades * 100) if trades > 0 else 50.0

            returns = np.where(preds == 1, t_te, np.where(preds == 2, -t_te, 0.0))
            sharpe  = float(returns.mean() / (returns.std() + 1e-12) * math.sqrt(24 * 365)) if returns.std() > 0 else 0.0

            win_rates.append(wr)
            sharpes.append(sharpe)
            
            fold_progress["completed"].append({
                "fold": fold + 1,
                "win_rate": round(wr, 1),
                "sharpe": round(sharpe, 2),
                "trades": int(trades)
            })
            
            log_end = f"  Fold {fold + 1}: WR={wr:.1f}%  Sharpe={sharpe:.2f}  trades={trades}"
            logger.info(log_end)
            write_training_status(True, current_model="Gradient Boosting (GBM)", log_line=log_end, fold_progress=fold_progress)
        except Exception as e:
            log_err = f"  Fold {fold + 1} failed: {e}"
            logger.warning(log_err)
            write_training_status(True, current_model="Gradient Boosting (GBM)", log_line=log_err, fold_progress=fold_progress)

    return {
        "mean_win_rate": float(np.mean(win_rates)) if win_rates else 0.0,
        "mean_sharpe":   float(np.mean(sharpes))   if sharpes  else 0.0,
        "folds":         n_splits,
    }


def walk_forward_lstm_cv(X: np.ndarray, y: np.ndarray, n_splits: int = 3, sequence_length: int = 60) -> dict:
    """
    Chronological walk-forward cross-validation for sequential LSTM network.
    Avoids data leakage by utilizing seq boundaries.
    """
    if not HAS_TORCH:
        return {"mean_loss": 0.0, "status": "skipped"}
        
    X_seq, y_seq = prepare_sequential_data(X, y, sequence_length)
    n = len(X_seq)
    if n < 100:
        return {"mean_loss": 0.0, "status": "not_enough_data"}
        
    fold_size = n // (n_splits + 1)
    losses = []
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    criterion = nn.CrossEntropyLoss()
    
    for fold in range(n_splits):
        train_end = fold_size * (fold + 1)
        test_start = train_end
        test_end = min(train_end + fold_size, n)
        
        X_tr, y_tr = X_seq[:train_end], y_seq[:train_end]
        X_te, y_te = X_seq[test_start:test_end], y_seq[test_start:test_end]
        
        try:
            # Quick train for CV evaluation
            model = LSTMClassifier(input_dim=X.shape[1]).to(device)
            optimizer = optim.Adam(model.parameters(), lr=0.005)
            
            X_tr_t = torch.tensor(X_tr, dtype=torch.float32).to(device)
            y_tr_t = torch.tensor(y_tr, dtype=torch.long).to(device)
            X_te_t = torch.tensor(X_te, dtype=torch.float32).to(device)
            y_te_t = torch.tensor(y_te, dtype=torch.long).to(device)
            
            # 3 epochs for quick cross-validation fold
            model.train()
            for _ in range(3):
                optimizer.zero_grad()
                out = model(X_tr_t)
                loss = criterion(out, y_tr_t)
                loss.backward()
                optimizer.step()
                
            model.eval()
            with torch.no_grad():
                test_out = model(X_te_t)
                test_loss = criterion(test_out, y_te_t).item()
                losses.append(test_loss)
                
            logger.info("  LSTM Walk-Forward Fold %d: Validation Loss = %.4f", fold + 1, test_loss)
        except Exception as e:
            logger.warning("  LSTM Fold %d failed: %s", fold + 1, e)
            
    return {
        "mean_loss": float(np.mean(losses)) if losses else 0.0,
        "folds": len(losses)
    }


def write_training_status(is_training: bool, started_at=None, current_model=None, log_line=None, fold_progress=None):
    try:
        status_path = os.path.join(os.path.dirname(__file__), "training_status.json")
        marker_path = os.path.join(os.path.dirname(__file__), "trained.marker.json")
        logs = []
        started = started_at
        model = current_model
        progress = fold_progress

        # Load existing status if present to preserve logs/progress when updating
        if os.path.exists(status_path):
            try:
                with open(status_path, "r", encoding="utf-8") as f:
                    old_data = json.load(f)
                    if is_training and old_data.get("is_training"):
                        if started is None:
                            started = old_data.get("started_at")
                        if model is None:
                            model = old_data.get("current_model")
                        if progress is None:
                            progress = old_data.get("fold_progress")
                        logs = old_data.get("logs", [])
            except Exception:
                pass

        if is_training:
            if started is None:
                started = int(time.time() * 1000)
            if model is None:
                model = "Training"
            if log_line:
                local_time = time.strftime("%Y-%m-%d %H:%M:%S")
                logs.append(f"{local_time} [INFO] trainer_v3: {log_line}")
                logs = logs[-15:]
        else:
            # Final state: clear transient fields but keep a marker for last completed time
            if log_line:
                local_time = time.strftime("%Y-%m-%d %H:%M:%S")
                logs.append(f"{local_time} [INFO] trainer_v3: {log_line}")
                logs = logs[-15:]
            # set started/model/progress to None to reflect finished state
            started = None
            model = None
            progress = None

        data = {
            "is_training": is_training,
            "started_at": started,
            "pid": os.getpid() if is_training else None,
            "current_model": model,
            "logs": logs,
            "fold_progress": progress,
            "last_updated": int(time.time() * 1000)
        }

        # Write atomically: write to temp file then replace
        tmp_path = status_path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp_path, status_path)

        # When training finished, write a trained marker with timestamp for UI
        if not is_training:
            try:
                marker = {"trained_at": int(time.time())}
                with open(marker_path + ".tmp", "w", encoding="utf-8") as mf:
                    json.dump(marker, mf)
                os.replace(marker_path + ".tmp", marker_path)
            except Exception:
                pass
    except Exception as e:
        logger.warning("Failed to write training status: %s", e)


def main():
    parser = argparse.ArgumentParser(description="StockWise ML Model Trainer")
    parser.add_argument(
        "--model",
        type=str,
        default="all",
        choices=["gbm", "lstm", "ppo", "all"],
        help="Model type to train (gbm, lstm, ppo, or all)"
    )
    args = parser.parse_args()

    started_time = int(time.time() * 1000)
    write_training_status(True, started_time, current_model="Initialization", log_line="Starting ML Engine Trainer...")

    try:
        try:
            from mlflow_config import init_mlflow
            init_mlflow()
        except Exception:
            pass
        logger.info("=" * 60)
        logger.info("StockWise ML Trainer v3 — Database & AI Modernization")
        logger.info("=" * 60)
        logger.info("Target Model: %s", args.model.upper())
        logger.info("Symbols: %s", TRAIN_SYMBOLS)
        logger.info("Days: %d  |  Horizon: %dH  |  Lookback: %d bars", DAYS, HORIZON_HOURS, LOOKBACK_WINDOW)

        # ── 1. Fetch real OHLCV from Binance ─────────────────────────────
        log_ing = "[1/6] Fetching Binance OHLCV..."
        logger.info("\n" + log_ing)
        write_training_status(True, current_model="Data Ingestion", log_line=log_ing)
        ohlcv = fetch_multi_symbol_ohlcv(TRAIN_SYMBOLS, days=DAYS, interval="1h")
        if not ohlcv:
            raise RuntimeError("No OHLCV data fetched. Check network / Binance availability.")
        logger.info("Fetched %d symbols, total candles: %d",
                    len(ohlcv), sum(len(v) for v in ohlcv.values()))

        # ── 1b. Fetch global indicators & BTC dominance ─────────────────
        log_gi = "[1b/6] Fetching global indicators (S&P 500, DXY, BTC dominance)..."
        logger.info("\n" + log_gi)
        write_training_status(True, current_model="Data Ingestion", log_line=log_gi)
        try:
            global_indicators = fetch_global_indicators(days=DAYS)
            btc_dom = fetch_btc_dominance()
            logger.info("  Bitcoin dominance: %.2f%%", btc_dom)
            logger.info("  S&P 500 data points: %d", len(global_indicators.get("^GSPC", {})))
            logger.info("  Dollar Index data points: %d", len(global_indicators.get("DX-Y.NYB", {})))
        except Exception as e:
            logger.warning("Global indicators fetch failed (%s) — using fallback values", e)
            from global_indicators_fallback import get_global_indicators_fallback, get_btc_dominance_fallback
            global_indicators = get_global_indicators_fallback(days=DAYS)
            btc_dom = get_btc_dominance_fallback()
            logger.info("  Bitcoin dominance (fallback): %.2f%%", btc_dom)
            logger.info("  Using offline global indicators — training will continue")

        # ── 2. Fetch live sentiment (once per symbol) ─────────────────────
        log_sent = "[2/6] Fetching live sentiment scores..."
        logger.info("\n" + log_sent)
        write_training_status(True, current_model="Sentiment Analysis", log_line=log_sent)
        sentiments = {}
        for sym in TRAIN_SYMBOLS:
            try:
                score = compute_sentiment(sym)
                sentiments[sym] = score
                logger.info("  %s: sentiment = %+.4f", sym, score)
                time.sleep(0.5)
            except Exception as e:
                logger.warning("  %s: sentiment failed (%s) — using fallback 0.0", sym, e)
                sentiments[sym] = 0.0

        # ── 3. Train HMM regime detector per symbol ───────────────────────
        log_reg = "[3/6] Training HMM regime detectors..."
        logger.info("\n" + log_reg)
        write_training_status(True, current_model="Regime Detection", log_line=log_reg)
        regime_by_symbol = {}
        for sym, candles in ohlcv.items():
            arrs = _candles_to_arrays(candles)
            detector = RegimeDetector(seed=42)
            try:
                detector.fit(arrs["closes"].tolist(), arrs["volumes"].tolist())
                regime_by_symbol[sym] = detector
            except Exception as e:
                logger.warning("  Regime detector failed for %s: %s", sym, e)

        if "bitcoin" in ohlcv:
            btc_arrs = _candles_to_arrays(ohlcv["bitcoin"])
            global_regime = RegimeDetector(seed=42)
            global_regime.fit(btc_arrs["closes"].tolist(), btc_arrs["volumes"].tolist())
            global_regime.save()
            logger.info("  Global regime model saved (BTC proxy).")

        # ── 4. Build feature dataset ──────────────────────────────────────
        log_feat = "[4/6] Building feature dataset..."
        logger.info("\n" + log_feat)
        write_training_status(True, current_model="Feature Engineering", log_line=log_feat)
        X, y, t = build_dataset(
            ohlcv_by_symbol  = ohlcv,
            regime_by_symbol = regime_by_symbol,
            sentiments       = sentiments,
            global_indicators = global_indicators,
            btc_dom          = btc_dom,
            horizon          = HORIZON_HOURS,
            lookback         = LOOKBACK_WINDOW,
            threshold        = THRESHOLD_PCT,
        )

        n_nan_X = np.sum(~np.isfinite(X))
        n_nan_t = np.sum(~np.isfinite(t))
        if n_nan_X > 0:
            X[~np.isfinite(X)] = 0.0
        if n_nan_t > 0:
            t[~np.isfinite(t)] = 0.0
        
        n_samples = X.shape[0]
        class_dist = {
            "HOLD": int((y == 0).sum()),
            "BUY":  int((y == 1).sum()),
            "SELL": int((y == 2).sum()),
        }
        logger.info("Dataset: %d samples | %d features | Classes: %s", n_samples, X.shape[1], class_dist)

        # ── 5. MODEL TRAINING & VALIDATION ────────────────────────────────

        # Model 1: Gradient Boosting Model (GBM)
        if args.model in ["gbm", "all"]:
            log_gbm = "[5/6] Training Gradient Boosting (GBM) model..."
            logger.info("\n" + log_gbm)
            write_training_status(True, current_model="Gradient Boosting (GBM)", log_line=log_gbm)
            cv_results = rolling_cv_score(X, y, t, n_splits=5)
            logger.info("GBM CV Results: WR=%.2f%%  Sharpe=%.2f", cv_results["mean_win_rate"], cv_results["mean_sharpe"])

            split_idx = int(n_samples * TRAIN_SPLIT)
            X_train, X_test = X[:split_idx], X[split_idx:]
            y_train = y[:split_idx]
            t_train, t_test = t[:split_idx], t[split_idx:]

            val = MLPredictor(seed=42)
            val.fit(X_train, y_train, t_train)

            Xs_test = val.scaler.transform(X_test)
            y_pred  = val.clf.predict(Xs_test)

            buy_wins   = ((y_pred == 1) & (t_test > 0)).sum()
            sell_wins  = ((y_pred == 2) & (t_test < 0)).sum()
            total_wins = buy_wins + sell_wins
            total_trades = ((y_pred == 1) | (y_pred == 2)).sum()
            win_rate = float(total_wins / total_trades * 100) if total_trades > 0 else 50.0

            returns = np.where(y_pred == 1, t_test, np.where(y_pred == 2, -t_test, 0.0))
            gross_profits = float(returns[returns > 0].sum())
            gross_losses  = float(abs(returns[returns < 0].sum()))
            profit_factor = gross_profits / (gross_losses + 1e-12)
            if profit_factor > 10 or profit_factor <= 0:
                profit_factor = min(max(profit_factor, 0.5), 10.0)

            sharpe = float(returns.mean() / (returns.std() + 1e-12) * math.sqrt(24 * 365)) if returns.std() > 0 else 0.0

            equity    = np.cumprod(1 + returns)
            peak      = np.maximum.accumulate(equity)
            drawdowns = (peak - equity) / (peak + 1e-12) * 100
            max_dd    = float(drawdowns.max()) if len(drawdowns) > 0 else 0.0

            logger.info("\n── GBM Holdout Evaluation ──────────────────────")
            logger.info("  Win Rate:      %.2f%%", win_rate)
            logger.info("  Profit Factor: %.2f",  profit_factor)
            logger.info("  Sharpe Ratio:  %.2f",  sharpe)
            logger.info("  Max Drawdown:  %.2f%%", max_dd)
            logger.info("  Trades:        %d",    total_trades)
            write_training_status(True, current_model="Gradient Boosting (GBM)", log_line=f"GBM Holdout: WR={win_rate:.2f}% Sharpe={sharpe:.2f} trades={total_trades}")

            log_fit = "Re-training final GBM model on 100% of data..."
            logger.info(log_fit)
            write_training_status(True, current_model="Gradient Boosting (GBM)", log_line=log_fit)
            predictor = MLPredictor(seed=42)
            predictor.fit(X, y, t)

            from model_persistence import model_path, save_state
            try:
                from mlflow_config import log_training_run, log_model_artifact
            except Exception:
                def log_training_run(*args, **kwargs): pass
                def log_model_artifact(*args, **kwargs): pass
            mp = model_path()
            if os.path.exists(mp):
                bak = mp + ".bak"
                shutil.copy2(mp, bak)
                if os.path.getsize(bak) != os.path.getsize(mp):
                    logger.error("Backup verification failed, aborting save")
                    raise RuntimeError("Backup file size mismatch")
            marker_path_bak = os.path.join(os.path.dirname(__file__), "trained.marker.json.bak")
            marker_path = os.path.join(os.path.dirname(__file__), "trained.marker.json")
            if os.path.exists(marker_path):
                shutil.copy2(marker_path, marker_path_bak)
            save_state(predictor, extra={
                "trained_at":     int(time.time()),
                "model_version":  MODEL_VERSION,
                "n_samples":      int(n_samples),
                "n_features":     int(X.shape[1]),
                "class_counts":   class_dist,
                "cv_win_rate":    round(cv_results["mean_win_rate"], 2),
                "cv_sharpe":      round(cv_results["mean_sharpe"], 2),
                "holdout_win_rate": round(win_rate, 2),
                "holdout_sharpe":   round(sharpe, 2),
                "holdout_profit_factor": round(profit_factor, 2),
                "holdout_max_drawdown":  round(max_dd, 2),
            })

            marker = {
                "model_version":  MODEL_VERSION,
                "n_samples":      int(n_samples),
                "n_features":     int(X.shape[1]),
                "class_counts":   class_dist,
                "trained_at":     int(time.time()),
                "cv_results":     cv_results,
                "holdout": {
                    "win_rate":      round(win_rate, 2),
                    "profit_factor": round(profit_factor, 2),
                    "sharpe":        round(sharpe, 2),
                    "max_drawdown":  round(max_dd, 2),
                    "total_trades":  int(total_trades),
                },
            }
            log_training_run(
                params={"model_version": MODEL_VERSION, "n_samples": n_samples, "n_features": X.shape[1]},
                metrics={"win_rate": win_rate, "sharpe": sharpe, "profit_factor": profit_factor, "max_drawdown": max_dd},
                tags={"model_type": "gbm", "version": MODEL_VERSION},
            )
            log_model_artifact(mp)

            marker_path = os.path.join(os.path.dirname(__file__), "trained.marker.json")
            marker_tmp = marker_path + ".tmp"
            with open(marker_tmp, "w", encoding="utf-8") as f:
                json.dump(marker, f, indent=2)
            os.replace(marker_tmp, marker_path)

            # Write to PostgreSQL / SQLite database
            db_url = os.getenv("DATABASE_URL")
            written = False
            if db_url and db_url.startswith("postgresql://"):
                try:
                    import psycopg2  # type: ignore
                    conn = psycopg2.connect(db_url)
                    cursor = conn.cursor()
                    cursor.execute(
                        "INSERT INTO \"BacktestResults\" (model_version, period_start, period_end, win_rate, profit_factor, sharpe, max_drawdown, total_trades) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
                        (MODEL_VERSION, f"{DAYS}-days-ago", "now", win_rate, profit_factor, sharpe, max_dd, int(total_trades)),
                    )
                    conn.commit()
                    cursor.close()
                    conn.close()
                    logger.info("  Backtest results written to PostgreSQL.")
                    written = True
                except Exception as pg_err:
                    logger.debug("PostgreSQL backtest insert failed, falling back to SQLite: %s", pg_err)

            if not written:
                try:
                    db_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "stockwise.db")
                    import sqlite3
                    conn = sqlite3.connect(db_path)
                    try:
                        conn.execute("ALTER TABLE backtest_results ADD COLUMN note TEXT")
                        conn.commit()
                    except Exception:
                        pass
                    conn.execute(
                        "INSERT INTO backtest_results (model_version, period_start, period_end, win_rate, profit_factor, sharpe, max_drawdown, total_trades) VALUES (?,?,?,?,?,?,?,?)",
                        (MODEL_VERSION, f"{DAYS}-days-ago", "now", win_rate, profit_factor, sharpe, max_dd, int(total_trades)),
                    )
                    conn.commit()
                    conn.close()
                    logger.info("  Backtest results written to SQLite.")
                except Exception as sq_err:
                    logger.warning("  SQLite backtest insert failed: %s", sq_err)

        # Model 2: PyTorch LSTM Sequential Classifier
        if args.model in ["lstm", "all"]:
            if HAS_TORCH:
                log_lstm = "[5b/6] Training Sequential LSTM neural network..."
                logger.info("\n" + log_lstm)
                write_training_status(True, current_model="LSTM Neural Network", log_line=log_lstm)
                walk_forward_lstm_cv(X, y, n_splits=3)
                logger.info("LSTM Walk-Forward Validation complete.")
                
                # Fit final LSTM model
                train_lstm_model(X, y, epochs=5, batch_size=64, lr=0.001)
                logger.info("✅ LSTM training completed.")
                write_training_status(True, current_model="LSTM Neural Network", log_line="LSTM training completed.")
            else:
                logger.warning("\n[5b/6] PyTorch/LSTM training skipped: 'torch' is not installed.")

        # Model 3: Reinforcement Learning (PPO Agent)
        if args.model in ["ppo", "all"]:
            if HAS_SB3:
                log_ppo = "[5c/6] Training Reinforcement Learning (SB3 PPO) agent..."
                logger.info("\n" + log_ppo)
                write_training_status(True, current_model="Reinforcement Learning (PPO)", log_line=log_ppo)
                
                # Use BTC closing prices as reference for PPO env
                btc_prices = np.array([c["close"] for c in ohlcv.get("bitcoin", ohlcv[list(ohlcv.keys())[0]])], dtype=float)
                # Trim BTC prices to match observations
                btc_prices = btc_prices[LOOKBACK_WINDOW:]
                
                # Align X size with prices
                min_len = min(len(X), len(btc_prices))
                X_rl = X[:min_len]
                prices_rl = btc_prices[:min_len]
                
                env = TradingEnv(X_rl, prices_rl)
                ppo_agent = PPO("MlpPolicy", env, verbose=0, seed=42)
                
                logger.info("Learning policy parameters (10,000 steps)...")
                ppo_agent.learn(total_timesteps=10000)
                
                ppo_path = os.path.join(os.path.dirname(__file__), "ppo_model.zip")
                ppo_agent.save(ppo_path)
                logger.info("✅ PPO RL Agent training completed. Saved to %s", ppo_path)
                write_training_status(True, current_model="Reinforcement Learning (PPO)", log_line="PPO RL Agent training completed.")
            else:
                logger.warning("\n[5c/6] Reinforcement Learning training skipped: 'stable-baselines3' is not installed.")

        log_done = "Model training phase completed."
        logger.info("\n✅ " + log_done)
        write_training_status(True, current_model="Completed", log_line=log_done)

    finally:
        write_training_status(False)


if __name__ == "__main__":
    main()
