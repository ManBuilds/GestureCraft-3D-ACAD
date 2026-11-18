"""Saved designs in SQLite (standard library only)."""
import json, sqlite3, time
from contextlib import closing
from .config import DB_PATH


def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(DB_PATH); c.row_factory = sqlite3.Row
    c.execute("CREATE TABLE IF NOT EXISTS designs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, blocks TEXT NOT NULL, created_at REAL NOT NULL)")
    return c


def create(name, blocks):
    with closing(_conn()) as c, c:
        return c.execute("INSERT INTO designs (name, blocks, created_at) VALUES (?, ?, ?)", (name, json.dumps(blocks), time.time())).lastrowid


def list_all():
    with closing(_conn()) as c:
        return [{"id": r["id"], "name": r["name"], "blocks": len(json.loads(r["blocks"])), "created_at": r["created_at"]}
                for r in c.execute("SELECT * FROM designs ORDER BY id DESC")]


def get(design_id):
    with closing(_conn()) as c:
        r = c.execute("SELECT * FROM designs WHERE id = ?", (design_id,)).fetchone()
    return None if r is None else {"id": r["id"], "name": r["name"], "blocks": json.loads(r["blocks"]), "created_at": r["created_at"]}


def delete(design_id):
    with closing(_conn()) as c, c:
        return c.execute("DELETE FROM designs WHERE id = ?", (design_id,)).rowcount > 0
