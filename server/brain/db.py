
from __future__ import annotations

import sqlite3
from pathlib import Path

import sqlite_vec

_SCHEMA = Path(__file__).with_name("schema.sql")


def connect(db_path: str, dim: int) -> sqlite3.Connection:
    con = sqlite3.connect(db_path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.enable_load_extension(True)
    sqlite_vec.load(con)
    con.enable_load_extension(False)

    con.executescript(_SCHEMA.read_text(encoding="utf-8"))

    con.execute(
        f"CREATE VIRTUAL TABLE IF NOT EXISTS vec_chunks "
        f"USING vec0(embedding float[{dim}] distance_metric=cosine)"
    )
    con.commit()
    return con
