"""
Local store for provider API keys / local-LLM settings that can be changed at
runtime from the desktop app's Advanced settings UI.

.env stays the bootstrap source -- the first value you ever set. Anything
saved later via `PUT /settings/providers/{provider}` is written here instead
of rewriting .env, and reads prefer this store over .env once a value exists.
That means a saved key takes effect immediately for new sessions and survives
a server restart, without touching the .env file at all.
"""
from __future__ import annotations

import os
import sqlite3
import time

_DB_PATH = os.getenv("CREDENTIALS_DB_PATH", "credentials.db").strip()
_conn: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
        _conn.execute(
            "CREATE TABLE IF NOT EXISTS credentials ("
            "  key TEXT PRIMARY KEY,"
            "  value TEXT NOT NULL,"
            "  updated_at REAL NOT NULL"
            ")"
        )
        _conn.commit()
    return _conn


def get(key: str) -> str | None:
    row = _connect().execute(
        "SELECT value FROM credentials WHERE key = ?", (key,)
    ).fetchone()
    return row[0] if row else None


def set_many(updates: dict[str, str]) -> None:
    conn = _connect()
    now = time.time()
    conn.executemany(
        "INSERT INTO credentials (key, value, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value, "
        "updated_at = excluded.updated_at",
        [(k, v, now) for k, v in updates.items()],
    )
    conn.commit()


def get_value(key: str) -> str:
    """DB (post-rotation) takes precedence over .env (bootstrap)."""
    return get(key) or os.getenv(key, "").strip()


def delete(key: str) -> None:
    """Clear a saved value. Does not touch .env -- if a key is present there,
    get_value() will fall back to it again on the next read."""
    conn = _connect()
    conn.execute("DELETE FROM credentials WHERE key = ?", (key,))
    conn.commit()


def clear_all() -> None:
    """Wipe every saved credential/local-LLM setting -- used by full account reset."""
    conn = _connect()
    conn.execute("DELETE FROM credentials")
    conn.commit()
