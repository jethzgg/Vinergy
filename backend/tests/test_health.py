"""Smoke tests for the Vinergy backend skeleton."""

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_root() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "vinergy-backend",
        "is_simulated": True,
    }


def test_health_api_v1() -> None:
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
