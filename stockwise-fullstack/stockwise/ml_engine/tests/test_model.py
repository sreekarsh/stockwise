from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import math
import numpy as np
from model import MLPredictor, FEATURE_NAMES, LABEL_MAP


def _dummy_features(price: float = 100.0) -> dict:
    return {name: float(np.random.randn() * 0.1) for name in FEATURE_NAMES} | {"price": price}


def _dummy_dataset(n: int = 200):
    np.random.seed(42)
    X = np.random.randn(n, len(FEATURE_NAMES))
    y = np.random.randint(0, 3, n)
    t = np.random.randn(n) * 0.02
    return X, y, t


def test_predictor_initial_state():
    p = MLPredictor()
    assert p._is_fitted is False
    assert len(p._feature_names) == len(FEATURE_NAMES)
    assert isinstance(p.conformal_q, float)


def test_predictor_fit_and_predict():
    p = MLPredictor()
    X, y, t = _dummy_dataset()
    p.fit(X, y, t)
    assert p._is_fitted is True

    feats = _dummy_features()
    result = p.predict(feats, symbol="BTC")
    assert result["signal"] in ("HOLD", "BUY", "SELL")
    assert 0.0 <= result["confidence"] <= 100.0
    assert "forecast" in result
    assert "trading_plan" in result
    assert "shap_top5" in result
    assert len(result["shap_top5"]) == 5
    assert "model_version" in result


def test_trading_plan_buy():
    p = MLPredictor()
    plan = p._trading_plan(price=100.0, atr=2.0, signal="BUY", risk_scale=1.0)
    assert plan["entry"] == 100.0
    assert plan["take_profit"] > plan["entry"]
    assert plan["stop_loss"] < plan["entry"]
    assert plan["risk_reward_ratio"] is not None
    assert isinstance(plan["time_horizon_hours"], int)


def test_trading_plan_sell():
    p = MLPredictor()
    plan = p._trading_plan(price=100.0, atr=2.0, signal="SELL", risk_scale=1.0)
    assert plan["entry"] == 100.0
    assert plan["take_profit"] < plan["entry"]
    assert plan["stop_loss"] > plan["entry"]


def test_trading_plan_hold():
    p = MLPredictor()
    plan = p._trading_plan(price=100.0, atr=2.0, signal="HOLD", risk_scale=1.0)
    assert plan["risk_reward_ratio"] is None


def test_trading_plan_regime_scaling():
    p = MLPredictor()
    bear = p._trading_plan(price=100.0, atr=2.0, signal="BUY", risk_scale=1.0, regime_state=0)
    bull = p._trading_plan(price=100.0, atr=2.0, signal="BUY", risk_scale=1.0, regime_state=2)
    assert bull["take_profit"] >= bear["take_profit"]


def test_trading_plan_funding_adjustment():
    p = MLPredictor()
    high_funding = p._trading_plan(price=100.0, atr=2.0, signal="BUY", risk_scale=1.0, funding_rate=0.002)
    normal = p._trading_plan(price=100.0, atr=2.0, signal="BUY", risk_scale=1.0, funding_rate=0.0)
    assert high_funding["take_profit"] <= normal["take_profit"]


def test_risk_scale():
    p = MLPredictor()
    btc_scale = p._risk_scale("BTC", ann_vol=0.25)
    assert 0.9 <= btc_scale <= 2.4
    shib_scale = p._risk_scale("SHIB", ann_vol=0.25)
    assert shib_scale >= btc_scale


def test_asset_beta():
    p = MLPredictor()
    assert p._asset_beta("BTC") == 1.0
    assert p._asset_beta("SHIB") == 2.0
    assert p._asset_beta("UNKNOWN") == 1.0


def test_feature_sanitization():
    p = MLPredictor()
    X, y, t = _dummy_dataset()
    p.fit(X, y, t)

    feats = _dummy_features()
    feats["price"] = math.nan
    feats["atr"] = None
    result = p.predict(feats)
    assert result["signal"] in ("HOLD", "BUY", "SELL")


def test_adaptive_conformal_q():
    p = MLPredictor()
    q = p._adaptive_conformal_q(0.05, ann_vol=0.3)
    assert isinstance(q, float)
    assert q >= 0


def test_prediction_window():
    p = MLPredictor()
    pw = p._prediction_window(price=100.0, pct=0.02, q=0.01)
    assert pw["low"] < pw["high"]
    assert "confidence_level" in pw


def test_predict_before_fit_raises():
    p = MLPredictor()
    try:
        p.predict({"price": 100.0})
        assert False, "Should have raised"
    except RuntimeError:
        pass


def test_format_probability_bars():
    p = MLPredictor()
    proba = np.array([0.2, 0.5, 0.3])
    bars = p._format_probability_bars(proba)
    assert bars["HOLD"] == 20.0
    assert bars["BUY"] == 50.0
    assert bars["SELL"] == 30.0
