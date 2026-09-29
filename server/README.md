# Atlas server

A FastAPI backend that puts one interface over multiple LLM providers —
OpenAI, Anthropic, Gemini, OpenRouter, and any local OpenAI-compatible model
(e.g. Ollama) — each behind a common adapter, plus **the brain**: a persistent
memory core (SQLite + vectors) that stores every turn, recalls relevant
context via semantic search, keeps a rolling summary, and builds an
entity/relation graph, injecting that memory into each prompt automatically.

## Providers

| Provider | Auth | Model select | Notes |
|---|---|---|---|
| **OpenAI** | `OPENAI_API_KEY` | ✅ | official `openai` SDK |
| **Anthropic** | `ANTHROPIC_API_KEY` | ✅ | official `anthropic` SDK |
| **Gemini** | `GEMINI_API_KEY` | ✅ | official `google-genai` SDK |
| **OpenRouter** | `OPENROUTER_API_KEY` | ✅ (any OpenRouter slug) | OpenAI-compatible, routed through OpenRouter |
| **Local** | none by default | ✅ (whatever you've pulled) | any OpenAI-compatible local server; defaults to Ollama at `http://localhost:11434/v1` |

## Setup (Windows PowerShell)

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

> The project uses the `.venv` interpreter. If you install a package, use
> `.venv\Scripts\python -m pip install ...` — installing with a different
> `python` on your PATH (a common trap) puts it in the wrong place.

## Configure `.env`

Copy `.env.example` to `.env` and paste whichever provider keys you have. All
are optional — a provider is simply unavailable if its key is missing.

```dotenv
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
OPENROUTER_API_KEY=
LOCAL_LLM_BASE_URL=http://localhost:11434/v1
LOCAL_LLM_MODEL=llama3.2
```

**Never commit `.env`.** Keys saved later from the desktop app's Profile ->
Advanced settings are written to `credentials.db` instead and take
precedence over `.env` without needing a restart.

## Run the HTTP API

```powershell
$env:ATLAS_API_TOKEN = python -c "import secrets; print(secrets.token_hex(32))"
uvicorn api:app --reload
```

Set `ATLAS_API_TOKEN` to a random 32+ character secret before starting uvicorn. Every route (including `/docs`) requires `Authorization: Bearer <token>`; packaged Electron generates and passes a per-run token automatically. Development desktop and server must inherit the same token. CORS permits only the desktop's file origin (`null`) and local Vite on port 5173; localhost access alone is not authorization.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/providers` | list providers + capabilities + suggested models |
| `GET` | `/settings/providers` | per-provider configured status + local LLM settings |
| `PUT` | `/settings/providers/{provider}` | save an API key, or local LLM `base_url`/`model` |
| `POST` | `/settings/providers/{provider}/test` | send a real one-token prompt to verify the connection |
| `POST` | `/chat` | one-shot, stateless (no context kept) |
| `POST` | `/sessions` | open a stateful, multi-turn session → `session_id` |
| `POST` | `/sessions/{id}/messages` | send a prompt in that session |
| `POST` | `/sessions/{id}/new_chat` | reset the conversation |
| `DELETE` | `/sessions/{id}` | close + drop the session |
| `GET` | `/memory/search?q=&k=` | plain semantic search across all stored memory |
| `POST` | `/memory/search` | graph-aware search: vector hits + 1-hop entity facts |
| `POST` / `GET` | `/documents` | index an explicitly selected UTF-8 .txt/.md file (≤1 MiB), or list indexed sources |
| `GET` | `/documents/search?q=` | local text match with source ID/name, chunk ID, and score |
| `DELETE` | `/documents/{source_id}` | remove index entries only; never deletes the original file |
| `GET` | `/threads/{id}/summary` | a thread's rolling summary |
| `GET` | `/threads/{id}/graph` | a thread's entity/relation graph |

Documents must be chosen explicitly (no URL or folder ingestion). Uploading the same name and content again returns the same source ID; changed content creates a separate source. Search is local text matching with chunk provenance; documents do not enter chat replies yet and require no embedding model download.

```bash
# stateless
curl -X POST localhost:8000/chat \
  -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"openai","prompt":"hello"}'

# stateful
SID=$(curl -s -X POST localhost:8000/sessions \
  -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"provider":"openai"}' | jq -r .session_id)
curl -X POST localhost:8000/sessions/$SID/messages \
  -H "Authorization: Bearer $ATLAS_API_TOKEN" \
  -H 'Content-Type: application/json' -d '{"prompt":"and now?"}'
```

## The brain (persistent memory)

On by default (`BRAIN_ENABLED=1`). Every turn is stored in `brain.db` (SQLite +
`sqlite-vec`), embedded with a local `fastembed` model, recalled by semantic
search, summarized into a rolling summary, and mined into an entity/relation
graph — all injected into the next prompt automatically. First run downloads the
embedding model (~50 MB) once, then works offline.

- **RAG-only mode:** set `BRAIN_AUTO_SUMMARY=0` to skip the LLM summary/graph
  step (no extra provider quota) while keeping vector recall.
- **Off:** `BRAIN_ENABLED=0` reverts to plain adapters.
- **Summarizer provider:** `BRAIN_SUMMARIZER=openai` (needs that provider's key
  configured; degrades to RAG-only if it isn't).
- All `BRAIN_*` knobs are documented in `.env.example`.

Smoke-test it offline (no network/quota):

```powershell
.venv\Scripts\python test_brain.py     # expect BRAIN_OK
```

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the adapter contract, the factory,
and how the brain wraps any adapter.

## Adding a provider

Subclass `BaseAdapter` (`init` / `send` / `close`, plus optional `new_chat`),
then add one branch to `build_adapter` in `factory.py`. The API picks it up
automatically — it only knows the interface, never the provider.
