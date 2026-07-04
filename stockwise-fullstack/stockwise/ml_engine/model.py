"""
ML Predictor — GBM classifier + regressor with 47-feature input.
=================================================================
    UPGRADED from v1 (32 features, hardcoded sentiment) to v3:
  - 50 feature names (18 new: candlesticks, VWAP, derivatives, regime probs)
  - Dynamic sentiment score (from live VADER, not hardcoded 0.5)
  - Regime-aware trading plan (scale TP/SL by regime volatility)
  - Funding rate integration in trading plan
"""
import logging
import math
import threading
import time
from typing import Dict, Any, Optional, Tuple

import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.preprocessing import RobustScaler

HAS_ONNX = False
try:
    from model_persistence import predict_with_onnx
    HAS_ONNX = True
except ImportError:
    pass

logger = logging.getLogger(__name__)

# ── 47 feature names — must match features.py _empty_features() order ─────────
FEATURE_NAMES = [
    # Momentum (5)
    "ret_1h", "ret_4h", "ret_24h", "ret_7d", "ann_vol",
    # Oscillators (5)
    "rsi_14", "macd_hist", "macd_signal", "pct_b", "adx_raw",
    # Trend position (3)
    "price_sma20_ratio", "price_ema12_ratio", "sma_cross",
    # Volatility (4)
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
]

LABEL_MAP = {0: "HOLD", 1: "BUY", 2: "SELL"}

MODEL_VERSION = "v3.0-real-ohlcv-sentiment-regime"


