
from __future__ import annotations

import json
import struct


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

    def search(self, embedding: list[float], k: int = 6,
              max_distance: float | None = None) -> list[tuple]:
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
            """WITH knn AS (
                   SELECT rowid AS cid, distance FROM vec_chunks
                   WHERE embedding MATCH ? ORDER BY distance LIMIT ?
               )
               SELECT c.text, c.thread_id, knn.distance
               FROM knn JOIN chunks c ON c.id = knn.cid
               ORDER BY knn.distance""",
            (_pack(embedding), pool)).fetchall()

        if max_distance is not None:
            rows = [r for r in rows if r["distance"] <= max_distance][:k * 3]

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
        return [r["name"] for r in rows if r["name"].lower() in low]

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

    def wipe_all(self) -> None:
        """Delete every row across all tables -- used by full account reset."""
        self.con.execute("DELETE FROM edges")
        self.con.execute("DELETE FROM entities")
        self.con.execute("DELETE FROM vec_chunks")
        self.con.execute("DELETE FROM chunks")
        self.con.execute("DELETE FROM messages")
        self.con.execute("DELETE FROM threads")
        self.con.commit()
