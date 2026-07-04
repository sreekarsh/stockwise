from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import math
import numpy as np
from regime import _build_regime_features, RegimeDetector


def test_build_features_shape():
    closes = np.cumprod(1 + np.random.randn(200) * 0.01) * 100
    volumes = np.random.rand(200) * 1_000_000
    features = _build_regime_features(closes, volumes)
    assert features.shape == (199, 3)
    assert np.all(np.isfinite(features))


def test_build_features_without_volume():
    closes = np.cumprod(1 + np.random.randn(200) * 0.01) * 100
    features = _build_regime_features(closes, None)
    assert features.shape == (199, 3)
    assert np.all(features[:, 2] == 0.0)


def test_build_features_short_input():
    closes = np.array([100.0] * 5)
    features = _build_regime_features(closes)
    assert features.shape == (4, 3)


def test_regime_state_distribution():
    np.random.seed(42)
    closes = np.cumprod(1 + np.random.randn(500) * 0.01) * 100
    features = _build_regime_features(closes)
    log_rets = features[:, 0]
    assert -0.1 < float(np.mean(log_rets)) < 0.1
    assert float(np.std(log_rets)) > 0.0


def test_regime_features_non_nan():
    np.random.seed(1)
    closes = np.cumprod(1 + np.random.randn(1000) * 0.02) * 100
    volumes = np.random.rand(1000) * 1_000_000
    features = _build_regime_features(closes, volumes)
    assert not np.any(np.isnan(features))
    assert not np.any(np.isinf(features))


def test_one_hot_uses_canonical_regime_order():
    detector = RegimeDetector()
    detector._state_label_map = {2: "bear", 1: "crab", 0: "bull"}

    assert detector.one_hot(2) == [1.0, 0.0, 0.0]
    assert detector.one_hot(1) == [0.0, 1.0, 0.0]
    assert detector.one_hot(0) == [0.0, 0.0, 1.0]
