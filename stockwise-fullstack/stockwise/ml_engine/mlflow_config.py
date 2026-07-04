"""
MLflow configuration for model registry, tracking, and canary deployments.
"""
import os

HAS_MLFLOW = False
try:
    import mlflow
    HAS_MLFLOW = True
    MLFLOW_TRACKING_URI = os.getenv("MLFLOW_TRACKING_URI", "http://localhost:5000")
    MLFLOW_EXPERIMENT_NAME = "stockwise_ml_v3"
    MLFLOW_MODEL_NAME = "stockwise_signal_predictor"
    mlflow.set_tracking_uri(MLFLOW_TRACKING_URI)
    mlflow.set_experiment(MLFLOW_EXPERIMENT_NAME)
except ImportError:
    MLFLOW_TRACKING_URI = ""
    MLFLOW_EXPERIMENT_NAME = ""
    MLFLOW_MODEL_NAME = ""


def register_model(run_id: str, stage: str = "Staging") -> str:
    """Register a model run in the MLflow Model Registry."""
    if not HAS_MLFLOW:
        return ""
    result = mlflow.register_model(
        f"runs:/{run_id}/model",
        MLFLOW_MODEL_NAME,
    )
    client = mlflow.tracking.MlflowClient()
    client.transition_model_version_stage(
        name=MLFLOW_MODEL_NAME,
        version=result.version,
        stage=stage,
    )
    return result.version


def get_production_model_uri() -> str | None:
    """Get the URI of the current production model."""
    if not HAS_MLFLOW:
        return None
    client = mlflow.tracking.MlflowClient()
    try:
        latest = client.get_latest_versions(MLFLOW_MODEL_NAME, stages=["Production"])
        if latest:
            return f"models:/{MLFLOW_MODEL_NAME}/{latest[0].version}"
    except Exception:
        pass
    return None


def should_canary_deploy(version: int, threshold: float = 0.55) -> bool:
    """
    Check if a staged model version should progress to canary deployment
    based on backtest metrics stored in MLflow.
    """
    if not HAS_MLFLOW:
        return False
    client = mlflow.tracking.MlflowClient()
    mv = client.get_model_version(MLFLOW_MODEL_NAME, version)
    run = client.get_run(mv.run_id)
    win_rate = run.data.metrics.get("win_rate", 0)
    return win_rate >= threshold
