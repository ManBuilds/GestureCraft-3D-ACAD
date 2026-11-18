# Gesturecraft – gesture-controlled 3D massing tool

Build architectural massing models in 3D with your bare hand. A webcam tracks the hand, machine-learning models recognise the gesture, and a Python backend verifies gestures and stores designs.

## Architecture
```
 Browser (frontend/)                                   Python (backend/)
 ┌───────────────────────────────────────────┐        ┌──────────────────────────────────┐
 │ webcam → MediaPipe hand landmarker +      │  WS    │ FastAPI                          │
 │          gesture classifier (ML, WASM)    │───────▶│  /ws/gesture  → MLP classifier   │
 │ cursor filter, gesture state machine      │◀───────│  /api/classify, /api/health      │
 │ Three.js 3D scene, undo, OBJ export       │  REST  │  /api/designs (SQLite, API key)  │
 └───────────────────────────────────────────┘───────▶└──────────────────────────────────┘
                                                         ml/: synthetic data, training, collection
```

## Run
```
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                                   # Windows: copy .env.example .env
uvicorn app.main:app --app-dir backend --port 8000
```
Open http://localhost:8000 in Chrome and allow the camera (needs internet on first load for the models and Three.js).
If the backend is not running, the app still works with the on-device checks only ("server model: offline").

## Gestures
| Gesture | Action |
|---|---|
| Pinch, release | Preview while pinched, block placed on release. Drag while pinched to size a volume |
| Peace sign | Hold ~0.45 s on a block to remove it |
| Fist | Move to turn the model |
| Yo sign | Hold ~0.9 s to clear everything (Undo restores) |
| Open palm | Hover |

R recentres your hand. Ctrl/Cmd+Z undoes.

## Machine learning
1. **Hand landmark detector** (MediaPipe, pretrained CNN): 21 3D landmarks per frame.
2. **Gesture classifier** (MediaPipe, pretrained): open palm, fist, victory.
3. **Custom MLP** (`backend/ml`, 63-128-64-6, trained by us): open, pinch, peace, fist, yo, other. Input is the 63 landmark coordinates centred on the wrist and divided by hand size. Served by the backend over WebSocket.
4. **Agreement rule**: an action only fires when the models and finger geometry agree; if the server MLP is confident (>= 85%) and disagrees, nothing happens. Toggle in Controls.
5. **Filtering**: One Euro filter on the cursor, pointer speed limit, hysteresis on the pinch, 4-of-5 frame voting.

### Training data (be upfront about this in the report)
`backend/ml/hand_synth.py` generates **synthetic** samples from a posed 3D hand skeleton (joint angles per gesture, random view, hand size, mirroring, jitter). The shipped model was trained on 30,000 of these. Validation accuracy on held-out synthetic samples is about 96.8% (`ml/reports/training_report.png`). **That is not real-world accuracy.**
To train on real hands too:
```
pip install -r requirements-ml.txt
cd backend/ml
python collect_data.py        # keys 1-6 record open/pinch/peace/fist/yo/other into data/landmarks.csv
python train.py               # merges real + synthetic, uses PyTorch if installed, writes weights/gesture_mlp.json
```
The shipped weights were trained with the NumPy backend of `train.py` (PyTorch was not available when they were built).

## Why blocks are not placed by accident
Placement happens on release after a >=150 ms pinch with a live preview; gestures need 4/5 frame agreement; the cursor changes cell only after clearly crossing into it; tracking loss or a hand leaving the frame cancels a pending pinch; delete and clear require a hold; everything is undoable.

## API
| Method | Path | Notes |
|---|---|---|
| GET | /api/health | status, labels, model info |
| POST | /api/classify | `{"features": [63 numbers]}` |
| WS | /ws/gesture | send a JSON list of 63 numbers per frame |
| GET/POST | /api/designs | POST needs `X-API-Key` if `API_KEY` is set |
| GET/DELETE | /api/designs/{id} | DELETE needs the key |

## Secrets and git
No third-party API keys are used. `.env` (settings, optional `API_KEY`) and `frontend/js/config.js` are git-ignored; copy from `.env.example` and `frontend/js/config.example.js`. The API key is a simple shared key for write protection, not user authentication, and anything in frontend JS is visible to users.

## Tests
```
pip install -r requirements-dev.txt
cd backend && pytest
```

## Layout
```
frontend/  index.html  css/styles.css  js/app.js  js/api.js  js/config(.example).js
backend/   app/{main,config,db,inference}.py   ml/{hand_synth,train,collect_data}.py   ml/weights  ml/reports   tests/
```
