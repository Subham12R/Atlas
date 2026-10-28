from __future__ import annotations

import asyncio
import os
import re
import time
import uuid

from .chunking import chunk_text
from .documents import Documents
from .retriever import build_context

DEBUG = bool(os.getenv("SB_DEBUG", "").strip())

# Client-injected instruction blocks and the text that ends each one. Only the
# user's own words after a block are memory; the block body is not.
_WRAPPER_BLOCKS = (
    ("[System Instruction - Personalization Settings]", "\n---\n\n"),
    ("[System Instruction - Formatting]", "\n\n"),
)
# Older wrappers had no terminator; everything before their marker is dropped.
_LEGACY_MARKERS = ("[Web search results]", "[Recent conversation before switching model]")
# The desktop app appends attached files as "File: <name>\n```\n<content>\n```" blocks.
# Memory keeps the names, not the bodies: a 1 MB file is not something the user said,
# and embedding it would stall every request on the server.
_ATTACHED_FILE = re.compile(r"(?:^|\n\n)File: ([^\n]+)\n```\n")
# Longer replies are still stored in full; only this much is chunked for recall.
MAX_RECALL_CHARS = 20_000


class Brain:
    def __init__(self, adapter, store, embedder, thread_id: str, provider: str,
                 summarizer=None, auto_summary: bool = True,
                 topk: int = 6, budget: int = 2000,
                 chunk_chars: int = 1000, chunk_overlap: int = 150,
                 max_distance: float | None = 0.6, documents: bool = False,
                 doc_k: int = 4, doc_budget: int = 6000,
                 doc_max_distance: float | None = None, entity_distance: float = 0.3):
        self.adapter = adapter
        self.store = store
        # An embedding model, or a handle whose .get() returns one once it has loaded.
        self.embedder = embedder
        self.thread_id = thread_id
        self.provider = provider
        self.summarizer = summarizer
        self.auto_summary = auto_summary and summarizer is not None
        self.topk = topk
        self.budget = budget
        self.chunk_chars = chunk_chars
        self.chunk_overlap = chunk_overlap
        self.max_distance = max_distance
        # Indexed documents join recall (cited as [D1]...) when enabled.
        self.documents = Documents(store.con) if documents else None
        self.doc_k = doc_k
        self.doc_budget = doc_budget
        self.doc_max_distance = doc_max_distance
        self.entity_distance = entity_distance
        self.name = adapter.name
        # Summary/graph enrichment runs after the reply is delivered, one at a time.
        self._enrichment: asyncio.Task | None = None
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
        # Query with the user's words: instruction blocks and file bodies would otherwise
        # dominate the embedding (and push the question past the model's token limit).
        return build_context(self.store, self._model(), self._memory_text(prompt) or prompt,
                             self.thread_id, self.topk, self.budget, self.max_distance,
                             documents=self.documents, doc_k=self.doc_k, doc_budget=self.doc_budget,
                             doc_max_distance=self.doc_max_distance,
                             entity_distance=self.entity_distance)

    def _model(self):
        """The embedding model, or None while it is still loading (recall is keyword-only then)."""
        if hasattr(self.embedder, "embed_one"):
            return self.embedder
        get = getattr(self.embedder, "get", None)
        return get() if callable(get) else None

    async def finish_agent_turn(self, prompt: str, final_text: str, recall,
                                safe_metadata: dict | None = None, web_sourced: bool = False):
        await self._persist_turn("user", self._memory_text(prompt))
        # Web answers cite source ids that only exist in their own run; recalling them later
        # confuses the model (old [S1] vs new [S1]) and can resurrect wrong merged people.
        await self._persist_turn("assistant", final_text, meta=safe_metadata,
                                 recallable=not web_sourced)
        if self.auto_summary:
            # Two extra model calls; never hold the finished reply open for them.
            self._schedule_enrich(self._memory_text(prompt), final_text, facts=not web_sourced)

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
        for marker, end in _WRAPPER_BLOCKS:
            start = prompt.find(marker)
            if start != -1:
                stop = prompt.find(end, start + len(marker))
                prompt = prompt[:start] + (prompt[stop + len(end):] if stop != -1 else "")
        for marker in _LEGACY_MARKERS:
            if marker in prompt:
                prompt = prompt.split(marker, 1)[-1]
        files = _ATTACHED_FILE.search(prompt)
        if files:
            names = _ATTACHED_FILE.findall(prompt[files.start():])
            prompt = f"{prompt[:files.start()]}\n\n[Attached: {', '.join(names)}]"
        return prompt.strip()

    def _chunk_and_embed(self, content: str) -> list[tuple]:
        """CPU-bound. Without a loaded model, chunks are stored unembedded; the backfill
        embeds them later, and keyword recall covers them meanwhile."""
        texts = chunk_text(content[:MAX_RECALL_CHARS], self.chunk_chars, self.chunk_overlap)
        model = self._model()
        vectors = model.embed(texts) if texts and model is not None else [None] * len(texts)
        return list(zip(texts, vectors))

    def _store_turn(self, role: str, content: str, meta: dict | None = None,
                    recallable: bool = True) -> None:
        """Chunk long messages, batch-embed the chunks, and persist them."""
        chunks = self._chunk_and_embed(content) if recallable else []
        self.store.add_message(self.thread_id, role, content, self.provider,
                               meta=meta, chunks=chunks)

    async def _persist_turn(self, role: str, content: str, meta: dict | None = None,
                            recallable: bool = True) -> None:
        """Like _store_turn, but embeds off the event loop so other chats keep streaming.
        The database write stays on the loop thread, which owns the shared connection."""
        thread_id = self.thread_id
        chunks = await asyncio.to_thread(self._chunk_and_embed, content) if recallable else []
        self.store.add_message(thread_id, role, content, self.provider, meta=meta, chunks=chunks)

    def _schedule_enrich(self, user: str, assistant: str, facts: bool) -> None:
        # Bind the thread now: the chat may switch threads before this runs.
        thread_id, previous = self.thread_id, self._enrichment

        async def run() -> None:
            if previous is not None:
                await asyncio.wait([previous])  # keep summaries in turn order
            await self._enrich(thread_id, user, assistant, facts)

        self._enrichment = asyncio.create_task(run())

    async def flush(self) -> None:
        """Wait for pending enrichment (tests and callers that read summaries)."""
        if self._enrichment is not None:
            await asyncio.wait([self._enrichment])

    async def _enrich(self, thread_id: str, user: str, assistant: str, facts: bool = True) -> None:
        # Facts from web answers are unverified (namesakes get merged); keep the summary only.
        try:
            summary = await self.summarizer.update_summary(
                self.store.get_summary(thread_id), user, assistant)
            self.store.set_summary(thread_id, summary)
            for s, r, d in (await self.summarizer.extract_triples(user, assistant) if facts else []):
                sid = self.store.upsert_entity(s, "", thread_id)
                did = self.store.upsert_entity(d, "", thread_id)
                self.store.add_edge(sid, did, r, thread_id)
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
        # A summary still in flight is not worth holding the session open for.
        if self._enrichment is not None and not self._enrichment.done():
            self._enrichment.cancel()
        await self.adapter.close()
        if self.summarizer is not None:
            try:
                await self.summarizer.adapter.close()
            except Exception:
                pass
