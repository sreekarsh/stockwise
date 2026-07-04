"""
Market Regime Detector — Hidden Markov Model (HMM)
===================================================
Detects the current market regime using a 3-state Gaussian HMM trained
on returns, realised volatility, and volume z-score.

States automatically converge to represent:
  State 0: High-volatility bear / crash regime
  State 1: Low-volatility sideways / crab regime
  State 2: High-volatility bull / breakout regime

The regime state is passed as a one-hot categorical feature to the main
GBM so it can apply different internal decision boundaries per regime.
"""

import os
os.environ["OMP_NUM_THREADS"] = "1"
os.environ["MKL_NUM_THREADS"] = "1"
os.environ["OPENBLAS_NUM_THREADS"] = "1"

import logging
import math
import joblib
import numpy as np
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

REGIME_MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "regime_model.joblib")
N_STATES = 3


def _build_regime_features(closes: np.ndarray, volumes: Optional[np.ndarray] = None) -> np.ndarray:
    """
    Build a (T-1, 3) feature matrix for HMM training/inference:
      col 0: log returns
      col 1: rolling 24H realised volatility (annualised)
      col 2: volume z-score (or zero if no volume data)
    """
    c = np.asarray(closes, dtype=float)
    n = len(c)
    if n < 25:
        return np.zeros((max(n - 1, 1), 3))

    log_rets = np.diff(np.log(c + 1e-12))

    # Rolling 24H realised vol (vectorized)
    win = 24
    roll_vol = np.zeros(len(log_rets))
    if len(log_rets) >= win:
        # Use convolution for efficient rolling window std
        rets_sq = log_rets ** 2
        # Rolling mean of squared returns
        kernel = np.ones(win) / win
        rolling_mean_sq = np.convolve(rets_sq, kernel, mode='valid')
        # Pad beginning with NaN/0
        roll_vol[win-1:] = np.sqrt(rolling_mean_sq) * math.sqrt(365 * 24)
        roll_vol[:win-1] = roll_vol[win-1]  # forward fill
    else:
        # Not enough data for full window, use expanding window
        for i in range(len(log_rets)):
            window = log_rets[:i+1]
            roll_vol[i] = float(np.std(window) * math.sqrt(365 * 24)) if len(window) > 1 else 0.0

    # Volume z-score
    if volumes is not None and len(volumes) >= 2:
        v = np.asarray(volumes, dtype=float)
        # Align to returns length (drop first element)
        v = v[1:][:len(log_rets)]
        if len(v) < len(log_rets):
            v = np.pad(v, (0, len(log_rets) - len(v)), mode='edge')
        mean_v = np.mean(v[-win:]) if len(v) >= win else np.mean(v)
        std_v  = np.std(v[-win:])  if len(v) >= win else np.std(v)
        vol_z  = (v - mean_v) / (std_v + 1e-12)
    else:
        vol_z = np.zeros(len(log_rets))

    # Stack: (T-1, 3)
    X = np.column_stack([log_rets, roll_vol, vol_z])
    X = np.nan_to_num(X, nan=0.0, posinf=0.0, neginf=0.0)
    return X


