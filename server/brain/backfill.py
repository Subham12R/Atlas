"""Embeds stored text that has no vector yet.

That covers documents indexed while the model was still downloading, chat turns
stored before it loaded, new graph entities, and everything after the embedding
model changes (the vector tables are rebuilt empty). Database work stays on the
event loop thread, which owns the shared connection; only the model runs in a
worker thread.
"""
from __future__ import annotations

import asyncio

# Documents first: a user who just indexed a file is waiting to ask about it.
TABLES = ("vec_doc_chunks", "vec_chunks", "vec_doc_entities", "vec_entities")


async def backfill_once(store, model, batch: int = 32) -> int:
    """Embed one batch from the first table with pending rows; returns rows embedded."""
    for table in TABLES:
        rows = store.pending_embeddings(table, batch)
        if rows:
            vectors = await asyncio.to_thread(
                model.embed, [text for _, text, _ in rows], [title for _, _, title in rows])
            store.store_embeddings(table, [(row_id, vec) for (row_id, _, _), vec in zip(rows, vectors)])
            return len(rows)
    return 0


async def backfill_forever(get_store, get_model, wake: asyncio.Event, idle: float = 5.0) -> None:
    while True:
        model = get_model()
        done = await backfill_once(get_store(), model) if model is not None else 0
        if done:
            await asyncio.sleep(0)  # let requests run between batches
            continue
        wake.clear()
        try:
            await asyncio.wait_for(wake.wait(), idle)
        except asyncio.TimeoutError:
            pass
