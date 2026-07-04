import logging
import os
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

ONNX_DIR = Path(__file__).parent / "models"
ONNX_DIR.mkdir(exist_ok=True)

HAS_SKL2ONNX = False
try:
    import skl2onnx
    from skl2onnx import convert_sklearn
    from skl2onnx.common.data_types import FloatTensorType
    HAS_SKL2ONNX = True
except ImportError:
    pass

HAS_ONNX = False
try:
    import onnx
    HAS_ONNX = True
except ImportError:
    pass

HAS_ONNX_RUNTIME = False
try:
    import onnxruntime as ort
    HAS_ONNX_RUNTIME = True
except ImportError:
    pass


def export_model(predictor, n_features=47):
    if not HAS_SKL2ONNX:
        logger.warning("skl2onnx not installed. Skipping ONNX export.")
        return False

    try:
        scaler = predictor.scaler
        clf = predictor.clf
        reg = predictor.reg

        input_type = [("input", FloatTensorType([None, n_features]))]

        scaler_onnx = convert_sklearn(scaler, "robust_scaler", input_type)
        clf_onnx = convert_sklearn(clf, "gbm_classifier", [("input", FloatTensorType([None, n_features]))])
        reg_onnx = convert_sklearn(reg, "gbm_regressor", [("input", FloatTensorType([None, n_features]))])

        scaler_path = ONNX_DIR / "scaler.onnx"
        clf_path = ONNX_DIR / "classifier.onnx"
        reg_path = ONNX_DIR / "regressor.onnx"

        with open(scaler_path, "wb") as f:
            f.write(scaler_onnx.SerializeToString())
        with open(clf_path, "wb") as f:
            f.write(clf_onnx.SerializeToString())
        with open(reg_path, "wb") as f:
            f.write(reg_onnx.SerializeToString())

        logger.info("ONNX models exported to %s", ONNX_DIR)
        return True

    except Exception as e:
        logger.warning("ONNX export failed: %s", e)
        return False


def load_onnx_session(model_name):
    path = ONNX_DIR / f"{model_name}.onnx"
    if not path.exists():
        return None
    if not HAS_ONNX_RUNTIME:
        return None
    return ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])


_sessions = {}


def get_session(name):
    if name not in _sessions:
        _sessions[name] = load_onnx_session(name)
    return _sessions[name]


def predict_onnx(features_2d):
    scaler_sess = get_session("scaler")
    clf_sess = get_session("classifier")
    reg_sess = get_session("regressor")
    if not all([scaler_sess, clf_sess, reg_sess]):
        return None

    x_scaled = scaler_sess.run(None, {"input": features_2d.astype(np.float32)})[0]
    proba = clf_sess.run(None, {"input": x_scaled})[0]
    pct = reg_sess.run(None, {"input": x_scaled})[0]
    return proba, pct


def has_onnx():
    return all(
        (ONNX_DIR / f"{name}.onnx").exists()
        for name in ("scaler", "classifier", "regressor")
    )