class RegimeDetector:
    """
    3-state Gaussian HMM for market regime classification.

    Usage:
        detector = RegimeDetector()
        detector.fit(closes, volumes)          # train on historical data
        state, probs = detector.predict(closes[-100:], volumes[-100:])
        one_hot = detector.one_hot(state)       # [0,0,1] for state 2
    """

    def __init__(self, n_states: int = N_STATES, seed: int = 42):
        self.n_states = n_states
        self.seed = seed
        self._model = None
        self._is_fitted = False
        self._state_label_map: Dict[int, str] = {}

    def _try_import_hmm(self):
        try:
            from hmmlearn import hmm
            return hmm
        except ImportError:
            raise ImportError(
                "hmmlearn is required for regime detection. "
                "Install it with: pip install hmmlearn"
            )

    def fit(self, closes: List[float], volumes: Optional[List[float]] = None) -> "RegimeDetector":
        """Train the HMM on historical close prices."""
        hmm = self._try_import_hmm()

        X = _build_regime_features(np.array(closes), np.array(volumes) if volumes else None)
        if len(X) < self.n_states * 10:
            logger.warning("Not enough data to fit HMM (%d samples). Need ≥ %d.", len(X), self.n_states * 10)
            return self

        # Increase n_iter and decrease tol for better convergence
        model = hmm.GaussianHMM(
            n_components=self.n_states,
            covariance_type="diag",
            n_iter=500,  # Increase to 500 for more convergence time
            random_state=self.seed,
            tol=1e-5,    # Decrease tolerance for stricter convergence
        )
        model.fit(X)
        self._model = model
        self._is_fitted = True

        # Label states by average realised volatility to make them interpretable
        # Predict on training data to get state assignments
        states = model.predict(X)
        state_vols = {}
        state_rets = {}
        for s in range(self.n_states):
            mask = states == s
            state_vols[s] = float(X[mask, 1].mean()) if mask.sum() > 0 else 0.0
            state_rets[s] = float(X[mask, 0].mean()) if mask.sum() > 0 else 0.0

        # Sort by average returns: lowest = bear, middle = crab, highest = bull
        sorted_by_ret = sorted(state_rets.items(), key=lambda x: x[1])
        self._state_label_map = {
            sorted_by_ret[0][0]: "bear",   # lowest avg return
            sorted_by_ret[1][0]: "crab",   # middle
            sorted_by_ret[2][0]: "bull",   # highest avg return
        }
        logger.info(
            "HMM trained. State labels: %s | State volatilities: %s",
            self._state_label_map,
            {s: f"{v:.4f}" for s, v in state_vols.items()},
        )
        return self

    def predict(self, closes: List[float], volumes: Optional[List[float]] = None) -> Tuple[int, np.ndarray]:
        """
        Predict current regime state.

        Returns:
            (state_int, posterior_probs)  e.g. (2, [0.05, 0.15, 0.80])
        """
        if not self._is_fitted or self._model is None:
            # Fallback: neutral state 1 (crab) with uniform probs
            return 1, np.array([1.0 / self.n_states] * self.n_states)

        X = _build_regime_features(np.array(closes), np.array(volumes) if volumes else None)
        if len(X) == 0:
            return 1, np.array([1.0 / self.n_states] * self.n_states)

        try:
            state = int(self._model.predict(X)[-1])
            # Posterior probability of each state at the last timestep
            # Some HMM implementations might not have predict_proba
            try:
                posteriors = self._model.predict_proba(X)[-1]
            except (AttributeError, NotImplementedError):
                # Fallback: use one-hot if predict_proba not available
                posteriors = np.zeros(self.n_states)
                posteriors[state] = 1.0
        except Exception as e:
            logger.warning("HMM predict failed: %s — returning neutral", e)
            return 1, np.array([1.0 / self.n_states] * self.n_states)

        return state, posteriors

    def _canonical_state_index(self, state: int) -> int:
        if 0 <= state < self.n_states and self._state_label_map:
            label = self._state_label_map.get(state)
            if label == "bear":
                return 0
            if label == "crab":
                return 1
            if label == "bull":
                return 2
        return state

    def one_hot(self, state: int) -> List[float]:
        """Return one-hot encoding for state: [bear, crab, bull]."""
        enc = [0.0, 0.0, 0.0]
        idx = self._canonical_state_index(state)
        if 0 <= idx < self.n_states:
            enc[idx] = 1.0
        return enc

    def regime_label(self, state: int) -> str:
        """Return human-readable label for state."""
        return self._state_label_map.get(state, f"state_{state}")

    def predict_features(self, closes: List[float], volumes: Optional[List[float]] = None) -> Dict[str, float]:
        """
        Convenience: returns the one-hot dict ready to merge into feature vector.
        {
            "regime_state_0": 0.0 or 1.0,  # bear
            "regime_state_1": 0.0 or 1.0,  # crab
            "regime_state_2": 0.0 or 1.0,  # bull
            "regime_prob_bear": float,
            "regime_prob_crab": float,
            "regime_prob_bull": float,
        }
        """
        if not self._is_fitted or self._model is None:
            return {
                "regime_state_0": 0.0,
                "regime_state_1": 1.0,
                "regime_state_2": 0.0,
                "regime_prob_bear": 1.0 / self.n_states,
                "regime_prob_crab": 1.0 / self.n_states,
                "regime_prob_bull": 1.0 / self.n_states,
            }
        
        try:
            state, probs = self.predict(closes, volumes)
        except Exception as e:
            logger.warning("Regime predict failed: %s — returning neutral", e)
            return {
                "regime_state_0": 0.0,
                "regime_state_1": 1.0,
                "regime_state_2": 0.0,
                "regime_prob_bear": 1.0 / self.n_states,
                "regime_prob_crab": 1.0 / self.n_states,
                "regime_prob_bull": 1.0 / self.n_states,
            }
        one_hot = self.one_hot(state)
        canonical_probs = np.zeros(self.n_states, dtype=float)
        for state_id in range(self.n_states):
            label = self._state_label_map.get(state_id)
            if label == "bear":
                canonical_probs[0] = float(probs[state_id])
            elif label == "crab":
                canonical_probs[1] = float(probs[state_id])
            elif label == "bull":
                canonical_probs[2] = float(probs[state_id])
            else:
                canonical_probs[state_id] = float(probs[state_id])
        return {
            "regime_state_0": one_hot[0],
            "regime_state_1": one_hot[1],
            "regime_state_2": one_hot[2],
            "regime_prob_bear": float(canonical_probs[0]),
            "regime_prob_crab": float(canonical_probs[1]),
            "regime_prob_bull": float(canonical_probs[2]),
        }

    def save(self, path: str = REGIME_MODEL_PATH) -> None:
        joblib.dump({"model": self._model, "label_map": self._state_label_map, "n_states": self.n_states}, path)
        logger.info("Regime model saved to %s", path)

    def load(self, path: str = REGIME_MODEL_PATH) -> bool:
        if not os.path.exists(path):
            logger.warning("No regime model found at %s — run trainer first.", path)
            return False
        payload = joblib.load(path)
        self._model = payload["model"]
        self._state_label_map = payload.get("label_map", {})
        self.n_states = payload.get("n_states", N_STATES)
        self._is_fitted = self._model is not None
        logger.info("Regime model loaded from %s. Labels: %s", path, self._state_label_map)
        return self._is_fitted


