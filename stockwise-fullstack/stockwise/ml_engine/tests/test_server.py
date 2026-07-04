from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi.testclient import TestClient

from server import app


@pytest.fixture
def client():
    return TestClient(app)


def test_health_endpoint(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "model_version" in data
    assert "is_fitted" in data


def test_meta_endpoint(client):
    resp = client.get("/meta")
    assert resp.status_code == 200
    data = resp.json()
    assert "feature_count" in data
    assert "classes" in data
    assert "forecast_h" in data


def test_predict_no_model(client):
    resp = client.post(
        "/api/ml/predict?model=gbm",
        json={
            "symbol": "BTC",
            "prices": [100.0] * 30,
        },
    )
    assert resp.status_code == 503
    assert "not trained" in resp.json()["detail"].lower()


def test_predict_invalid_model(client):
    resp = client.post(
        "/api/ml/predict?model=invalid",
        json={
            "symbol": "BTC",
            "prices": [100.0] * 30,
        },
    )
    assert resp.status_code == 400


def test_batch_signals_empty(client):
    resp = client.post("/api/ml/signals", json={"snapshots": []})
    assert resp.status_code == 200
    assert resp.json() == []


def test_health_cors_headers(client):
    resp = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    assert resp.status_code == 200
    assert resp.headers.get("access-control-allow-origin") is not None
