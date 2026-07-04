"""
Atlas HTTP API -- a thin FastAPI layer over the provider factory.

Two ways to talk to a provider:

  * Stateless one-shot:  POST /chat            (build -> init -> send -> close)
  * Stateful session:    POST /sessions ...    (keeps multi-turn context)

A stateful session is kept server-side in an in-memory registry and its calls
are serialized with a per-session lock. This is a single-process PoC store --
no auth, no persistence.

Run:  uvicorn api:app --reload
Docs: http://127.0.0.1:8000/docs
"""
from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager

import json
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import credentials_store
import chat_store
import imagegen
import voice
import websearch
from adapters.base import ImageInput
from factory import (ANON_OK, BRAIN_ENABLED, BRAIN_TOPK, IMAGE_GEN_MODELS,
                     IMAGE_GEN_PROVIDERS, MODELS, PROVIDERS, AuthMissing,
                     build_adapter, build_brain, get_embedder, get_store)

TAVILY_KEY = "TAVILY_API_KEY"
GROQ_KEY = "GROQ_API_KEY"

SESSIONS: dict[str, tuple] = {}

PROVIDER_ENV_KEYS = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    for adapter, _ in SESSIONS.values():
        try:
            await adapter.close()
        except Exception:
            pass
    SESSIONS.clear()


