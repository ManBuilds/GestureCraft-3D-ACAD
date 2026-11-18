from fastapi.testclient import TestClient
from app.main import app
import hand_synth as hs

c = TestClient(app)
K = {"X-API-Key": "test-key"}


def test_health():
    r = c.get("/api/health"); assert r.status_code == 200 and "pinch" in r.json()["labels"]


def test_classify_and_validation():
    X, y = hs.make_dataset(1, seed=1)
    assert c.post("/api/classify", json={"features": X[1].tolist()}).json()["label"] in hs.LABELS
    assert c.post("/api/classify", json={"features": [0.0] * 5}).status_code == 422


def test_websocket():
    X, _ = hs.make_dataset(1, seed=2)
    with c.websocket_connect("/ws/gesture") as ws:
        ws.send_json(X[2].tolist()); assert "label" in ws.receive_json()
        ws.send_text("nonsense"); assert "error" in ws.receive_json()


def test_designs_need_key_and_round_trip():
    body = {"name": "Tower", "blocks": [["0,0,0", "#ffffff"]]}
    assert c.post("/api/designs", json=body).status_code == 401
    i = c.post("/api/designs", json=body, headers=K).json()["id"]
    assert c.get(f"/api/designs/{i}").json()["blocks"] == body["blocks"]
    assert any(d["id"] == i for d in c.get("/api/designs").json())
    assert c.delete(f"/api/designs/{i}", headers=K).status_code == 200
    assert c.get(f"/api/designs/{i}").status_code == 404
