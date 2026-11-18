"""Settings come from environment variables (loaded from the git-ignored .env file)."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:                       # python-dotenv is optional; real environment variables still work
    load_dotenv = lambda *a, **k: None

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")

API_KEY = os.getenv("API_KEY", "")        # empty = writes are open (fine for local use)
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",") if o.strip()]
DB_PATH = Path(os.getenv("DB_PATH", ROOT / "backend" / "data" / "gesturecraft.db"))
MODEL_PATH = Path(os.getenv("MODEL_PATH", ROOT / "backend" / "ml" / "weights" / "gesture_mlp.json"))
FRONTEND_DIR = ROOT / "frontend"
SERVE_FRONTEND = os.getenv("SERVE_FRONTEND", "1") == "1"