app = FastAPI(title="Atlas API", version="1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class SessionCreate(BaseModel):
    provider: str
    anonymous: bool = False
    model: str | None = None


class ImagePayload(BaseModel):
    data: str
    mime: str


class Message(BaseModel):
    prompt: str
    images: list[ImagePayload] | None = None


class ChatOnce(BaseModel):
    provider: str
    prompt: str
    anonymous: bool = False
    model: str | None = None
    images: list[ImagePayload] | None = None


class MemorySearch(BaseModel):
    q: str
    k: int = BRAIN_TOPK
    graph: bool = True


class ImageGenerate(BaseModel):
    provider: str
    prompt: str
    model: str | None = None


class WebSearchRequest(BaseModel):
    query: str
    max_results: int = 5


class SearchSettingsUpdate(BaseModel):
    api_key: str


class VoiceSettingsUpdate(BaseModel):
    api_key: str


class TranscribeRequest(BaseModel):
    data: str
    mime: str


class ProviderSettingsUpdate(BaseModel):
    api_key: str | None = None
    base_url: str | None = None
    model: str | None = None


def _build(provider: str, anonymous: bool, model: str | None):
    """Validate + build a chat handle, mapping factory errors to HTTP codes.

    Returns a memory-backed Brain when BRAIN_ENABLED, else a plain adapter --
    both share the init/send/close/new_chat surface, so callers don't care.
    """
    if provider not in PROVIDERS:
        raise HTTPException(404, f"unknown provider {provider!r}; "
                                 f"choose from {PROVIDERS}")
    if anonymous and provider not in ANON_OK:
        raise HTTPException(400, f"{provider} has no anonymous mode")
    try:
        if BRAIN_ENABLED:
            return build_brain(provider, anonymous, model)
        return build_adapter(provider, anonymous, model)
    except AuthMissing as e:
        raise HTTPException(400, str(e))
    except ValueError as e:
        raise HTTPException(400, str(e))


def _get(sid: str):
    session = SESSIONS.get(sid)
    if session is None:
        raise HTTPException(404, "no such session")
    return session


def _reply_dict(reply):
    return {"text": reply.text, "provider": reply.provider, "meta": reply.meta}


def _images(payloads: list[ImagePayload] | None) -> list[ImageInput] | None:
    if not payloads:
        return None
    return [ImageInput(data=p.data, mime=p.mime) for p in payloads]


@app.get("/providers")
async def list_providers():
    """Provider capabilities: anonymous support + suggested model slugs."""
    return [{"provider": p, "anonymous": p in ANON_OK, "models": MODELS.get(p, [])}
            for p in PROVIDERS]


@app.get("/settings/providers")
async def get_provider_settings():
    """Per-provider: is an API key configured? Plus the current local-LLM
    base URL/model, so the Advanced settings UI can render current state."""
    out = {}
    for p in PROVIDERS:
        if p == "local":
            out[p] = {
                "configured": True,
                "base_url": credentials_store.get_value("LOCAL_LLM_BASE_URL"),
                "model": credentials_store.get_value("LOCAL_LLM_MODEL"),
            }
            continue
        key = credentials_store.get_value(PROVIDER_ENV_KEYS[p])
        if p == "openrouter":
            out[p] = {
                "configured": bool(key),
                "model": credentials_store.get_value("OPENROUTER_MODEL"),
            }
            continue
        out[p] = {"configured": bool(key)}
    return out


@app.put("/settings/providers/{provider}")
async def set_provider_settings(provider: str, body: ProviderSettingsUpdate):
    if provider not in PROVIDERS:
        raise HTTPException(404, f"unknown provider {provider!r}")

    if provider == "local":
        updates = {}
        if body.base_url is not None:
            updates["LOCAL_LLM_BASE_URL"] = body.base_url
        if body.model is not None:
            updates["LOCAL_LLM_MODEL"] = body.model
        credentials_store.set_many(updates)
        return {"ok": True}

    if provider == "openrouter":
        updates = {}
        if body.api_key:
            updates["OPENROUTER_API_KEY"] = body.api_key
        if body.model is not None:
            updates["OPENROUTER_MODEL"] = body.model
        if updates:
            credentials_store.set_many(updates)
        return {"ok": True}

    if not body.api_key:
        raise HTTPException(400, "api_key is required")
    credentials_store.set_many({PROVIDER_ENV_KEYS[provider]: body.api_key})
    return {"ok": True}


@app.delete("/settings/providers/{provider}")
async def clear_provider_settings(provider: str):
    """Disconnect a provider -- clears its saved API key."""
    if provider not in PROVIDER_ENV_KEYS:
        raise HTTPException(404, f"unknown or key-less provider {provider!r}")
    credentials_store.delete(PROVIDER_ENV_KEYS[provider])
    if provider == "openrouter":
        credentials_store.delete("OPENROUTER_MODEL")
    return {"ok": True}


@app.get("/settings/search")
async def get_search_settings():
    return {"configured": bool(credentials_store.get_value(TAVILY_KEY))}


@app.put("/settings/search")
async def set_search_settings(body: SearchSettingsUpdate):
    credentials_store.set_many({TAVILY_KEY: body.api_key})
    return {"ok": True}


@app.delete("/settings/search")
async def clear_search_settings():
    credentials_store.delete(TAVILY_KEY)
    return {"ok": True}


@app.get("/settings/voice")
async def get_voice_settings():
    return {"configured": bool(credentials_store.get_value(GROQ_KEY))}


@app.put("/settings/voice")
async def set_voice_settings(body: VoiceSettingsUpdate):
    credentials_store.set_many({GROQ_KEY: body.api_key})
    return {"ok": True}


@app.delete("/settings/voice")
async def clear_voice_settings():
    credentials_store.delete(GROQ_KEY)
    return {"ok": True}


@app.post("/audio/transcribe")
async def transcribe_audio(body: TranscribeRequest):
    """Voice typing -- transcribes recorded mic audio via Groq's Whisper API."""
    api_key = credentials_store.get_value(GROQ_KEY)
    if not api_key:
        raise HTTPException(400, "no Groq API key configured")
    try:
        text = await voice.transcribe(api_key, body.data, body.mime)
    except Exception as e:
        raise HTTPException(502, f"transcription failed: {e}")
    return {"text": text}


@app.post("/account/reset")
async def reset_account():
    """Wipe all shared server-side state -- saved provider credentials and all
    brain memory (threads/messages/chunks/entities/edges). Used when a user
    deletes their account from the desktop app; closes any live sessions
    first, since their state no longer exists after the wipe."""
    for adapter, _ in SESSIONS.values():
        try:
            await adapter.close()
        except Exception:
            pass
    SESSIONS.clear()
    credentials_store.clear_all()
    chat_store.clear_all()
    if BRAIN_ENABLED:
        get_store().wipe_all()
    return {"ok": True}


@app.post("/images/generate")
async def generate_image(body: ImageGenerate):
    """Standalone image generation -- no conversation state, the reply IS the
    image(s). Only providers with a real image-gen API are eligible."""
    if body.provider not in IMAGE_GEN_PROVIDERS:
        raise HTTPException(400, f"{body.provider!r} does not support image "
                                 f"generation; choose from {IMAGE_GEN_PROVIDERS}")
    api_key = credentials_store.get_value(PROVIDER_ENV_KEYS[body.provider])
    if not api_key:
        raise HTTPException(400, f"no API key configured for {body.provider}")

    model = body.model or IMAGE_GEN_MODELS[body.provider]
    try:
        if body.provider == "openai":
            images = await imagegen.generate_openai_image(api_key, body.prompt, model)
        else:
            images = await imagegen.generate_gemini_image(api_key, body.prompt, model)
    except Exception as e:
        raise HTTPException(502, f"image generation failed: {e}")
    return {"images": images}


@app.post("/websearch")
async def web_search(body: WebSearchRequest):
    """Real internet search (Tavily) backing the Search-web/Research-mode
    tools. Returns titles/urls/content for the caller to fold into the prompt
    and to show as source pins under the reply -- no conversation state here,
    same as image generation."""
    api_key = credentials_store.get_value(TAVILY_KEY)
    if not api_key:
        raise HTTPException(400, "no Tavily API key configured")
    try:
        results = await websearch.search(api_key, body.query, body.max_results)
    except Exception as e:
        raise HTTPException(502, f"web search failed: {e}")
    return {"results": results}


@app.post("/settings/providers/{provider}/test")
async def test_provider_connection(provider: str):
    """Build the adapter for real and send a one-token prompt -- proves the
    key/base_url actually works, not just that it's non-empty."""
    if provider not in PROVIDERS:
        raise HTTPException(404, f"unknown provider {provider!r}")
    try:
        adapter = build_adapter(provider)
    except AuthMissing as e:
        raise HTTPException(400, str(e))

    try:
        await adapter.init()
        reply = await adapter.send("Say OK.")
    except Exception as e:
        raise HTTPException(400, f"connection test failed: {e}")
    finally:
        await adapter.close()
    return {"ok": True, "reply": reply.text}


@app.post("/chat")
async def chat_once(body: ChatOnce):
    """One-shot, stateless: no conversation context is retained."""
    adapter = _build(body.provider, body.anonymous, body.model)
    try:
        await adapter.init()
        reply = await adapter.send(body.prompt, _images(body.images))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"chat failed: {e}")
    finally:
        await adapter.close()
    return _reply_dict(reply)


