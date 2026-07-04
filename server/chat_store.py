"""
SQLite store for local chat history and messages.
"""
from __future__ import annotations

import json
import os
import sqlite3

_DB_PATH = os.getenv("CHATS_DB_PATH", "chats.db").strip()
_conn: sqlite3.Connection | None = None


def _connect() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        _conn = sqlite3.connect(_DB_PATH, check_same_thread=False)
        _conn.execute("PRAGMA foreign_keys = ON;")
        
        _conn.execute(
            "CREATE TABLE IF NOT EXISTS chats ("
            "  id TEXT PRIMARY KEY,"
            "  title TEXT NOT NULL,"
            "  is_pinned INTEGER DEFAULT 0,"
            "  timestamp TEXT NOT NULL,"
            "  provider TEXT,"
            "  session_id TEXT,"
            "  thread_id TEXT"
            ")"
        )
        
        _conn.execute(
            "CREATE TABLE IF NOT EXISTS messages ("
            "  id TEXT PRIMARY KEY,"
            "  chat_id TEXT NOT NULL,"
            "  sender TEXT NOT NULL,"
            "  content TEXT NOT NULL,"
            "  timestamp TEXT NOT NULL,"
            "  provider TEXT,"
            "  latency_ms INTEGER,"
            "  is_new INTEGER DEFAULT 0,"
            "  tool TEXT,"
            "  sources TEXT,"
            "  attachments TEXT,"
            "  FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE"
            ")"
        )
        _conn.commit()
    return _conn


def get_chats() -> list[dict]:
    conn = _connect()
    cursor = conn.cursor()
    cursor.execute(
        "SELECT id, title, is_pinned, timestamp, provider, session_id, thread_id "
        "FROM chats ORDER BY is_pinned DESC, id DESC"
    )
    chats = []
    for row in cursor.fetchall():
        chat_id = row[0]
        msg_cursor = conn.cursor()
        msg_cursor.execute(
            "SELECT id, sender, content, timestamp, provider, latency_ms, is_new, tool, sources, attachments "
            "FROM messages WHERE chat_id = ? ORDER BY rowid ASC", (chat_id,)
        )
        messages = []
        for m_row in msg_cursor.fetchall():
            sources = None
            if m_row[8]:
                try:
                    sources = json.loads(m_row[8])
                except Exception:
                    pass
            attachments = None
            if m_row[9]:
                try:
                    attachments = json.loads(m_row[9])
                except Exception:
                    pass
            
            messages.append({
                "id": m_row[0],
                "sender": m_row[1],
                "content": m_row[2],
                "timestamp": m_row[3],
                "provider": m_row[4],
                "latencyMs": m_row[5],
                "isNew": bool(m_row[6]),
                "tool": m_row[7],
                "sources": sources,
                "attachments": attachments
            })
            
        chats.append({
            "id": row[0],
            "title": row[1],
            "isPinned": bool(row[2]),
            "timestamp": row[3],
            "provider": row[4],
            "sessionId": row[5],
            "threadId": row[6],
            "messages": messages
        })
    return chats


def save_chats(chats_data: list[dict]) -> None:
    conn = _connect()
    conn.execute("DELETE FROM chats")
    
    for c in chats_data:
        conn.execute(
            "INSERT INTO chats (id, title, is_pinned, timestamp, provider, session_id, thread_id) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                c["id"],
                c["title"],
                1 if c.get("isPinned") else 0,
                c["timestamp"],
                c.get("provider"),
                c.get("sessionId"),
                c.get("threadId")
            )
        )
        
        for m in c.get("messages", []):
            sources_json = json.dumps(m.get("sources")) if m.get("sources") is not None else None
            attachments_json = json.dumps(m.get("attachments")) if m.get("attachments") is not None else None
            
            conn.execute(
                "INSERT INTO messages (id, chat_id, sender, content, timestamp, provider, latency_ms, is_new, tool, sources, attachments) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    m["id"],
                    c["id"],
                    m["sender"],
                    m["content"],
                    m["timestamp"],
                    m.get("provider"),
                    m.get("latencyMs"),
                    1 if m.get("isNew") else 0,
                    m.get("tool"),
                    sources_json,
                    attachments_json
                )
            )
    conn.commit()


def clear_all() -> None:
    conn = _connect()
    conn.execute("DELETE FROM chats")
    conn.commit()
