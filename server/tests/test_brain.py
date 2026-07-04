"""
Brain smoke test -- no network. Uses a fake adapter so it exercises the full
orchestrator (recall -> send -> persist -> summarize -> graph) offline.

Run:  .venv\\Scripts\\python test_brain.py
"""
import asyncio

from adapters.base import BaseAdapter, Reply
from brain import Brain, Embedder, MemoryStore, Summarizer
from brain.db import connect


class FakeAdapter(BaseAdapter):
    """Echoes what it was asked, and answers the summary/triple prompts so the
    Summarizer path runs without a real provider."""
    name = "fake"

    def __init__(self):
        self.last_prompt = ""

    async def init(self):
        pass

    async def send(self, prompt: str, images=None) -> Reply:
        self.last_prompt = prompt
        if "running summary" in prompt:
            return Reply("User's project deadline is BAH 2026.", self.name)
        if "triples" in prompt:
            return Reply('[["project","has deadline","BAH 2026"]]', self.name)
        return Reply(f"echo: {prompt[-40:]}", self.name)

    async def send_stream(self, prompt: str, images=None):
        reply = await self.send(prompt, images)
        yield reply.text

    async def new_chat(self):
        pass

    async def close(self):
        pass


async def main():
    store = MemoryStore(connect(":memory:", 384))
    embedder = Embedder("BAAI/bge-small-en-v1.5", 384)
    chat = FakeAdapter()
    brain = Brain(chat, store, embedder, "t1", "fake",
                  summarizer=Summarizer(FakeAdapter()), auto_summary=True)
    await brain.init()

    await brain.send("My project deadline is BAH 2026.")

    await brain.send("when is my deadline?")
    injected = "BAH 2026" in chat.last_prompt
    print("recall injected prior fact into prompt:", injected)

    n_msgs = store.con.execute("SELECT count(*) c FROM messages").fetchone()["c"]
    summary = store.get_summary("t1")
    graph = store.graph("t1")
    print("messages stored:", n_msgs)
    print("rolling summary:", repr(summary))
    print("graph nodes/edges:", len(graph["nodes"]), "/", len(graph["edges"]))

    from brain.chunking import chunk_text
    long_text = ("Section one about apples. " * 40) + ("Section two about zebras. " * 40)
    pieces = chunk_text(long_text, embedder, 800, 100)
    brain._store_turn("assistant", long_text)
    n_chunks = store.con.execute(
        "SELECT count(*) c FROM chunks WHERE message_id = "
        "(SELECT max(id) FROM messages)").fetchone()["c"]
    print(f"long message -> {len(pieces)} chunks planned, {n_chunks} stored")

    ok = (injected and n_msgs == 4 and summary
          and len(graph["edges"]) >= 1 and n_chunks > 1)
    print("BRAIN_OK" if ok else "BRAIN_FAIL")
    await brain.close()


if __name__ == "__main__":
    asyncio.run(main())