@app.post("/sessions", status_code=201)
async def create_session(body: SessionCreate):
    """Open a persistent, multi-turn session; returns a session_id."""
    adapter = _build(body.provider, body.anonymous, body.model)
    try:
        await adapter.init()
    except Exception as e:
        await adapter.close()
        raise HTTPException(502, f"init failed: {e}")
    sid = uuid.uuid4().hex
    SESSIONS[sid] = (adapter, asyncio.Lock())
    return {"session_id": sid, "provider": body.provider,
            "thread_id": getattr(adapter, "thread_id", None)}


@app.post("/sessions/{sid}/messages")
async def send_message(sid: str, body: Message):
    adapter, lock = _get(sid)
    async with lock:
        try:
            reply = await adapter.send(body.prompt, _images(body.images))
        except Exception as e:
            raise HTTPException(502, f"send failed: {e}")
    return _reply_dict(reply)


@app.post("/sessions/{sid}/messages/stream")
async def send_message_stream(sid: str, body: Message):
    adapter, lock = _get(sid)

    async def event_generator():
        async with lock:
            try:
                async for token in adapter.send_stream(body.prompt, _images(body.images)):
                    yield f"data: {json.dumps({'text': token})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/sessions/{sid}/new_chat")
async def reset_session(sid: str):
    adapter, lock = _get(sid)
    async with lock:
        await adapter.new_chat()
    return {"ok": True}


@app.delete("/sessions/{sid}")
async def close_session(sid: str):
    adapter, _ = _get(sid)
    await adapter.close()
    del SESSIONS[sid]
    return {"ok": True}


@app.get("/memory/search")
async def memory_search(q: str, k: int = BRAIN_TOPK):
    """Plain semantic search across ALL stored threads."""
    if not BRAIN_ENABLED:
        raise HTTPException(400, "brain is disabled (set BRAIN_ENABLED=1)")
    store = get_store()
    hits = store.search(get_embedder().embed_one(q), k=k)
    return [{"text": t, "thread_id": tid, "distance": d} for t, tid, d in hits]


@app.post("/memory/search")
async def memory_search_graph(body: MemorySearch):
    """Graph-aware retrieval: vector hits + 1-hop facts for entities named in
    the query AND surfaced in the recalled chunks."""
    if not BRAIN_ENABLED:
        raise HTTPException(400, "brain is disabled (set BRAIN_ENABLED=1)")
    store = get_store()
    hits = store.search(get_embedder().embed_one(body.q), k=body.k)
    out = {"hits": [{"text": t, "thread_id": tid, "distance": d}
                    for t, tid, d in hits]}
    if body.graph:
        names = store.entity_names_in(body.q)
        for t, _, _ in hits:
            names.extend(store.entity_names_in(t))
        names = list(dict.fromkeys(names))
        triples = store.neighbors(names)
        out["entities"] = names
        out["facts"] = [{"src": s, "relation": r, "dst": d}
                        for s, r, d in triples]
    return out


@app.get("/threads/{tid}/summary")
async def thread_summary(tid: str):
    if not BRAIN_ENABLED:
        raise HTTPException(400, "brain is disabled (set BRAIN_ENABLED=1)")
    return {"thread_id": tid, "rolling_summary": get_store().get_summary(tid)}


@app.get("/threads/{tid}/graph")
async def thread_graph(tid: str):
    if not BRAIN_ENABLED:
        raise HTTPException(400, "brain is disabled (set BRAIN_ENABLED=1)")
    return get_store().graph(tid)


@app.get("/chats")
async def get_chats_endpoint():
    return chat_store.get_chats()


@app.post("/chats")
async def save_chats_endpoint(body: list[dict]):
    chat_store.save_chats(body)
    return {"ok": True}
