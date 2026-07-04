# Frontend ↔ Backend guide

Everything a frontend needs to talk to the Atlas API. The backend is
`api.py` (FastAPI). It fans out to multiple LLM providers behind one contract
and, when the brain is on, persists + recalls memory automatically.

## Running & basics

- **Start:** `uvicorn api:app --reload` → base URL `http://127.0.0.1:8000`.
- **Live OpenAPI docs:** `GET /docs` (Swagger UI) and `/openapi.json` — generate a
  typed client from the latter if you want.
- **Content type:** JSON in, JSON out (`Content-Type: application/json`).
- **CORS:** enabled and permissive (`*`) for local dev, so a browser app on any
  origin can call it. This is **dev-only** — it's locked down before any deploy.
- **Auth:** none. This is a local personal PoC; the backend holds your API keys
  in `.env` / `credentials.db`. **Do not expose it publicly.**
- **No streaming.** Every response is the *complete* answer (the backend collects
  the provider's stream server-side). Expect one response per request, not tokens.
  Show a loading state — provider calls take **seconds** (and more when the brain's
  summarizer runs).

## The two ways to chat

| Mode | Endpoint | Keeps conversation context? | Use when |
|---|---|---|---|
| **One-shot** | `POST /chat` | No (each call independent) | quick prompts, no threading |
| **Session** | `POST /sessions` then `.../messages` | Yes (multi-turn) | a real chat UI |

With the brain enabled, **both** modes still write to and recall from global
memory — sessions just also keep the provider's own turn-by-turn context.

## Providers & models

Fetch capabilities at runtime from `GET /providers` — don't hardcode. Shape:

```json
[
  {"provider": "openai",     "anonymous": false, "models": ["gpt-4o","gpt-4o-mini","o4-mini"]},
  {"provider": "anthropic",  "anonymous": false, "models": ["claude-opus-4-5","claude-sonnet-4-5","claude-haiku-4-5"]},
  {"provider": "gemini",     "anonymous": false, "models": ["gemini-2.5-pro","gemini-2.5-flash"]},
  {"provider": "openrouter", "anonymous": false, "models": []},
  {"provider": "local",      "anonymous": false, "models": []}
]
```

- `anonymous`: always `false` here — every provider needs either an API key or
  a local server (see `/settings/providers`).
- `models`: *suggested* slugs. The user may also send any custom slug, or omit
  `model` for the provider default. Empty list = provider has no suggested list
  (OpenRouter/local models are user-supplied).

## Provider settings (the Advanced UI)

- `GET /settings/providers` → `{ "openai": {"configured": true}, ..., "local":
  {"configured": true, "base_url": "...", "model": "..."} }`.
- `PUT /settings/providers/{provider}` with `{ "api_key": "..." }` (or, for
  `local`, `{ "base_url": "...", "model": "..." }`) saves it immediately — no
  restart needed.
- `POST /settings/providers/{provider}/test` sends a real one-token prompt and
  returns `{ "ok": true, "reply": "..." }` or a `400` with what failed. Use
  this to back a "Test connection" button, especially for local models.

## Endpoints

### `GET /providers`
List providers + capabilities (shape above).

### `POST /chat` — stateless one-shot
Request:
```json
{ "provider": "openai", "prompt": "hello", "model": null }
```
`model` is optional. Response = **Reply** (see below).

### `POST /sessions` — open a multi-turn session  → `201`
Request:
```json
{ "provider": "openai", "model": null }
```
Response:
```json
{ "session_id": "1bf8…", "provider": "openai", "thread_id": "8093…" }
```
- `session_id`: use it in the message endpoints below.
- `thread_id`: the memory thread (use it for the `/threads/{id}/…` endpoints).
  **`null` when the brain is disabled.**

### `POST /sessions/{session_id}/messages` — send a turn
Request: `{ "prompt": "and now?" }` → Response = **Reply**.
Calls to the *same* session are **serialized** server-side (a per-session lock),
so don't rely on two concurrent sends to one session running in parallel.

### `POST /sessions/{session_id}/new_chat` — reset the conversation
Response: `{ "ok": true }`. Starts a fresh context (and a fresh memory thread).

### `DELETE /sessions/{session_id}` — close + drop
Response: `{ "ok": true }`. Sessions are **in-memory** — they also vanish on a
server restart, so handle a `404` ("no such session") by re-creating one.

### `GET /memory/search?q=…&k=6` — plain semantic search
Across **all** stored threads. Response:
```json
[ { "text": "…", "thread_id": "…", "distance": 0.25 } ]
```
`distance` is cosine distance — **smaller = more similar**.

### `POST /memory/search` — graph-aware search
Request: `{ "q": "…", "k": 6, "graph": true }`. Response:
```json
{
  "hits":     [ { "text": "…", "thread_id": "…", "distance": 0.25 } ],
  "entities": ["Nightingale", "Rust"],
  "facts":    [ { "src": "Nightingale", "relation": "built with", "dst": "Rust" } ]
}
```
`entities`/`facts` only appear when `graph` is true; `facts` is empty unless the
graph has been populated (needs `BRAIN_AUTO_SUMMARY=1`).

### `GET /threads/{thread_id}/summary`
`{ "thread_id": "…", "rolling_summary": "…" }` (summary may be `""`).

### `GET /threads/{thread_id}/graph`
```json
{
  "nodes": [ { "name": "Nightingale", "type": "", "mentions": 2 } ],
  "edges": [ { "src": "Nightingale", "relation": "built with", "dst": "Rust", "weight": 1 } ]
}
```

## The Reply object

`POST /chat` and `.../messages` both return:
```json
{ "text": "the answer", "provider": "openai", "meta": { … } }
```
- `text`: render this.
- `provider`: which backend answered.
- `meta`: **opaque**, provider-specific extras (e.g. token usage, stop reason).
  The shape differs per provider — **treat it as a black box**; don't branch
  on its contents.

## Errors

FastAPI style — non-2xx returns `{ "detail": "message" }`. Handle:

| Status | Meaning | Frontend action |
|---|---|---|
| `400` | missing API key for that provider, or brain disabled for a memory endpoint | show the `detail`; it's a config issue -- point the user at Profile -> Advanced |
| `404` | unknown provider, or session/thread not found | for sessions: re-create and retry |
| `502` | provider/network failure (rate limit, bad key, local server unreachable) | show `detail`; offer retry; some are transient |
| `422` | malformed request body (validation) | fix the payload |

## Suggested chat flow

1. `GET /providers` → build the provider/model picker.
2. `POST /sessions {provider, model?}` → store `session_id` + `thread_id`.
3. On each user message: `POST /sessions/{id}/messages {prompt}` → append
   `reply.text`. Keep a spinner up (seconds-scale latency, no streaming).
4. "New chat" button → `POST /sessions/{id}/new_chat`.
5. Optional side panels: `GET /threads/{thread_id}/summary`,
   `GET /threads/{thread_id}/graph`, and a search box → `POST /memory/search`.
6. On unmount / logout: `DELETE /sessions/{id}`.
7. If any session call returns `404`, transparently re-create the session.

## curl quickstart

```bash
curl localhost:8000/providers

curl -X POST localhost:8000/chat \
  -H 'Content-Type: application/json' \
  -d '{"provider":"openai","prompt":"hello"}'

SID=$(curl -s -X POST localhost:8000/sessions \
  -H 'Content-Type: application/json' \
  -d '{"provider":"openai"}' | jq -r .session_id)
curl -X POST localhost:8000/sessions/$SID/messages \
  -H 'Content-Type: application/json' -d '{"prompt":"remember my name is Subham"}'

curl -X POST localhost:8000/memory/search \
  -H 'Content-Type: application/json' -d '{"q":"what is my name?","graph":true}'
```
