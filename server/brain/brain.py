from __future__ import annotations

import os
import time
import uuid

from .chunking import chunk_text
from .retriever import build_context

DEBUG = bool(os.getenv("SB_DEBUG", "").strip())


class Brain:
    def __init__(self, adapter, store, embedder, thread_id: str, provider: str,
                 summarizer=None, auto_summary: bool = True,
                 topk: int = 6, budget: int = 2000,
                 chunk_chars: int = 800, chunk_overlap: int = 100,
                 chunk_breakpoint_type: str = "percentile",
                 chunk_breakpoint_amount: float | None = None,
                 max_distance: float | None = 0.6):
        self.adapter = adapter
        self.store = store
        self.embedder = embedder
        self.thread_id = thread_id
        self.provider = provider
        self.summarizer = summarizer
        self.auto_summary = auto_summary and summarizer is not None
        self.topk = topk
        self.budget = budget
        self.chunk_chars = chunk_chars
        self.chunk_overlap = chunk_overlap
        self.chunk_breakpoint_type = chunk_breakpoint_type
        self.chunk_breakpoint_amount = chunk_breakpoint_amount
        self.max_distance = max_distance
        self.name = adapter.name
        store.create_thread(thread_id, provider)

    async def init(self) -> None:
        await self.adapter.init()
        if self.summarizer is not None:
            try:
                await self.summarizer.adapter.init()
            except Exception as e:  # noqa: BLE001
                # Summarizer is best-effort (see _enrich) -- a broken summarizer
                # provider (e.g. stale Gemini cookies) must not break the actual
                # chat provider the user picked. Degrade to RAG-only.
                if DEBUG:
                    print(f"[brain] summarizer init failed, degrading to RAG-only: {e}")
                self.summarizer = None
                self.auto_summary = False

    async def send(self, prompt: str, images=None):
        # ---- recall ------------------------------------------------------
        context = build_context(self.store, self.embedder, prompt,
                                self.thread_id, self.topk, self.budget,
                                self.max_distance)
        augmented = f"{context}\n\n{prompt}" if context else prompt
        if DEBUG and context:
            print(f"[brain] injected {len(context)} chars of context")

        # ---- delegate ------------------------------------------------------
        # Images never touch chunk_text/the embedder below -- only the plain
        # text prompt/reply are chunked and stored, so recall never has to
        # deal with (or accidentally embed) raw image bytes.
        reply = await self.adapter.send(augmented, images)

        # ---- persist (original prompt, not the augmented one) ------------
        self._store_turn("user", prompt)
        self._store_turn("assistant", reply.text, meta=reply.meta)

        # ---- enrich (best-effort; never break the chat) ------------------
        if self.auto_summary:
            await self._enrich(prompt, reply.text)
        return reply

    async def send_stream(self, prompt: str, images=None):
        # ---- recall ------------------------------------------------------
        t0 = time.monotonic()
        context = build_context(self.store, self.embedder, prompt,
                                self.thread_id, self.topk, self.budget,
                                self.max_distance)
        if DEBUG:
            print(f"[brain] recall took {time.monotonic() - t0:.2f}s"
                  f"{f' ({len(context)} chars)' if context else ''}")
        augmented = f"{context}\n\n{prompt}" if context else prompt

        # ---- delegate ------------------------------------------------------
        text_chunks = []
        t1 = time.monotonic()
        first_chunk = True
        async for chunk in self.adapter.send_stream(augmented, images):
            if DEBUG and first_chunk:
                print(f"[brain] time to first token: {time.monotonic() - t1:.2f}s")
                first_chunk = False
            text_chunks.append(chunk)
            yield chunk

        full_text = "".join(text_chunks)

        # ---- persist (original prompt, not the augmented one) ------------
        self._store_turn("user", prompt)
        self._store_turn("assistant", full_text)

        # ---- enrich (best-effort; never break the chat) ------------------
        if self.auto_summary:
            await self._enrich(prompt, full_text)

    def _store_turn(self, role: str, content: str, meta: dict | None = None) -> None:
        """Chunk long messages, batch-embed the chunks, and persist them."""
        texts = chunk_text(content, self.embedder, self.chunk_chars, self.chunk_overlap,
                           self.chunk_breakpoint_type, self.chunk_breakpoint_amount)
        vecs = self.embedder.embed(texts) if texts else []
        self.store.add_message(self.thread_id, role, content, self.provider,
                               meta=meta, chunks=list(zip(texts, vecs)))

    async def _enrich(self, user: str, assistant: str) -> None:
        try:
            summary = await self.summarizer.update_summary(
                self.store.get_summary(self.thread_id), user, assistant)
            self.store.set_summary(self.thread_id, summary)
            for s, r, d in await self.summarizer.extract_triples(user, assistant):
                sid = self.store.upsert_entity(s, "", self.thread_id)
                did = self.store.upsert_entity(d, "", self.thread_id)
                self.store.add_edge(sid, did, r, self.thread_id)
        except Exception as e:  # noqa: BLE001
            if DEBUG:
                print(f"[brain] enrich failed (kept chat alive): {e}")

    async def new_thread(self) -> None:
        await self.adapter.new_chat()
        self.thread_id = uuid.uuid4().hex
        self.store.create_thread(self.thread_id, self.provider)

    # BaseAdapter-compatible alias so `/new` in the CLI works unchanged.
    async def new_chat(self) -> None:
        await self.new_thread()

    async def close(self) -> None:
        await self.adapter.close()
        if self.summarizer is not None:
            try:
                await self.summarizer.adapter.close()
            except Exception:
                pass
