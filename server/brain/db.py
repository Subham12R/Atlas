
from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

import sqlite_vec

# PyInstaller extracts bundled data files to ``sys._MEIPASS``. Resolve the
# schema there in a packaged server, while retaining the source-tree path for
# development and tests.
_SCHEMA = (
    Path(getattr(sys, "_MEIPASS")) / "brain" / "schema.sql"
    if getattr(sys, "frozen", False)
    else Path(__file__).with_name("schema.sql")
)

# One vector table per searchable thing; rowid = the id of the row it embeds.
VECTOR_TABLES = ("vec_chunks", "vec_doc_chunks", "vec_entities", "vec_doc_entities")


def _migrate(con: sqlite3.Connection) -> None:
    """Bring databases from older Atlas versions up to the current schema."""
    columns = {row[1] for row in con.execute("PRAGMA table_info(document_chunks)")}
    if "page" not in columns:
        con.execute("ALTER TABLE document_chunks ADD COLUMN page INTEGER")
    if con.execute("SELECT 1 FROM meta WHERE key='fts_built'").fetchone() is None:
        # Keyword indexes added after rows already existed: index those rows once.
        con.execute("INSERT INTO chunks_fts(chunks_fts) VALUES ('rebuild')")
        con.execute("INSERT INTO document_chunks_fts(document_chunks_fts) VALUES ('rebuild')")
        con.execute("INSERT INTO meta(key, value) VALUES ('fts_built', '1')")


def connect(db_path: str, dim: int, model: str = "") -> sqlite3.Connection:
    con = sqlite3.connect(db_path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.enable_load_extension(True)
    sqlite_vec.load(con)
    con.enable_load_extension(False)

    con.executescript(_SCHEMA.read_text(encoding="utf-8"))
    _migrate(con)

    # Vectors from different models (or sizes) are not comparable. When the
    # model changes, drop them; the text stays, and the backfill re-embeds it.
    # Databases from before this record existed used another model: rebuild those too.
    identity = f"{model}:{dim}"
    stored = con.execute("SELECT value FROM meta WHERE key='embedding'").fetchone()
    if stored is None or stored[0] != identity:
        for table in VECTOR_TABLES:
            con.execute(f"DROP TABLE IF EXISTS {table}")
    con.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('embedding', ?)", (identity,))
    for table in VECTOR_TABLES:
        con.execute(
            f"CREATE VIRTUAL TABLE IF NOT EXISTS {table} "
            f"USING vec0(embedding float[{dim}] distance_metric=cosine)"
        )
    con.commit()
    return con
