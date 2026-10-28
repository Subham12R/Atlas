"""Explicitly selected documents (.pdf text, .txt, .md); separate from chat memory.

Each document is split into page-aware chunks, indexed for keyword (BM25) and
vector search, and linked into an entity graph. `retrieve` fuses those three
signals for chat answers, which cite the chunks as [D1], [D2], ...
"""

from __future__ import annotations

import hashlib
import re
import struct
import uuid

from .chunking import chunk_pages
from .graph import graph_chunks, link_chunk, unlink_chunks
from .hybrid import fts_query, query_terms, rrf

MAX_DOCUMENT_BYTES = 1024 * 1024


def _pack(vec: list[float]) -> bytes:
    return struct.pack("%df" % len(vec), *vec)


class Documents:
    def __init__(self, con):
        self.con = con

    def ingest_document(self, name: str, text: str) -> str:
        try:
            name_bytes = name.encode('utf-8', errors='strict')
        except UnicodeError as exc:
            raise ValueError('Select a .pdf, .txt or .md file with a valid name') from exc
        if (not name or name != name.strip() or '/' in name or '\\' in name
                or '\x00' in name or len(name_bytes) > 255
                or not name.lower().endswith(('.txt', '.md', '.pdf'))):
            raise ValueError('Select a .pdf, .txt or .md file with a valid name')
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
            # Vectors are added by the embedding backfill, off the request path.
            for chunk, page in chunk_pages(text):
                cur = self.con.execute(
                    'INSERT INTO document_chunks(source_id, text, page) VALUES (?,?,?)',
                    (source_id, chunk, page))
                link_chunk(self.con, cur.lastrowid, chunk)
        return source_id

    def list_documents(self) -> list[dict]:
        rows = self.con.execute(
            '''SELECT d.source_id, d.name, d.byte_size,
                      (SELECT count(*) FROM document_chunks c WHERE c.source_id = d.source_id) AS chunks,
                      (SELECT count(*) FROM document_chunks c JOIN vec_doc_chunks v ON v.rowid = c.id
                       WHERE c.source_id = d.source_id) AS embedded
               FROM documents d ORDER BY d.rowid DESC'''
        ).fetchall()
        return [dict(row) for row in rows]

    def delete_document(self, source_id: str) -> None:
        with self.con:
            ids = [r[0] for r in self.con.execute(
                'SELECT id FROM document_chunks WHERE source_id=?', (source_id,))]
            unlink_chunks(self.con, ids)
            self.con.execute('DELETE FROM vec_doc_chunks WHERE rowid IN '
                             '(SELECT id FROM document_chunks WHERE source_id=?)', (source_id,))
            self.con.execute('DELETE FROM document_chunks WHERE source_id=?', (source_id,))
            self.con.execute('DELETE FROM documents WHERE source_id=?', (source_id,))

    def search_documents(self, query: str, limit: int = 6) -> list[dict]:
        """Library keyword search: every word must appear (any order); exact phrases rank first."""
        if not query.strip():
            return []
        if type(limit) is not int or not 1 <= limit <= 20:
            raise ValueError('limit must be between 1 and 20')
        phrase = ' '.join(query.lower().split())
        terms = list(dict.fromkeys(re.findall(r'\w+', phrase))) or [phrase]
        # SQLite's lower() only folds ASCII, so it prefilters on ASCII words and
        # Python makes the final, Unicode-aware decision.
        ascii_terms = [term for term in terms if term.isascii()]
        where = ' AND '.join('instr(lower(c.text), ?) > 0' for _ in ascii_terms) or '1'
        # ponytail: bounded local corpora use an O(n) substring scan for exact-word
        # matching; ranked retrieval for chat uses the FTS5 index in `retrieve`.
        rows = self.con.execute(
            f'''SELECT c.id AS chunk_id, c.source_id, d.name, c.text, c.page
                FROM document_chunks c JOIN documents d ON d.source_id = c.source_id
                WHERE {where}''',
            ascii_terms,
        ).fetchall()
        hits = []
        for row in rows:
            text = ' '.join(row['text'].lower().split())
            if all(term in text for term in terms):
                hits.append({**dict(row), 'score': 1.0 if phrase in text else 0.8})
        hits.sort(key=lambda hit: (-hit['score'], hit['chunk_id']))
        return hits[:limit]

    def retrieve(self, query: str, query_vec: list[float] | None, k: int = 4,
                 max_distance: float | None = None, entity_distance: float = 0.3) -> list[dict]:
        """Passages for a chat answer: vector + BM25 + entity-graph candidates, rank-fused.

        A passage must earn its place: close in meaning (within `max_distance`), or
        containing most of the question's content words, or reached through an entity
        the question names. Fusion then orders whatever qualifies.
        """
        if not self.con.execute('SELECT 1 FROM document_chunks LIMIT 1').fetchone():
            return []
        pool = max(k * 4, 16)
        dense: list[int] = []
        if query_vec is not None:
            dense = [r['cid'] for r in self.con.execute(
                'SELECT rowid AS cid, distance FROM vec_doc_chunks WHERE embedding MATCH ? '
                'ORDER BY distance LIMIT ?', (_pack(query_vec), pool))
                if max_distance is None or r['distance'] <= max_distance]
        keyword: list[int] = []
        match = fts_query(query)
        terms = query_terms(query)
        # One stray shared word is not relevance: short questions need all their content
        # words, longer ones at least 60% of them.
        needed = len(terms) if len(terms) <= 3 else -(-len(terms) * 3 // 5)
        if match:
            for row in self.con.execute(
                    'SELECT rowid AS cid, text FROM document_chunks_fts WHERE document_chunks_fts MATCH ? '
                    'ORDER BY bm25(document_chunks_fts) LIMIT ?', (match, pool)):
                lowered = row['text'].lower()
                if sum(1 for term in terms if re.search(rf'(?<!\w){re.escape(term)}', lowered)) >= needed:
                    keyword.append(row['cid'])
        graph = graph_chunks(self.con, query, query_vec, _pack, pool, entity_distance)
        fused = rrf(dense, keyword, graph)[:k]
        if not fused:
            return []
        marks = ','.join('?' * len(fused))
        rows = {r['id']: r for r in self.con.execute(
            f'''SELECT c.id, c.source_id, c.text, c.page, d.name FROM document_chunks c
                JOIN documents d ON d.source_id = c.source_id WHERE c.id IN ({marks})''', fused)}
        out = []
        for chunk_id in fused:
            row = rows.get(chunk_id)
            if row is None:
                continue
            out.append({'chunk_id': chunk_id, 'source_id': row['source_id'], 'name': row['name'],
                        'page': row['page'], 'text': row['text'],
                        'via': [label for label, ids in (('meaning', dense), ('keywords', keyword),
                                                         ('graph', graph)) if chunk_id in ids]})
        return out
