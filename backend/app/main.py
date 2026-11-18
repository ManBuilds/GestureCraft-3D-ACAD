"""GestureCraft API: gesture classification (REST + WebSocket), saved designs, optional static frontend."""
import hmac
from fastapi import Depends, FastAPI, Header, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import config, db
from .inference import GestureModel

app = FastAPI(title="GestureCraft API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=config.ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"])
model = GestureModel(config.MODEL_PATH)


class Features(BaseModel):
    features: list[float] = Field(min_length=63, max_length=63)


class DesignIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    blocks: list[list[str]] = Field(max_length=5000)          # [["x,y,z", "#rrggbb"], ...]


def require_key(x_api_key: str = Header(default="")):
    if config.API_KEY and not hmac.compare_digest(x_api_key, config.API_KEY):
        raise HTTPException(401, "Invalid or missing API key")


@app.get("/api/health")
def health():
    return {"status": "ok", "labels": model.labels, "model": model.meta}


@app.post("/api/classify")
def classify(body: Features):
    return model.predict(body.features)


@app.websocket("/ws/gesture")
async def ws_gesture(ws: WebSocket):
    """The browser streams one 63-number feature vector per frame and gets the prediction back."""
    await ws.accept()
    try:
        while True:
            try:
                await ws.send_json(model.predict(__import__("json").loads(await ws.receive_text())))
            except (ValueError, TypeError):
                await ws.send_json({"error": "expected a JSON list of 63 numbers"})
    except WebSocketDisconnect:
        pass


@app.get("/api/designs")
def designs():
    return db.list_all()


@app.post("/api/designs", status_code=201, dependencies=[Depends(require_key)])
def save_design(body: DesignIn):
    return {"id": db.create(body.name, body.blocks)}


@app.get("/api/designs/{design_id}")
def design(design_id: int):
    d = db.get(design_id)
    if d is None:
        raise HTTPException(404, "Design not found")
    return d


@app.delete("/api/designs/{design_id}", dependencies=[Depends(require_key)])
def remove_design(design_id: int):
    if not db.delete(design_id):
        raise HTTPException(404, "Design not found")
    return {"deleted": design_id}


if config.SERVE_FRONTEND and config.FRONTEND_DIR.exists():      # keep last so it never shadows /api
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIR, html=True), name="frontend")
