#!/bin/sh
# Start MLflow tracking server for StockWise model registry
# Usage: ./setup-mlflow.sh [port]

set -e

PORT="${1:-5000}"
BACKEND_URI="${MLFLOW_BACKEND_URI:-sqlite:///mlflow.db}"
ARTIFACT_ROOT="${MLFLOW_ARTIFACT_ROOT:-./mlflow_artifacts}"

mkdir -p "$ARTIFACT_ROOT"

echo "[mlflow] Starting tracking server on port $PORT..."
mlflow server \
  --backend-store-uri "$BACKEND_URI" \
  --default-artifact-root "$ARTIFACT_ROOT" \
  --host 0.0.0.0 \
  --port "$PORT"