# Module-level singleton for inference server
_detector = RegimeDetector()


def get_regime_detector() -> RegimeDetector:
    return _detector


def load_regime_on_startup() -> bool:
    return _detector.load()


# ─── CLI test ──────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import json
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

    print("\n=== Testing RegimeDetector with synthetic data ===")

    # Simulate 500 hours of returns in 3 regimes
    np.random.seed(42)
    bear  = np.cumprod(1 + np.random.normal(-0.002, 0.025, 120)) * 50000
    crab  = np.cumprod(1 + np.random.normal(0.0001, 0.008, 180)) * 45000
    bull  = np.cumprod(1 + np.random.normal(0.003, 0.02, 200)) * 46000
    prices = np.concatenate([bear, crab, bull]).tolist()
    volumes = (np.random.uniform(100, 500, len(prices)) * 1e6).tolist()

    detector = RegimeDetector(seed=42)
    detector.fit(prices, volumes)

    state, probs = detector.predict(prices[-200:], volumes[-200:])
    feats = detector.predict_features(prices[-200:], volumes[-200:])

    print(f"\n  Current state: {state} ({detector.regime_label(state)})")
    print(f"  Probabilities: bear={probs[0]:.3f}  crab={probs[1]:.3f}  bull={probs[2]:.3f}")
    print(f"  Feature dict: {json.dumps(feats, indent=4)}")

    print("\n=== Saving and reloading model ===")
    detector.save()
    detector2 = RegimeDetector()
    ok = detector2.load()
    print(f"  Load OK: {ok}")
    if ok:
        state2, _ = detector2.predict(prices[-100:], volumes[-100:])
        print(f"  Reloaded prediction: state {state2} ({detector2.regime_label(state2)})")

    print("\n✅ regime.py OK")
