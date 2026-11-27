"""SQLite persistence (stands in for PostgreSQL in the hackathon build)."""
from __future__ import annotations

import json
import os
import sqlite3
import threading
from contextlib import contextmanager
from datetime import datetime

DB_PATH = os.environ.get(
    "PARTWISE_DB", os.path.join(os.path.dirname(__file__), "..", "partwise.db")
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS rooftops (
  id TEXT PRIMARY KEY, name TEXT, short TEXT, area TEXT,
  lat REAL, lng REAL, is_home INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS parts (
  id TEXT PRIMARY KEY, name TEXT, category TEXT, safety_critical INTEGER,
  new_price INTEGER, new_co2_kg REAL, labor_hours REAL
);
CREATE TABLE IF NOT EXISTS inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT, rooftop_id TEXT, part_id TEXT,
  condition TEXT, grade TEXT, qty INTEGER, price INTEGER,
  warranty_months INTEGER, days_in_stock INTEGER, source TEXT
);
CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY, name TEXT, phone TEXT, green_points INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vehicles (
  id TEXT PRIMARY KEY, customer_id TEXT, make_model TEXT, body TEXT, year INTEGER,
  km INTEGER, vin TEXT, factory_warranty_until TEXT,
  ext_warranty_active INTEGER, ext_warranty_categories TEXT, ext_warranty_until TEXT
);
CREATE TABLE IF NOT EXISTS repair_orders (
  id TEXT PRIMARY KEY, rooftop_id TEXT, vehicle_id TEXT, advisor TEXT,
  status TEXT, complaint TEXT, created_at TEXT, customer_token TEXT,
  approved_at TEXT, customer_decided_at TEXT
);
CREATE TABLE IF NOT EXISTS ro_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ro_id TEXT, part_id TEXT, labor_desc TEXT,
  status TEXT DEFAULT 'pending', approved_option TEXT, override_reason TEXT,
  chosen_option TEXT
);
CREATE TABLE IF NOT EXISTS recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ro_line_id INTEGER, rules_version INTEGER,
  decision TEXT, payload TEXT, explanation TEXT, llm_mode TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ro_id TEXT, line_id INTEGER, inventory_id INTEGER,
  part_id TEXT, from_rooftop TEXT, to_rooftop TEXT, status TEXT, fee INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS sms_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ro_id TEXT, to_phone TEXT, body TEXT,
  link TEXT, status TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS green_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT, customer_id TEXT, ro_id TEXT, points INTEGER,
  co2_kg REAL, note TEXT, created_at TEXT
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT, ro_id TEXT, actor TEXT,
  event TEXT, detail TEXT
);
CREATE TABLE IF NOT EXISTS rules_versions (
  version INTEGER PRIMARY KEY, yaml TEXT, created_at TEXT, author TEXT, note TEXT
);
CREATE TABLE IF NOT EXISTS outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ro_id TEXT, line_id INTEGER, rooftop_id TEXT,
  part_id TEXT, category TEXT, decision TEXT, chosen_condition TEXT,
  had_alternative INTEGER, savings_inr INTEGER, co2_saved_kg REAL,
  wait_days_saved REAL, idle_value_moved INTEGER, transfer_fee INTEGER, created_at TEXT
);
CREATE TABLE IF NOT EXISTS llm_cache (key TEXT PRIMARY KEY, value TEXT);
"""

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        _conn.executescript(SCHEMA)
        # Lightweight migrations for databases created by earlier builds.
        cols = {r[1] for r in _conn.execute("PRAGMA table_info(repair_orders)")}
        for col, typ in (("source", "TEXT DEFAULT 'arc'"), ("diagnosis", "TEXT")):
            if col not in cols:
                _conn.execute(f"ALTER TABLE repair_orders ADD COLUMN {col} {typ}")
        _conn.commit()
    return _conn


@contextmanager
def tx():
    """Serialized transaction: commit on success, roll back on error."""
    with _lock:
        c = conn()
        try:
            yield c
            c.commit()
        except Exception:
            c.rollback()
            raise


def rows(sql: str, params: tuple | list = ()) -> list[dict]:
    with _lock:
        return [dict(r) for r in conn().execute(sql, params).fetchall()]


def row(sql: str, params: tuple | list = ()) -> dict | None:
    with _lock:
        r = conn().execute(sql, params).fetchone()
        return dict(r) if r else None


def now() -> str:
    return datetime.now().isoformat(timespec="seconds")


def audit(c: sqlite3.Connection, ro_id: str | None, actor: str, event: str, detail: dict):
    c.execute(
        "INSERT INTO audit_log (ts, ro_id, actor, event, detail) VALUES (?,?,?,?,?)",
        (now(), ro_id, actor, event, json.dumps(detail, ensure_ascii=False)),
    )


def reset():
    """Drop everything; the caller reseeds."""
    global _conn
    with _lock:
        if _conn is not None:
            _conn.close()
            _conn = None
        if os.path.exists(DB_PATH):
            os.remove(DB_PATH)
        conn()
