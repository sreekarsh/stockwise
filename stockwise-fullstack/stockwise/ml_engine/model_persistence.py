"""Model persistence helpers.

Persists scaler + models into a single joblib file so the FastAPI
inference server can load trained parameters.

We use joblib because it is already compatible with sklearn estimators.
ONNX export is done alongside joblib for production-safe inference.
"""

import logging
import os
from typing import Optional

import joblib
import numpy as np
from sklearn.preprocessing import RobustScaler

logger = logging.getLogger(__name__)

HAS_ONNX = False
try:
    from ml_engine.export_onnx import export_model, has_onnx, predict_onnx
    HAS_ONNX = True
except ImportError:
    pass


def model_path() -> str:
    base = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(base, "model.joblib")


def save_state(predictor, extra: Optional[dict] = None) -> None:
    payload = {
        "scaler": predictor.scaler,
        "clf": predictor.clf,
        "reg": predictor.reg,
        "conformal_q": predictor.conformal_q,
        "conformal_residuals": predictor.conformal_residuals,
        "forecast_horizon": predictor.forecast_horizon,
        "is_fitted": True,
        "extra": extra or {},
        "_feature_names": getattr(predictor, "_feature_names", None),
        "model_version": predictor.__class__.__name__,
    }
    tmp = model_path() + ".tmp"
    joblib.dump(payload, tmp)
    os.replace(tmp, model_path())

    # Export ONNX alongside joblib
    if HAS_ONNX:
        try:
            export_model(predictor, n_features=len(predictor._feature_names))
            logger.info("ONNX model exported alongside joblib")
        except Exception as e:
            logger.warning("ONNX export failed (non-fatal): %s", e)


def load_state(predictor) -> bool:
    p = model_path()
    if not os.path.exists(p):
        return False
    payload = joblib.load(p)

    # Try ONNX runtime first if available
    if HAS_ONNX and has_onnx():
        predictor._use_onnx = True
        logger.info("Using ONNX runtime for inference")

    # Check feature count compatibility
    loaded_feature_count = len(payload.get("clf", {}).feature_importances_) if payload.get("clf") else 0
    expected_feature_count = len(predictor._feature_names)
    predictor._feature_pad = max(0, loaded_feature_count - expected_feature_count)
    if loaded_feature_count != expected_feature_count:
        logger.warning("Feature count mismatch: model has %d features, code expects %d. "
                       "Will pad/truncate feature vectors for compatibility.",
                       loaded_feature_count, expected_feature_count)
        predictor.scaler = payload.get("scaler", RobustScaler())
        if hasattr(predictor.scaler, "n_features_in_") and loaded_feature_count > expected_feature_count:
            predictor._feature_pad = loaded_feature_count - expected_feature_count
    else:
        predictor.scaler = payload["scaler"]
        predictor._feature_pad = 0

    predictor.clf = payload["clf"]
    predictor.reg = payload["reg"]
    predictor.conformal_q = payload.get("conformal_q", 0.0)
    predictor.conformal_residuals = payload.get("conformal_residuals", [])
    predictor.forecast_horizon = payload.get("forecast_horizon", predictor.forecast_horizon)
    predictor._is_fitted = bool(payload.get("is_fitted", loaded_feature_count == expected_feature_count))
    return predictor._is_fitted


def predict_with_onnx(predictor, feats_dict):
    if not (HAS_ONNX and getattr(predictor, "_use_onnx", False)):
        return None
    try:
        x = np.array([[feats_dict.get(n, 0.0) for n in predictor._feature_names]], dtype=np.float32)
        result = predict_onnx(x)
        if result is None:
            return None
        proba, pct = result
        return proba, float(pct[0][0])
    except Exception as e:
        logger.debug("ONNX predict failed, falling back: %s", e)
        return None

