# Architecture

Atlas is a thin stack over a set of **official-SDK provider adapters**. The
design goal is that nothing above the adapter layer knows or cares which
provider is live — everything talks to one small interface.

```
                     ┌───────────────┐
                     │    api.py     │      presentation layer (FastAPI)
                     └───────┬───────┘
                             ▼
                     ┌──────────────┐
                     │  factory.py  │  build_adapter(...) / build_brain(...)
                     │  (wiring)    │  + PROVIDERS/MODELS + BRAIN_* + .env
                     └──────┬───────┘
                             ▼
                 ┌─────────────────────┐   recall -> send -> persist -> enrich
                 │   Brain (brain/)    │   the persistent memory CORE
                 │  wraps any adapter  │   (RAG + rolling summary + entity graph)
                 └─────────┬───────────┘
                             ▼
                 ┌─────────────────────┐
                 │   BaseAdapter       │   init() / send() / close() / new_chat()
                 │   (adapters/base)   │   -> Reply(text, provider, meta)
                 └─────────┬───────────┘
        ┌─────────┬────────┼────────┬────────────┐
        ▼         ▼        ▼        ▼            ▼
     openai  anthropic  gemini  openrouter     local
```

`Brain` is optional (toggle `BRAIN_ENABLED`) and duck-types the adapter surface,
so `api.py` treats "adapter" and "brain-wrapped adapter" identically — see
**The brain** below.

## The contract (`adapters/base.py`)

Every provider implements the same four methods:

- `async init()` — set up the client. Call once.
- `async send(prompt) -> Reply` — send a turn, return the full reply, keep
  multi-turn context internally.
- `async close()` — release the client.
- `async new_chat()` — optional; drop conversation context.

`Reply` is a normalized dataclass — `text`, `provider`, and an opaque `meta`
(e.g. token usage, stop reason). The `async with adapter as a:` sugar maps to
`init`/`close`.

This is a classic **Adapter pattern**: different SDKs (OpenAI's
`chat.completions`, Anthropic's `messages`, Gemini's `chats`) presented behind
one uniform port.

## Per-provider notes

- **OpenAI** (`openai_adapter.py`) — wraps `AsyncOpenAI`. Multi-turn context is
  a plain in-memory message list, since `chat.completions` is stateless per call.
- **Anthropic** (`anthropic_adapter.py`) — wraps `AsyncAnthropic`, same
  message-list pattern, using the Messages API.
- **Gemini** (`gemini_adapter.py`) — wraps `google-genai`'s `client.aio.chats`,
  which keeps its own multi-turn state server-side.
- **OpenRouter** (`openrouter_adapter.py`) — subclasses the OpenAI adapter,
  pointed at `https://openrouter.ai/api/v1` (OpenRouter is OpenAI-API-compatible).
- **Local** (`local_adapter.py`) — same OpenAI-compatible subclass, pointed at
  a user-configured `base_url`/`model` (default: Ollama at
  `http://localhost:11434/v1`), no API key required.

## The factory (`factory.py`)

The one place that maps `(provider, model)` + configured keys → a constructed
(but not yet `init`-ed) adapter. It owns:
- `PROVIDERS` (order/list), `MODELS` (suggested slugs; callers always allow a
  custom slug).
- `build_adapter(...)` and `AuthMissing` (raised when a required key is absent).

`api.py` depends only on the factory, so a new provider is one new adapter +
one `build_adapter` branch — no API changes.

`build_brain(provider, ...)` wraps a freshly built chat adapter in a `Brain`
backed by process-wide singletons (`get_store()`, `get_embedder()` — one db
handle, one loaded embedding model). All `BRAIN_*` config is read here.

## The brain (`brain/`) — the persistent memory core

The brain is a `BaseAdapter`-shaped orchestrator that wraps any chat adapter and
gives the app long-term memory across every conversation. `Brain.send(prompt)`:

1. **Recall** (`retriever.build_context`): embed the prompt, KNN-search all past
   chunks (`sqlite-vec`), pull the thread's rolling summary, and add 1-hop graph
   facts for entities named in the prompt. Assemble a char-budgeted context block
   and prepend it to the prompt.
2. **Delegate** to `adapter.send(augmented)` — adapters are untouched.
3. **Persist**: store the user + assistant messages (with `Reply.meta`); long
   messages are split (`brain/chunking.py`, LangChain `SemanticChunker` on
   semantic-similarity boundaries, with a hard char-cap fallback to
   sentence-boundary windowing) and each chunk is batch-embedded into
   `vec_chunks`.