class MLPredictor:
    def __init__(self, seed: int = 42):
        self._lock = threading.Lock()
        self.seed = seed
        self.scaler = RobustScaler()
        self.clf = GradientBoostingClassifier(
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.85,
            min_samples_leaf=4,
            random_state=seed,
        )
        self.reg = GradientBoostingRegressor(
            n_estimators=150,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.85,
            min_samples_leaf=4,
            random_state=seed,
        )
        self._is_fitted = False
        self._feature_names = FEATURE_NAMES
        self.conformal_q = 0.0
        self.conformal_residuals = []
        self.forecast_horizon = 4
        self._use_onnx = False
        self._beta_map = {
            "BTC": 1.0, "ETH": 1.15, "SOL": 1.4, "BNB": 1.05,
            "XRP": 1.2, "ADA": 1.1, "AVAX": 1.35, "DOGE": 1.8,
            "MATIC": 1.5, "LINK": 1.25, "NEAR": 1.45, "ARB": 1.55,
            "DOT": 1.15, "UNI": 1.3, "ATOM": 1.2, "AAVE": 1.25,
            "LTC": 1.05, "OP": 1.5, "APT": 1.6, "SHIB": 2.0,
        }

    def _asset_beta(self, symbol: str) -> float:
        return float(self._beta_map.get(symbol.upper(), 1.0))

    MAX_CONFORMAL_RESIDUALS = 2000

    def _adaptive_conformal_q(self, residual: float, ann_vol: float) -> float:
        self.conformal_residuals.append(abs(residual))
        if len(self.conformal_residuals) > self.MAX_CONFORMAL_RESIDUALS:
            self.conformal_residuals = self.conformal_residuals[-self.MAX_CONFORMAL_RESIDUALS:]
        recent = np.array(self.conformal_residuals[-200:]) if self.conformal_residuals else np.array([self.conformal_q])
        base_q = float(np.quantile(recent, 0.90)) if len(recent) >= 5 else self.conformal_q
        vol_scale = min(max(ann_vol / 0.35, 0.8), 1.8)
        return max(base_q * vol_scale, self.conformal_q * 0.8)

    def _risk_scale(self, symbol: str, ann_vol: float) -> float:
        beta = self._asset_beta(symbol)
        vol_factor = min(max(ann_vol / 0.25, 0.7), 2.0)
        return float(max(0.9, min(2.4, beta * vol_factor)))

    def _prediction_window(self, price: float, pct: float, q: float) -> Dict[str, Any]:
        return {
            "low":              round(price * (1 + pct - q), 4),
            "high":             round(price * (1 + pct + q), 4),
            "confidence_level": f"{min(99, max(85, int(90 + (q * 100))))}%",
        }

    def _trading_plan(
        self,
        price: float,
        atr: float,
        signal: str,
        risk_scale: float,
        funding_rate: float = 0.0,
        regime_state: int = 1,
    ) -> Dict[str, Any]:
        """
        Regime-aware trading plan:
        - Bear regime: tighter stops (market can move fast against you)
        - Bull regime: wider take-profits (let winners run)
        - High funding rate (long-biased): reduce long TP, add short squeeze buffer
        """
        # Regime multipliers
        regime_tp_mult  = {0: 1.4, 1: 1.8, 2: 2.2}.get(regime_state, 1.8)
        regime_sl_mult  = {0: 1.0, 1: 1.1, 2: 1.3}.get(regime_state, 1.1)

        # Funding adjustment — extreme positive funding = longs at risk
        funding_adj = 1.0
        if funding_rate > 0.001:         # > 0.1% / 8H — very expensive to be long
            funding_adj = 0.8             # reduce long TP, tighten stop
        elif funding_rate < -0.001:
            funding_adj = 1.2             # shorts expensive, give bull more room

        if signal == "BUY":
            tp = round(price + atr * regime_tp_mult * risk_scale * funding_adj, 4)
            sl = round(price - atr * regime_sl_mult * min(risk_scale, 1.8), 4)
        elif signal == "SELL":
            tp = round(price - atr * regime_tp_mult * risk_scale, 4)
            sl = round(price + atr * regime_sl_mult * min(risk_scale, 1.8), 4)
        else:
            tp = round(price * 1.008, 4)
            sl = round(price * 0.992, 4)

        rr = round(abs(tp - price) / (abs(sl - price) + 1e-12), 2) if signal != "HOLD" else None
        return {
            "entry":              price,
            "take_profit":        tp,
            "stop_loss":          sl,
            "risk_reward_ratio":  rr,
            "time_horizon_hours": self.forecast_horizon,
        }

    def _format_probability_bars(self, proba: np.ndarray) -> Dict[str, float]:
        return {
            "HOLD": round(float(proba[0] * 100), 1),
            "BUY":  round(float(proba[1] * 100), 1),
            "SELL": round(float(proba[2] * 100), 1),
        }

    def fit(self, X: np.ndarray, y: np.ndarray, t: np.ndarray):
        with self._lock:
            return self._fit_unsafe(X, y, t)

    def _fit_unsafe(self, X: np.ndarray, y: np.ndarray, t: np.ndarray):
        """
        Fit models on real training data.

        Parameters:
          X: raw feature matrix (n_samples, 42)
          y: class labels {0:HOLD, 1:BUY, 2:SELL}
          t: regression target (future return as fraction)
        """
        X = np.asarray(X, dtype=float)
        y = np.asarray(y, dtype=int)
        t = np.asarray(t, dtype=float)

        # Check for and handle NaN/Inf
        n_nan_X = np.sum(~np.isfinite(X))
        n_nan_t = np.sum(~np.isfinite(t))
        if n_nan_X > 0:
            logger.warning("X contains %d non-finite values, replacing with 0", n_nan_X)
            X[~np.isfinite(X)] = 0.0
        if n_nan_t > 0:
            logger.warning("t contains %d non-finite values, replacing with 0", n_nan_t)
            t[~np.isfinite(t)] = 0.0

        Xs = self.scaler.fit_transform(X)
        self.clf.fit(Xs, y)
        self.reg.fit(Xs, t)

        # Conformal calibration from training residuals
        resid = np.abs(t - self.reg.predict(Xs))
        self.conformal_q = float(np.quantile(resid, 0.95)) if resid.size else 0.0
        self._is_fitted = True
        logger.info(
            "MLPredictor v3 fitted: %d samples, %d features, conformal_q=%.6f",
            X.shape[0], X.shape[1], self.conformal_q,
        )

    def predict(self, feats: Dict[str, float], symbol: str = "") -> Dict[str, Any]:
        with self._lock:
            return self._predict_unsafe(feats, symbol)

    def _predict_unsafe(self, feats: Dict[str, float], symbol: str = "") -> Dict[str, Any]:
        if not self._is_fitted:
            raise RuntimeError(
                "ML model not fitted. Run ml_engine/trainer.py first."
            )

        # Sanitize and check for NaN
        feats = {
            k: (0.0 if (v is None or not math.isfinite(v)) else float(v))
            for k, v in feats.items()
        }
        
        # Log if any features were sanitized
        original_nan = sum(1 for v in feats.values() if not math.isfinite(v) or v is None)
        if original_nan > 0:
            logger.warning("Input features contained %d non-finite/None values, sanitized to 0", original_nan)

        # Try ONNX runtime first for safety (no pickle deserialization)
        onnx_result = predict_with_onnx(self, feats) if HAS_ONNX else None

        raw = [feats.get(n, 0.0) for n in FEATURE_NAMES]
        pad = getattr(self, '_feature_pad', 0)
        if pad > 0:
            raw.extend([0.0] * pad)
        x = self.scaler.transform(
            np.array([raw], dtype=float)
        )

        if onnx_result is not None:
            proba, pct = onnx_result
            # proba from ONNX is already softmax output
            if proba.ndim == 2 and proba.shape[0] == 1:
                proba = proba[0]
            cls = int(np.argmax(proba))
        else:
            proba = self.clf.predict_proba(x)[0]
            cls = int(np.argmax(proba))
            pct = float(self.reg.predict(x)[0])

        sig   = LABEL_MAP[cls]
        conf  = round(float(max(proba)) * 100, 1)

        price       = feats.get("price", 0.0)
        atr         = feats.get("atr", price * 0.02)
        ann_vol     = feats.get("ann_vol", 0.0)
        funding     = feats.get("funding_rate", 0.0)
        regime_state = int(
            np.argmax([feats.get("regime_state_0", 0), feats.get("regime_state_1", 1), feats.get("regime_state_2", 0)])
        )

        risk_scale = self._risk_scale(symbol, ann_vol)
        q          = self._adaptive_conformal_q(pct, ann_vol)
        plan       = self._trading_plan(price, atr, sig, risk_scale, funding, regime_state)
        ci         = self._prediction_window(price, pct, q)

        # Top-5 feature importances (handle pad features if model has more features than FEATURE_NAMES)
        n_names = len(FEATURE_NAMES)
        all_importances = self.clf.feature_importances_[:n_names]
        top5_idx = np.argsort(-all_importances)[:5]
        top5 = [
            {"feature": FEATURE_NAMES[i], "importance": round(float(all_importances[i] * 100), 2)}
            for i in top5_idx
            if i < n_names
        ]

        # All feature importances
        all_idx = np.argsort(-all_importances)
        shap_all = [
            {"feature": FEATURE_NAMES[i], "importance": round(float(all_importances[i] * 100), 2)}
            for i in all_idx
            if i < n_names and round(float(all_importances[i] * 100), 2) > 0.0
        ]


        regime_labels = {0: "bear", 1: "crab", 2: "bull"}
        sentiment_val = feats.get("sentiment_score", 0.0)

        return {
            "signal":        sig,
            "confidence":    conf,
            "probabilities": self._format_probability_bars(proba),
            "forecast": {
                "direction":     "UP" if pct > 0 else "DOWN" if pct < 0 else "FLAT",
                "expected_pct":  round(pct * 100, 2),
                "expected_price": round(price * (1 + pct), 4),
                "horizon_hours": self.forecast_horizon,
            },
            "confidence_interval": ci,
            "trading_plan":  plan,
            "shap_top5":     top5,
            "shap_all":      shap_all,

            "model_version": MODEL_VERSION,
            "generated_at":  int(time.time()),
            "signal_extra": {
                "volatility_regime": "high" if ann_vol > 0.45 else "normal",
                "asset_beta":        self._asset_beta(symbol),
                "market_regime":     regime_labels.get(regime_state, "unknown"),
                "funding_rate":      round(funding * 100, 4),   # in %
                "sentiment":         round(sentiment_val, 4),
            },
        }


_predictor = MLPredictor()


def get_predictor() -> MLPredictor:
    return _predictor
