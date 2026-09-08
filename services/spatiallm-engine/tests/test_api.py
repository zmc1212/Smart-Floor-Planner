import importlib

from fastapi.testclient import TestClient


def create_client(monkeypatch):
    monkeypatch.setenv("SPATIALLM_MODE", "mock")
    import main

    importlib.reload(main)
    return TestClient(main.app)


def test_health_reports_mock_engine(monkeypatch):
    with create_client(monkeypatch) as client:
        response = client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "mode": "mock",
        "model": "mock",
        "device": "cpu",
    }


def test_predict_accepts_ply(monkeypatch):
    with create_client(monkeypatch) as client:
        response = client.post(
            "/api/v1/predict3d",
            files={"file": ("room.ply", b"ply\n", "application/octet-stream")},
        )
    assert response.status_code == 200
    assert response.json()["units"] == "millimetres"
    assert response.json()["layout"]["walls"]


def test_predict_rejects_other_extensions(monkeypatch):
    with create_client(monkeypatch) as client:
        response = client.post(
            "/api/v1/predict3d",
            files={"file": ("room.txt", b"not a ply", "text/plain")},
        )
    assert response.status_code == 400
