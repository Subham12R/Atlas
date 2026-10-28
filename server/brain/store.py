
from __future__ import annotations

import json
import re
import struct

from .hybrid import fts_query

# Which chunk table each vector table embeds, and the title used when embedding it.
_EMBED_SOURCES = {
    "vec_chunks": ("SELECT c.id, c.text, NULL AS title FROM chunks c", "c.id"),
    "vec_doc_chunks": ("SELECT c.id, c.text, d.name AS title FROM document_chunks c "
                       "JOIN documents d ON d.source_id = c.source_id", "c.id"),
    "vec_entities": ("SELECT e.id, e.name AS text, NULL AS title FROM entities e", "e.id"),
    "vec_doc_entities": ("SELECT e.id, e.name AS text, NULL AS title FROM doc_entities e", "e.id"),
}


def _pack(vec: list[float]) -> bytes:
    return struct.pack("%df" % len(vec), *vec)


class MemoryStore:
    def __init__(self, con):
        self.con = con

    def create_thread(self, thread_id: str, provider: str, title: str = "") -> None:
        self.con.execute(
            "INSERT OR IGNORE INTO threads(id, provider, title) VALUES (?,?,?)",
            (thread_id, provider, title))
        self.con.commit()

    def get_summary(self, thread_id: str) -> str:
        row = self.con.execute(
            "SELECT rolling_summary FROM threads WHERE id=?", (thread_id,)).fetchone()
        return row["rolling_summary"] if row else ""

    def set_summary(self, thread_id: str, summary: str) -> None:
        self.con.execute(
            "UPDATE threads SET rolling_summary=? WHERE id=?", (summary, thread_id))
        self.con.commit()

    def has_messages(self, thread_id: str) -> bool:
        row = self.con.execute(
            "SELECT 1 FROM messages WHERE thread_id=? LIMIT 1", (thread_id,)).fetchone()
        return row is not None

    def add_message(self, thread_id: str, role: str, content: str,
                    provider: str | None = None, meta: dict | None = None,
                    chunks: list[tuple] | None = None) -> int:
        """Insert a message plus its embedded chunks. `chunks` is a list of
        (text, embedding) -- one message can span several searchable chunks."""
        cur = self.con.execute(
            "INSERT INTO messages(thread_id, role, content, provider, meta) "
            "VALUES (?,?,?,?,?)",
            (thread_id, role, content, provider, json.dumps(meta or {})))
        mid = cur.lastrowid
        for text, embedding in (chunks or []):
            cur = self.con.execute(
                "INSERT INTO chunks(message_id, thread_id, text) VALUES (?,?,?)",
                (mid, thread_id, text))
            if embedding is not None:
                self.con.execute(
                    "INSERT INTO vec_chunks(rowid, embedding) VALUES (?,?)",
                    (cur.lastrowid, _pack(embedding)))
        self.con.commit()
        return mid

    def recent_chunks(self, thread_id: str, limit: int = 2) -> list[tuple]:
        """Latest searchable chunks from this thread, newest first."""
        rows = self.con.execute(
            """SELECT c.text, c.thread_id
               FROM chunks c
               JOIN messages m ON m.id = c.message_id
               WHERE c.thread_id=? AND m.role='assistant'
               ORDER BY c.id DESC LIMIT ?""",
            (thread_id, limit),
        ).fetchall()
        return [(row["text"], row["thread_id"], 0.0) for row in reversed(rows)]

    def keyword_search(self, query: str, k: int = 12,
                       scope_thread_id: str | None = None) -> list[tuple]:
        """BM25 keyword hits over chat memory -> [(chunk_id, text, thread_id), ...], best first."""
        match = fts_query(query)
        if not match:
            return []
        rows = self.con.execute(
            """SELECT c.id, c.text, c.thread_id FROM chunks_fts f JOIN chunks c ON c.id = f.rowid
               WHERE chunks_fts MATCH ? AND (? IS NULL OR c.thread_id = ?)
               ORDER BY bm25(chunks_fts) LIMIT ?""",
            (match, scope_thread_id, scope_thread_id, k)).fetchall()
        return [(r["id"], r["text"], r["thread_id"]) for r in rows]

    def dense_search(self, embedding: list[float], k: int = 12,
                     max_distance: float | None = None) -> list[tuple]:
        """Nearest chat chunks with ids -> [(chunk_id, text, thread_id, distance), ...]."""
        rows = self.con.execute(
            """WITH knn AS (SELECT rowid AS cid, distance FROM vec_chunks
                             WHERE embedding MATCH ? ORDER BY distance LIMIT ?)
               SELECT c.id, c.text, c.thread_id, knn.distance FROM knn JOIN chunks c ON c.id = knn.cid
               ORDER BY knn.distance""", (_pack(embedding), k)).fetchall()
        return [(r["id"], r["text"], r["thread_id"], r["distance"]) for r in rows
                if max_distance is None or r["distance"] <= max_distance]

    # ---- embedding backfill: rows stored before the model was ready (or after a model change)
    def pending_embeddings(self, table: str, limit: int = 32) -> list[tuple]:
        """Rows of `table`'s source that have no vector yet -> [(id, text, title), ...]."""
        select, key = _EMBED_SOURCES[table]
        rows = self.con.execute(
            f"{select} WHERE {key} NOT IN (SELECT rowid FROM {table}) ORDER BY {key} LIMIT ?",
            (limit,)).fetchall()
        return [(r["id"], r["text"], r["title"]) for r in rows]

    def store_embeddings(self, table: str, rows: list[tuple]) -> None:
        if table not in _EMBED_SOURCES:
            raise ValueError(table)
        select, key = _EMBED_SOURCES[table]
        with self.con:
            for row_id, vector in rows:
                # The source row may have been deleted while it was being embedded.
                if self.con.execute(f"{select} WHERE {key} = ?", (row_id,)).fetchone():
                    self.con.execute(f"INSERT OR REPLACE INTO {table}(rowid, embedding) VALUES (?,?)",
                                     (row_id, _pack(vector)))

    def similar_entities(self, embedding: list[float], k: int = 5,
                         max_distance: float = 0.35) -> list[str]:
        """Chat-graph entities whose names mean what the query is about."""
        rows = self.con.execute(
            """WITH knn AS (SELECT rowid AS eid, distance FROM vec_entities
                             WHERE embedding MATCH ? ORDER BY distance LIMIT ?)
               SELECT e.name, knn.distance FROM knn JOIN entities e ON e.id = knn.eid""",
            (_pack(embedding), k)).fetchall()
        return [r["name"] for r in rows if r["distance"] <= max_distance]

    def search(self, embedding: list[float], k: int = 6,
              max_distance: float | None = None,
              preferred_thread_id: str | None = None,
              scope_thread_id: str | None = None) -> list[tuple]:
        """Nearest chunks -> [(text, thread_id, distance), ...].

        `vec_chunks` uses `distance_metric=cosine` (0 = identical, 2 = opposite).
        With `max_distance` set, this pulls a candidate pool larger than `k`
        and keeps every chunk within that cosine-distance cutoff (capped at
        `k * 3`) instead of always returning exactly `k` -- so a query with
        several strongly-similar chunks pulls in more context, and one with
        nothing relevant pulls in none, rather than padding with weak matches.
        `max_distance=None` keeps the old fixed-top-k behavior (used by the
        plain /memory/search inspection endpoint).
        """
        pool = max(k * 4, 24) if max_distance is not None else k
        rows = self.con.execute(
            """WITH scoped AS (
                   SELECT id FROM chunks WHERE (? IS NULL OR thread_id = ?)
               ), knn AS (
                   SELECT rowid AS cid, distance FROM vec_chunks
                   WHERE embedding MATCH ? AND rowid IN (SELECT id FROM scoped)
                   ORDER BY distance LIMIT ?
               )
               SELECT c.text, c.thread_id, knn.distance
               FROM knn JOIN chunks c ON c.id = knn.cid
               ORDER BY knn.distance""",
            (scope_thread_id, scope_thread_id, _pack(embedding), pool)).fetchall()

        if max_distance is not None:
            rows = [r for r in rows if r["distance"] <= max_distance][:k * 3]

        # Keep the active conversation coherent: when its hits are relevant,
        # place them before equally relevant cross-conversation memories.
        if preferred_thread_id:
            rows.sort(key=lambda row: (row["thread_id"] != preferred_thread_id, row["distance"]))

        return [(r["text"], r["thread_id"], r["distance"]) for r in rows]

    def upsert_entity(self, name: str, type_: str, thread_id: str) -> int:
        self.con.execute(
            "INSERT INTO entities(name, type, thread_id) VALUES (?,?,?) "
            "ON CONFLICT(name, type, thread_id) DO UPDATE SET mentions = mentions + 1",
            (name, type_, thread_id))
        row = self.con.execute(
            "SELECT id FROM entities WHERE name=? AND type=? AND thread_id=?",
            (name, type_, thread_id)).fetchone()
        return row["id"]

    def add_edge(self, src_id: int, dst_id: int, relation: str,
                 thread_id: str) -> None:
        self.con.execute(
            "INSERT INTO edges(src_entity_id, dst_entity_id, relation, thread_id) "
            "VALUES (?,?,?,?) "
            "ON CONFLICT(src_entity_id, dst_entity_id, relation) "
            "DO UPDATE SET weight = weight + 1",
            (src_id, dst_id, relation, thread_id))
        self.con.commit()

    def entity_names_in(self, text: str) -> list[str]:
        """Stored entity names that appear (case-insensitive) in `text`."""
        low = text.lower()
        rows = self.con.execute("SELECT DISTINCT name FROM entities").fetchall()
        # Whole-word matches only: an entity "AI" must not match inside "said".
        return [r["name"] for r in rows
                if re.search(rf"(?<!\w){re.escape(r['name'].lower())}(?!\w)", low)]

    def neighbors(self, names: list[str], limit: int = 20) -> list[tuple]:
        """1-hop edges touching any of `names` -> [(src, relation, dst), ...]."""
        if not names:
            return []
        q = ",".join("?" * len(names))
        rows = self.con.execute(
            f"""SELECT se.name AS src, e.relation AS rel, de.name AS dst
                FROM edges e
                JOIN entities se ON se.id = e.src_entity_id
                JOIN entities de ON de.id = e.dst_entity_id
                WHERE se.name IN ({q}) OR de.name IN ({q})
                LIMIT ?""",
            (*names, *names, limit)).fetchall()
        return [(r["src"], r["rel"], r["dst"]) for r in rows]

    def graph(self, thread_id: str) -> dict:
        nodes = self.con.execute(
            "SELECT name, type, mentions FROM entities WHERE thread_id=?",
            (thread_id,)).fetchall()
        edges = self.con.execute(
            """SELECT se.name AS src, e.relation AS rel, de.name AS dst, e.weight
               FROM edges e
               JOIN entities se ON se.id = e.src_entity_id
               JOIN entities de ON de.id = e.dst_entity_id
               WHERE e.thread_id=?""",
            (thread_id,)).fetchall()
        return {"nodes": [dict(n) for n in nodes],
                "edges": [dict(e) for e in edges]}

    def delete_thread(self, thread_id: str) -> None:
        """Forget one conversation: its messages, recall vectors, summary and facts."""
        orphaned = """SELECT id FROM entities WHERE thread_id=? AND id NOT IN (
                          SELECT src_entity_id FROM edges WHERE thread_id != ?
                          UNION SELECT dst_entity_id FROM edges WHERE thread_id != ?)"""
        with self.con:
            self.con.execute(f"DELETE FROM vec_entities WHERE rowid IN ({orphaned})",
                             (thread_id, thread_id, thread_id))
            self.con.execute(
                "DELETE FROM vec_chunks WHERE rowid IN (SELECT id FROM chunks WHERE thread_id=?)",
                (thread_id,))
            self.con.execute("DELETE FROM chunks WHERE thread_id=?", (thread_id,))
            self.con.execute("DELETE FROM messages WHERE thread_id=?", (thread_id,))
            self.con.execute("DELETE FROM edges WHERE thread_id=?", (thread_id,))
            # Entities can still be referenced by another thread's edges (edges key on
            # entity ids, not threads); keep those, drop the rest.
            self.con.execute(
                """DELETE FROM entities WHERE thread_id=? AND id NOT IN (
                       SELECT src_entity_id FROM edges UNION SELECT dst_entity_id FROM edges)""",
                (thread_id,))
            self.con.execute("DELETE FROM threads WHERE id=?", (thread_id,))

    def wipe_all(self) -> None:
        """Delete every row across all tables -- used by full account reset."""
        for table in ("vec_doc_chunks", "vec_entities", "vec_doc_entities",
                      "doc_entity_chunks", "doc_entity_edges", "doc_entities"):
            self.con.execute(f"DELETE FROM {table}")
        self.con.execute("DELETE FROM document_chunks")
        self.con.execute("DELETE FROM documents")
        self.con.execute("DELETE FROM edges")
        self.con.execute("DELETE FROM entities")
        self.con.execute("DELETE FROM vec_chunks")
        self.con.execute("DELETE FROM chunks")
        self.con.execute("DELETE FROM messages")
        self.con.execute("DELETE FROM threads")
        self.con.commit()
