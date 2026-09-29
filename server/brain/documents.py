"""Explicitly selected, text-only document index; separate from chat memory."""

from __future__ import annotations

import hashlib
import uuid

from .chunking import _window

MAX_DOCUMENT_BYTES = 1024 * 1024


class Documents:
    def __init__(self, con):
        self.con = con

    def ingest_document(self, name: str, text: str) -> str:
        try:
            name_bytes = name.encode('utf-8', errors='strict')
        except UnicodeError as exc:
            raise ValueError('Select a UTF-8 .txt or .md file with a valid name') from exc
        if (not name or name != name.strip() or '/' in name or '\\' in name
                or '\x00' in name or len(name_bytes) > 255
                or not name.lower().endswith(('.txt', '.md'))):
            raise ValueError('Select a UTF-8 .txt or .md file with a valid name')
        try:
            data = text.encode('utf-8', errors='strict')
        except UnicodeError as exc:
            raise ValueError('Document must be UTF-8 text') from exc
        if not data or len(data) > MAX_DOCUMENT_BYTES or not text.strip() or '\x00' in text:
            raise ValueError('Document must contain text and be at most 1 MiB')
        digest = hashlib.sha256(data).hexdigest()
        source_id = uuid.uuid4().hex
        with self.con:
            cur = self.con.execute(
                'INSERT OR IGNORE INTO documents(source_id, name, content_hash, byte_size) VALUES (?,?,?,?)',
                (source_id, name, digest, len(data)),
            )
            if not cur.rowcount:
                row = self.con.execute(
                    'SELECT source_id FROM documents WHERE name=? AND content_hash=?',
                    (name, digest),
                ).fetchone()
                return row['source_id']
            self.con.executemany(
                'INSERT INTO document_chunks(source_id, text) VALUES (?,?)',
                ((source_id, chunk) for chunk in _window(text, 800, 100)),
            )
        return source_id

    def list_documents(self) -> list[dict]:
        rows = self.con.execute(
            'SELECT source_id, name, byte_size FROM documents ORDER BY rowid DESC'
        ).fetchall()
        return [dict(row) for row in rows]

    def delete_document(self, source_id: str) -> None:
        with self.con:
            self.con.execute('DELETE FROM document_chunks WHERE source_id=?', (source_id,))
            self.con.execute('DELETE FROM documents WHERE source_id=?', (source_id,))

    def search_documents(self, query: str, limit: int = 6) -> list[dict]:
        if not query.strip():
            return []
        if type(limit) is not int or not 1 <= limit <= 20:
            raise ValueError('limit must be between 1 and 20')
        # ponytail: bounded local corpora use an O(n) substring scan; switch to
        # SQLite FTS5 if indexing large collections becomes a measured need.
        rows = self.con.execute(
            '''SELECT c.id AS chunk_id, c.source_id, d.name, c.text,
                      1.0 / instr(lower(c.text), lower(?)) AS score
               FROM document_chunks c JOIN documents d ON d.source_id = c.source_id
               WHERE instr(lower(c.text), lower(?)) > 0
               ORDER BY score DESC, c.id LIMIT ?''',
            (query, query, limit),
        ).fetchall()
        return [dict(row) for row in rows]
