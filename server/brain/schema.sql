

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
