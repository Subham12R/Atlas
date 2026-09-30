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
            except Exception as e:
                if DEBUG:
                    print(f"[brain] summarizer init failed, degrading to RAG-only: {e}")
                self.summarizer = None
                self.auto_summary = False

    def prepare_agent_turn(self, prompt: str):
        """Recall once from the real question; planner/tool messages are not user turns."""
        return build_context(self.store, self.embedder, prompt,
                             self.thread_id, self.topk, self.budget, self.max_distance)

    async def finish_agent_turn(self, prompt: str, final_text: str, recall,
                                safe_metadata: dict | None = None, web_sourced: bool = False):
        self._store_turn("user", self._memory_text(prompt))
        self._store_turn("assistant", final_text, meta=safe_metadata)
        if self.auto_summary:
            await self._enrich(prompt, final_text, facts=not web_sourced)

    async def send(self, prompt: str, images=None):
        context, recall = self.prepare_agent_turn(prompt)
        augmented = f"{context}\n\n{prompt}" if context else prompt
        if DEBUG and context:
            print(f"[brain] injected {len(context)} chars of context")
        reply = await self.adapter.send(augmented, images)
        await self.finish_agent_turn(prompt, reply.text, recall, reply.meta)
        reply.meta = {**reply.meta, "memory": recall}
        return reply

    async def send_stream(self, prompt: str, images=None):
        t0 = time.monotonic()
        context, recall = self.prepare_agent_turn(prompt)
        if DEBUG:
            print(f"[brain] recall took {time.monotonic() - t0:.2f}s"
                  f"{f' ({len(context)} chars)' if context else ''}")
        augmented = f"{context}\n\n{prompt}" if context else prompt

        text_chunks = []
        t1 = time.monotonic()
        first_chunk = True
        async for chunk in self.adapter.send_stream(augmented, images):
            if DEBUG and first_chunk:
                print(f"[brain] time to first token: {time.monotonic() - t1:.2f}s")
                first_chunk = False
            if isinstance(chunk, dict):  # e.g. {'thinking': ...}: shown, never stored as the reply
                yield chunk
                continue
            text_chunks.append(chunk)
            yield chunk

        full_text = "".join(text_chunks)

        await self.finish_agent_turn(prompt, full_text, recall)
        yield {"memory": recall}

    @staticmethod
    def _memory_text(prompt: str) -> str:
        """Exclude client-injected wrappers so retrieval represents the user intent."""
        for marker in (
            "[System Instruction - Personalization Settings]",
            "[System Instruction - Formatting]",
            "[Web search results]",
            "[Recent conversation before switching model]",
        ):
            if marker in prompt:
                prompt = prompt.split(marker, 1)[-1]
        return prompt.strip()

    def _store_turn(self, role: str, content: str, meta: dict | None = None) -> None:
        """Chunk long messages, batch-embed the chunks, and persist them."""
        texts = chunk_text(content, self.embedder, self.chunk_chars, self.chunk_overlap,
                           self.chunk_breakpoint_type, self.chunk_breakpoint_amount)
        vecs = self.embedder.embed(texts) if texts else []
        self.store.add_message(self.thread_id, role, content, self.provider,
                               meta=meta, chunks=list(zip(texts, vecs)))

    async def _enrich(self, user: str, assistant: str, facts: bool = True) -> None:
        # Facts from web answers are unverified (namesakes get merged); keep the summary only.
        try:
            summary = await self.summarizer.update_summary(
                self.store.get_summary(self.thread_id), user, assistant)
            self.store.set_summary(self.thread_id, summary)
            for s, r, d in (await self.summarizer.extract_triples(user, assistant) if facts else []):
                sid = self.store.upsert_entity(s, "", self.thread_id)
                did = self.store.upsert_entity(d, "", self.thread_id)
                self.store.add_edge(sid, did, r, self.thread_id)
        except Exception as e:
            if DEBUG:
                print(f"[brain] enrich failed (kept chat alive): {e}")

    async def new_thread(self) -> None:
        await self.adapter.new_chat()
        self.thread_id = uuid.uuid4().hex
        self.store.create_thread(self.thread_id, self.provider)

    async def new_chat(self) -> None:
        await self.new_thread()

    async def close(self) -> None:
        await self.adapter.close()
        if self.summarizer is not None:
            try:
                await self.summarizer.adapter.close()
            except Exception:
                pass
