

CREATE TABLE IF NOT EXISTS threads (
    id              TEXT PRIMARY KEY,
    provider        TEXT,
    title           TEXT DEFAULT '',
    rolling_summary TEXT DEFAULT '',
    meta            TEXT,                       
    created_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id  TEXT NOT NULL REFERENCES threads(id),
    role       TEXT NOT NULL,                   
    content    TEXT NOT NULL,
    provider   TEXT,
    meta       TEXT,                            
    created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);


CREATE TABLE IF NOT EXISTS chunks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message_id INTEGER NOT NULL REFERENCES messages(id),
    thread_id  TEXT NOT NULL,
    text       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_thread ON chunks(thread_id);

CREATE TABLE IF NOT EXISTS documents (
    source_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    UNIQUE(name, content_hash)
);
CREATE TABLE IF NOT EXISTS document_chunks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL REFERENCES documents(source_id),
    text TEXT NOT NULL,
    page INTEGER                                   -- PDF page the chunk starts on
);
CREATE INDEX IF NOT EXISTS idx_document_chunks_source ON document_chunks(source_id);

-- Document entity graph: proper nouns and acronyms, the chunks that mention
-- them, and how often two entities appear in the same chunk.
CREATE TABLE IF NOT EXISTS doc_entities (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL UNIQUE COLLATE NOCASE,
    mentions INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS doc_entity_chunks (
    entity_id INTEGER NOT NULL REFERENCES doc_entities(id),
    chunk_id  INTEGER NOT NULL REFERENCES document_chunks(id),
    PRIMARY KEY (entity_id, chunk_id)
);
CREATE INDEX IF NOT EXISTS idx_doc_entity_chunks_chunk ON doc_entity_chunks(chunk_id);
CREATE TABLE IF NOT EXISTS doc_entity_edges (
    a_id   INTEGER NOT NULL REFERENCES doc_entities(id),
    b_id   INTEGER NOT NULL REFERENCES doc_entities(id),
    weight INTEGER DEFAULT 1,
    PRIMARY KEY (a_id, b_id)
);

-- Keyword (BM25) indexes over the same chunks, kept in sync by triggers.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
    text, content='chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS chunks_fts_ai AFTER INSERT ON chunks BEGIN
    INSERT INTO chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS chunks_fts_ad AFTER DELETE ON chunks BEGIN
    INSERT INTO chunks_fts(chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;
CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
    text, content='document_chunks', content_rowid='id', tokenize='unicode61 remove_diacritics 2');
CREATE TRIGGER IF NOT EXISTS document_chunks_fts_ai AFTER INSERT ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(rowid, text) VALUES (new.id, new.text);
END;
CREATE TRIGGER IF NOT EXISTS document_chunks_fts_ad AFTER DELETE ON document_chunks BEGIN
    INSERT INTO document_chunks_fts(document_chunks_fts, rowid, text) VALUES ('delete', old.id, old.text);
END;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entities (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    type       TEXT DEFAULT '',
    thread_id  TEXT NOT NULL,
    mentions   INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(name, type, thread_id)
);

CREATE TABLE IF NOT EXISTS edges (
    src_entity_id INTEGER NOT NULL REFERENCES entities(id),
    dst_entity_id INTEGER NOT NULL REFERENCES entities(id),
    relation      TEXT NOT NULL,
    thread_id     TEXT NOT NULL,
    weight        INTEGER DEFAULT 1,
    created_at    TEXT DEFAULT (datetime('now')),
    PRIMARY KEY (src_entity_id, dst_entity_id, relation)
);
