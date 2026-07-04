# Atlas

A desktop AI assistant : an Electron chat UI backed by a Python
FastAPI server that talks to OpenAI, Anthropic, Gemini, and OpenRouter through
their official SDKs, plus any local OpenAI-compatible model (e.g. Ollama) —
with a persistent memory layer (RAG + rolling summary + entity graph)
underneath all of them.

For setup and usage, see [`server/README.md`](server/README.md); for the
technical architecture reference, see
[`server/ARCHITECTURE.md`](server/ARCHITECTURE.md); for the HTTP contract a
frontend talks to, see [`server/FRONTEND.md`](server/FRONTEND.md).

## Layout

```
apps/desktop/   Electron + React + TypeScript desktop UI
server/         Python FastAPI backend (providers, settings, memory)
```

## Quick start

```powershell
# backend
cd server
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env   # paste at least one provider API key
uvicorn api:app --reload

# desktop app (separate terminal)
cd apps\desktop
npm install
npm run dev
```

Add API keys for OpenAI, Anthropic, Gemini, or OpenRouter in `.env`, or from
inside the app: **Profile -> Advanced**. Point the **Local LLM** section at an
Ollama (or other OpenAI-compatible) server if you'd rather run models
locally.

## Status

Open source, actively evolving. Voice mode, a Serper-backed research mode, a
plan mode, image generation, and structured document generation are sketched
into the UI as disabled "coming soon" entries but not implemented yet.

## License

MIT -- see [`LICENSE`](LICENSE).
