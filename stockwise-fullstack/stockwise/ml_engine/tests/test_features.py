from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import math
import numpy as np
from features import compute_features


def _make_sample(n=200):
    np.random.seed(42)
    closes = np.cumprod(1 + np.random.randn(n) * 0.005) * 100
    opens  = closes * (1 + np.random.randn(n) * 0.002)
    highs  = np.maximum(closes, opens) * (1 + abs(np.random.randn(n)) * 0.003)
    lows   = np.minimum(closes, opens) * (1 - abs(np.random.randn(n)) * 0.003)
    vols   = np.random.rand(n) * 1_000_000
    return closes.tolist(), opens.tolist(), highs.tolist(), lows.tolist(), vols.tolist()


def test_feature_count():
    """Verify compute_features returns exactly 50 features."""
    closes, opens, highs, lows, vols = _make_sample()
    feats = compute_features(closes, vols, highs, lows, opens)
    assert len(feats) == 50, f"Expected 50 features, got {len(feats)}"


def test_feature_values():
    """Verify returned values are finite floats."""
    closes, opens, highs, lows, vols = _make_sample()
    feats = compute_features(closes, vols, highs, lows, opens)
    for k, v in feats.items():
        assert isinstance(v, float), f"{k} is not float: {type(v)}"
        assert math.isfinite(v), f"{k} is not finite: {v}"


def test_short_input():
    """Verify graceful handling of insufficient data."""
    closes = [100.0] * 5
    feats = compute_features(closes)
    assert len(feats) == 50
    # All should be 0.0 fallback
    for v in feats.values():
        assert v == 0.0