4. **Enrich** (best-effort, toggleable): a **separate** summarizer adapter folds
   the turn into the rolling summary and extracts `(subject, relation, object)`
   triples into the entity/edge graph. Failures here never break the chat.

### Storage (`brain/db.py`, `schema.sql`, `store.py`)
A single SQLite file (`brain.db`) with `sqlite-vec` loaded as an extension.
Tables: `threads` (holds `rolling_summary`), `messages`, `chunks`, the
`vec_chunks` virtual table (`float[384]`, cosine), and an `entities`/`edges`
graph. `MemoryStore` is thin SQL — no ORM.

### Embeddings (`brain/embeddings.py`)
`fastembed` (`BAAI/bge-small-en-v1.5`, 384-dim, ONNX — no torch). Vectors are
L2-normalized, so cosine distance ranks correctly.

### Chunking (`brain/chunking.py`)
LangChain's `SemanticChunker` (`langchain-experimental`), driven by the same
fastembed `Embedder` via a small local `Embeddings` adapter — no second
embedding model, no network calls. Any resulting chunk over `BRAIN_CHUNK_CHARS`
is re-windowed with the (retained) sentence-boundary logic so nothing
unbounded reaches `vec_chunks`.

### Summaries + graph (`brain/summarizer.py`)
The only part that spends provider quota. Uses a dedicated adapter
(`BRAIN_SUMMARIZER`, default `openai`), `new_chat()`-ed before each call so its
context never accumulates. If that provider isn't configured, the brain
degrades to **RAG-only** (no summary/graph) rather than failing.

Config (all in `factory.py`, documented in `.env.example`): `BRAIN_ENABLED`,
`BRAIN_DB_PATH`, `BRAIN_EMBED_MODEL`/`DIM`, `BRAIN_SUMMARIZER`,
`BRAIN_AUTO_SUMMARY`, `BRAIN_TOPK`, `BRAIN_CONTEXT_BUDGET`, `BRAIN_CHUNK_CHARS`,
`BRAIN_CHUNK_OVERLAP`, `BRAIN_CHUNK_BREAKPOINT_TYPE`, `BRAIN_CHUNK_BREAKPOINT_AMOUNT`.

## API (`api.py`)

FastAPI over the factory; `_build()` returns a `Brain` (or plain adapter)
transparently. Two chat modes:
- **Stateless** `POST /chat`: build → init → send → close per request. With the
  brain on, the turn is still stored and recalled against global memory.
- **Stateful sessions:** `POST /sessions` builds + inits a handle and stores it in
  an in-memory registry (`SESSIONS: id -> (handle, lock)`); messages run under a
  **per-session `asyncio.Lock`**. Returns the brain `thread_id`. `DELETE` closes
  it; app shutdown closes all.

Plus:
- **Settings:** `GET/PUT /settings/providers[/{provider}]` read/write API keys
  and local-LLM `base_url`/`model` via `credentials_store.py`;
  `POST /settings/providers/{provider}/test` builds the real adapter and sends
  a one-token prompt to verify the connection.
- **Memory inspection:** `GET /memory/search?q=` (plain vector),
  `POST /memory/search` (graph-aware), `GET /threads/{id}/summary`,
  `GET /threads/{id}/graph`.

Errors map cleanly: `AuthMissing` → `400`, unknown provider → `404`,
provider/network failure → `502`.

## Key storage (`credentials_store.py`)

A small SQLite key/value store. `.env` seeds the first value for each key;
anything saved later via `PUT /settings/providers/{provider}` (from the
desktop app's Advanced settings) is written here instead, and reads prefer
this store — so a saved key takes effect immediately, without touching `.env`
or restarting the server.

## Known limitations

- **API *live-session* registry is in-memory** and single-process — the durable
  memory (conversations, vectors, graph) lives in `brain.db`, but the map of
  currently-open adapter sessions is not; it's lost on restart, and there's no
  auth. Fine for local use; a hosted deployment needs shared state + access
  control.
- **Brain memory is single-file SQLite** — great locally, but not concurrent
  multi-writer. For scale, swap the store for Postgres + pgvector (the
  `MemoryStore` SQL is the only thing that changes).
- **Graph is lightweight**, not full GraphRAG: single-pass triple extraction, no
  community detection or hierarchical/global summaries. Summarization + extraction
  cost provider quota and latency per turn (disable with `BRAIN_AUTO_SUMMARY=0`).
- **Windows + fastembed:** the HuggingFace cache may warn about symlink privilege
  (`WinError 1314`) on first model download; it falls back to copy and works.
  Enable Developer Mode (or run once as admin) to silence it.
