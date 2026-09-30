"""
Atlas HTTP API -- a thin FastAPI layer over the provider factory.

Two ways to talk to a provider:

  * Stateless one-shot:  POST /chat            (build -> init -> send -> close)
  * Stateful session:    POST /sessions ...    (keeps multi-turn context)

A stateful session is kept server-side in an in-memory registry and its calls
are serialized with a per-session lock. All HTTP endpoints require a per-run
ATLAS_API_TOKEN bearer token; sessions themselves are not persistent.

Run: set ATLAS_API_TOKEN in both development processes, then start uvicorn.
"""
from __future__ import annotations

import asyncio
import os
import re
import secrets
import uuid
from contextlib import asynccontextmanager
from typing import Literal

import json
import logging

import httpx
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

import credentials_store
import chat_store
import imagegen
import voice
import websearch
from adapters.base import ImageInput
from adapters.openai_adapter import OpenAIAdapter, DEFAULT_MODEL as OPENAI_DEFAULT_MODEL
from adapters.anthropic_adapter import AnthropicAdapter, DEFAULT_MODEL as ANTHROPIC_DEFAULT_MODEL
from adapters.gemini_adapter import GeminiAdapter, DEFAULT_MODEL as GEMINI_DEFAULT_MODEL
from adapters.openrouter_adapter import DEFAULT_MODEL as OPENROUTER_DEFAULT_MODEL
from tools.contracts import (MAX_HISTORY_CHARS, MAX_HISTORY_TURNS, AgentEventAdapter,
                             AgentTurnRequest, RecentTurn)
from tools.registry import ToolDenied, ToolNotFound
from agents.runner import run_selected
from factory import (ANON_OK, BRAIN_ENABLED, BRAIN_TOPK, IMAGE_GEN_MODELS,
                     IMAGE_GEN_PROVIDERS, MODELS, PROVIDERS, AuthMissing,
                     build_adapter, build_brain, get_embedder, get_store)
from policy import ExecutionMode, ExecutionPolicy, ModelCandidate
from routing import is_loopback_endpoint
from auto_route import route_turn as auto_route_turn
from reasoning import ReasoningLevel
from brain.documents import Documents

TAVILY_KEY = "TAVILY_API_KEY"
GROQ_KEY = "GROQ_API_KEY"
API_TOKEN = os.environ.get('ATLAS_API_TOKEN') or secrets.token_urlsafe(32)
if len(API_TOKEN) < 32 or len(API_TOKEN) > 256 or not API_TOKEN.isascii() or any(
    char.isspace() for char in API_TOKEN
):
    raise RuntimeError('ATLAS_API_TOKEN must be a strong ASCII token without whitespace')

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

# Packaged Electron loads file:// (opaque Origin: null); dev Vite uses 5173.
ALLOWED_ORIGINS = ("null", "http://localhost:5173", "http://127.0.0.1:5173")


@app.middleware("http")
async def require_local_token(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and origin not in ALLOWED_ORIGINS:
        return JSONResponse({"detail": "Origin not allowed"}, status_code=403)
    if not API_TOKEN:
        return JSONResponse({"detail": "Local API authentication is not configured"}, status_code=503)
    provided = request.headers.get("authorization", "")
    if not provided.isascii() or not secrets.compare_digest(provided, f"Bearer {API_TOKEN}"):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401,
                            headers={"WWW-Authenticate": "Bearer"})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)


class ModelPreference(BaseModel):
    model_config = ConfigDict(extra='forbid')
    provider: Literal['local', 'openai', 'anthropic', 'gemini', 'openrouter']
    model: str = Field(max_length=200)


class TurnRouteRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    prompt: str = Field(min_length=1, max_length=10000)
    mode: ExecutionMode = ExecutionMode.AUTO
    preference: ModelPreference | None = None
    # Auto may use configured cloud providers only when the user opted in.
    allow_cloud: bool = False
    # Exact level for a picked model; the ceiling when Auto picks the model.
    reasoning: ReasoningLevel = 'medium'
    agent_mode: Literal['chat', 'search_web', 'research', 'plan', 'write', 'draft', 'tools'] = 'chat'


_CLOUD_ORDER = ('openai', 'anthropic', 'gemini', 'openrouter')  # Stable; no quality/price claims.
_TOOL_CAPABILITIES = {'openai': OpenAIAdapter.capabilities, 'anthropic': AnthropicAdapter.capabilities,
                      'gemini': GeminiAdapter.capabilities}


def _candidate(provider: str, model: str, is_local: bool) -> ModelCandidate:
    capabilities = {'research', 'coding', 'documentation'}
    tools = _TOOL_CAPABILITIES.get(provider)
    if tools and tools.tool_calls and (not tools.supported_models or model in tools.supported_models):
        capabilities.add('tools')
    return ModelCandidate(provider, model, frozenset(capabilities), is_local)


def _cloud_default(provider: str) -> str:
    if provider == 'openrouter':
        return credentials_store.get_value('OPENROUTER_MODEL') or OPENROUTER_DEFAULT_MODEL
    return {'openai': OPENAI_DEFAULT_MODEL, 'anthropic': ANTHROPIC_DEFAULT_MODEL,
            'gemini': GEMINI_DEFAULT_MODEL}[provider]


@app.post('/routing/turn')
async def route_turn(body: TurnRouteRequest):
    # Cloud needs a named, configured preference or explicit Auto opt-in; never a silent fallback.
    preference = ((body.preference.provider, body.preference.model)
                  if body.preference else None)
    cloud_preference = bool(preference and preference[0] != 'local')
    candidates = []
    if not cloud_preference:
        base_url = _local_base_url()
        local_model = credentials_store.get_value('LOCAL_LLM_MODEL')
        models = ([local_model] if local_model else await _discover_local_models(base_url)) \
            if is_loopback_endpoint(base_url) else []
        candidates = [_candidate('local', model, True) for model in models if model and not re.search(
            r'(embedding|embed-|unlimited-ocr|\bocr\b)', model, re.I)]
    cloud = ([preference[0]] if cloud_preference else
             _CLOUD_ORDER if body.allow_cloud and not preference else ())
    candidates += [_candidate(provider, _cloud_default(provider), False) for provider in cloud
                   if credentials_store.get_value(PROVIDER_ENV_KEYS[provider])]
    return auto_route_turn(body.prompt, body.mode, body.agent_mode, candidates,
                           ExecutionPolicy(allow_cloud=cloud_preference or body.allow_cloud),
                           preference, body.reasoning,
                           bool(credentials_store.get_value(TAVILY_KEY)))


class SessionCreate(BaseModel):
    provider: str
    anonymous: bool = False
    model: str | None = None
    # Resume the chat's memory thread instead of starting an empty one.
    thread_id: str | None = Field(default=None, pattern=r'^[0-9a-f]{32}$')


class ImagePayload(BaseModel):
    data: str
    mime: str


class Message(BaseModel):
    prompt: str
    images: list[ImagePayload] | None = None
    mode: ExecutionMode = ExecutionMode.AUTO
    reasoning: ReasoningLevel | None = None
    # The chat's prior turns; when sent, they replace the session's own memory of the chat.
    history: list[RecentTurn] | None = Field(default=None, max_length=MAX_HISTORY_TURNS)

    @field_validator('history')
    @classmethod
    def bounded_history(cls, history):
        if history and sum(len(turn.content) for turn in history) > MAX_HISTORY_CHARS:
            raise ValueError('conversation history too long')
        return history


def _prepare_turn(adapter, body: 'Message') -> None:
    """Apply per-turn settings to the chat writer (never Brain's separate summarizer)."""
    _set_reasoning(adapter, body.reasoning)
    if body.history is not None:
        getattr(adapter, 'adapter', adapter).set_history(
            [(turn.role, turn.content) for turn in body.history])


def _set_reasoning(adapter, level: str | None) -> None:
    """Applies to the chat writer, never to Brain's separate summarizer."""
    getattr(adapter, 'adapter', adapter).reasoning = level


class ChatOnce(BaseModel):
    provider: str
    prompt: str
    anonymous: bool = False
    model: str | None = None
    images: list[ImagePayload] | None = None
    mode: ExecutionMode = ExecutionMode.AUTO


class MemorySearch(BaseModel):
    q: str
    k: int = BRAIN_TOPK
    graph: bool = True


class DocumentCreate(BaseModel):
    name: str
    text: str


class ImageGenerate(BaseModel):
    provider: str
    prompt: str
    model: str | None = None


class WebSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    max_results: int = Field(default=5, ge=1, le=8)

    @field_validator("query")
    @classmethod
    def nonempty_query(cls, query: str) -> str:
        if not query.strip():
            raise ValueError("query must not be blank")
        return query


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
    runtime: str | None = None


def _local_runtime(base_url: str) -> str:
    """Return an explicit user choice, or infer the common local-server default."""
    configured = credentials_store.get_value("LOCAL_LLM_RUNTIME")
    if configured in {"ollama", "lmstudio", "vllm", "local"}:
        return configured
    url = base_url.lower()
    if "11434" in url or "ollama" in url:
        return "ollama"
    if "1234" in url or "lmstudio" in url:
        return "lmstudio"
    if "vllm" in url:
        return "vllm"
    return "local"


def _local_base_url() -> str:
    return credentials_store.get_value("LOCAL_LLM_BASE_URL") or "http://localhost:11434/v1"


def _openai_models_url(base_url: str) -> str:
    base_url = base_url.rstrip("/")
    return f"{base_url}/models" if base_url.endswith("/v1") else f"{base_url}/v1/models"


async def _discover_local_models(base_url: str) -> list[str]:
    """List models from OpenAI-compatible servers, with Ollama-native fallback."""
    api_key = credentials_store.get_value("LOCAL_LLM_API_KEY")
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else None
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            response = await client.get(_openai_models_url(base_url), headers=headers)
            response.raise_for_status()
            data = response.json().get("data", [])
            models = [item["id"] for item in data if isinstance(item, dict) and item.get("id")]
            if models:
                return models
    except (httpx.HTTPError, ValueError, AttributeError):
        pass

    if _local_runtime(base_url) == "ollama":
        try:
            async with httpx.AsyncClient(timeout=4.0) as client:
                response = await client.get(f"{base_url.split('/v1')[0].rstrip('/')}/api/tags")
                response.raise_for_status()
                data = response.json().get("models", [])
                return [item["name"] for item in data if isinstance(item, dict) and item.get("name")]
        except (httpx.HTTPError, ValueError, AttributeError):
            pass
    return []


def _build(provider: str, anonymous: bool, model: str | None, thread_id: str | None = None):
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
            return build_brain(provider, anonymous, model, thread_id)
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


def _err_detail(e: Exception) -> str:
    """Some SDK exceptions (e.g. google-genai's ClientError) override __str__
    with the full raw response dict; their `.message` attribute is the clean,
    human-readable string underneath. Falls back to str(e) for exceptions
    (OpenAI's, Anthropic's, plain network errors) that don't have one."""
    return getattr(e, "message", None) or str(e)


@app.get("/providers")
async def list_providers():
    """Provider capabilities: anonymous support + suggested model slugs."""
    capabilities = {
        'openai': OpenAIAdapter.capabilities,
        'anthropic': AnthropicAdapter.capabilities,
        'gemini': GeminiAdapter.capabilities,
    }
    return [{"provider": p, "anonymous": p in ANON_OK, "models": MODELS.get(p, []),
             "capabilities": {
                 "tool_calls": p in capabilities and capabilities[p].tool_calls,
                 "streamed_arguments": p in capabilities and capabilities[p].streamed_arguments,
                 "tool_models": list(capabilities[p].supported_models) if p in capabilities else []
             }} for p in PROVIDERS]


@app.get("/settings/providers")
async def get_provider_settings():
    """Per-provider: is an API key configured? Plus the current local-LLM
    base URL/model, so the Advanced settings UI can render current state."""
    out = {}
    for p in PROVIDERS:
        if p == "local":
            out[p] = {
                "configured": True,
                "base_url": _local_base_url(),
                "model": credentials_store.get_value("LOCAL_LLM_MODEL"),
                "runtime": _local_runtime(_local_base_url()),
                "api_key_configured": bool(credentials_store.get_value("LOCAL_LLM_API_KEY")),
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


@app.get("/settings/providers/local/models")
async def get_local_models():
    """Discover models exposed by Ollama, LM Studio, vLLM, or another
    OpenAI-compatible local endpoint. An unreachable endpoint is represented
    by an empty list so the settings UI can remain usable offline."""
    base_url = _local_base_url()
    return {
        "base_url": base_url,
        "runtime": _local_runtime(base_url),
        "models": await _discover_local_models(base_url),
    }


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
        if body.runtime is not None:
            if body.runtime not in {"ollama", "lmstudio", "vllm", "local"}:
                raise HTTPException(400, "runtime must be ollama, lmstudio, vllm, or local")
            updates["LOCAL_LLM_RUNTIME"] = body.runtime
        if body.api_key is not None:
            updates["LOCAL_LLM_API_KEY"] = body.api_key
        if updates:
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
        raise HTTPException(502, f"transcription failed: {_err_detail(e)}")
    return {"text": text}


@app.post("/account/reset")
async def reset_account():
    """Wipe all shared server-side state -- credentials, document indexes and
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
        raise HTTPException(502, f"image generation failed: {_err_detail(e)}")
    return {"images": images}


async def _search_until_disconnect(request: Request, search):
    """Cancel the upstream task when the client abandons the HTTP request."""
    task = asyncio.create_task(search)
    try:
        while not task.done():
            if await request.is_disconnected():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                raise asyncio.CancelledError()
            await asyncio.wait({task}, timeout=0.1)
        return await task
    finally:
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)


@app.post("/websearch")
async def web_search(body: WebSearchRequest, request: Request):
    """Real internet search (Tavily) backing the Search-web/Research-mode
    tools. Returns titles/urls/content for the caller to fold into the prompt
    and to show as source pins under the reply -- no conversation state here,
    same as image generation."""
    api_key = credentials_store.get_value(TAVILY_KEY)
    if not api_key:
        raise HTTPException(400, "no Tavily API key configured")
    try:
        results = await _search_until_disconnect(
            request, websearch.search(api_key, body.query, body.max_results)
        )
    except httpx.TimeoutException:
        raise HTTPException(504, "web search timed out")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 429:
            raise HTTPException(429, "web search rate limited")
        raise HTTPException(502, "web search provider failed")
    except Exception:
        raise HTTPException(502, "web search failed")
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
        raise HTTPException(400, f"connection test failed: {_err_detail(e)}")
    finally:
        await adapter.close()
    return {"ok": True, "reply": reply.text}


@app.post("/chat")
async def chat_once(body: ChatOnce):
    """One-shot, stateless: no conversation context is retained."""
    if body.mode is ExecutionMode.AUTO and (body.provider != 'local' or
                                            not is_loopback_endpoint(_local_base_url())):
        raise HTTPException(403, 'Auto requires a permitted loopback model; select an explicit mode for a cloud model')
    adapter = _build(body.provider, body.anonymous, body.model)
    _check_auto_session(body.mode, adapter)
    try:
        await adapter.init()
        reply = await adapter.send(body.prompt, _images(body.images))
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"chat failed: {_err_detail(e)}")
    finally:
        await adapter.close()
    return _reply_dict(reply)


@app.post("/sessions", status_code=201)
async def create_session(body: SessionCreate):
    """Open a persistent, multi-turn session; returns a session_id."""
    adapter = _build(body.provider, body.anonymous, body.model, body.thread_id)
    try:
        await adapter.init()
    except Exception as e:
        await adapter.close()
        raise HTTPException(502, f"init failed: {_err_detail(e)}")
    sid = uuid.uuid4().hex
    SESSIONS[sid] = (adapter, asyncio.Lock())
    return {"session_id": sid, "provider": body.provider,
            "thread_id": getattr(adapter, "thread_id", None)}


def _check_auto_session(mode: ExecutionMode, adapter) -> None:
    if mode is not ExecutionMode.AUTO:
        return
    writer = getattr(adapter, 'adapter', adapter)
    base_url = getattr(getattr(writer, '_client', None), 'base_url', '')
    if (getattr(adapter, 'provider', getattr(adapter, 'name', None)) != 'local' or
            not is_loopback_endpoint(str(base_url))):
        raise HTTPException(403, 'Auto requires a permitted loopback model; select an explicit mode for a cloud model')
    # Brain enrichment may use a separate cloud summarizer even with a local chat adapter.
    if hasattr(adapter, 'auto_summary'):
        adapter.auto_summary = False


@app.post("/sessions/{sid}/messages")
async def send_message(sid: str, body: Message):
    adapter, lock = _get(sid)
    _check_auto_session(body.mode, adapter)
    async with lock:
        _prepare_turn(adapter, body)
        try:
            reply = await adapter.send(body.prompt, _images(body.images))
        except Exception as e:
            raise HTTPException(502, f"send failed: {_err_detail(e)}")
    return _reply_dict(reply)


@app.post("/sessions/{sid}/messages/stream")
async def send_message_stream(sid: str, body: Message):
    adapter, lock = _get(sid)
    _check_auto_session(body.mode, adapter)

    async def event_generator():
        async with lock:
            _prepare_turn(adapter, body)
            try:
                async for token in adapter.send_stream(body.prompt, _images(body.images)):
                    if isinstance(token, dict):
                        yield f"data: {json.dumps(token)}\n\n"
                    else:
                        yield f"data: {json.dumps({'text': token})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'error': _err_detail(e)})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/sessions/{sid}/agent/stream")
async def agent_stream(sid: str, body: AgentTurnRequest, request: Request):
    """Stream progress without exposing tool policy or credentials to the renderer."""
    adapter, lock = _get(sid)

    async def events():
        queue: asyncio.Queue = asyncio.Queue()
        cancelled = asyncio.Event()
        run_id = None
        phase = None

        async def work():
            async with lock:
                def emit(event: dict) -> None:
                    nonlocal run_id, phase
                    validated = AgentEventAdapter.validate_python(event)
                    run_id = event.get('run_id') or run_id
                    if event['type'] in ('tool.started', 'tool.progress', 'plan.ready'):
                        phase = event.get('tool') or event.get('phase') or 'planning'
                    queue.put_nowait(validated.model_dump(exclude_none=True))

                try:
                    _set_reasoning(adapter, body.reasoning)
                    provider = adapter.provider if hasattr(adapter, 'provider') else adapter.name
                    model = getattr(adapter.adapter if hasattr(adapter, 'adapter') else adapter,
                                    'model', None)
                    await run_selected(body, adapter, provider, model, emit, cancelled)
                except asyncio.CancelledError:
                    cancelled.set()
                    emit({'type': 'run.cancelled'})
                except Exception as e:
                    if isinstance(e, ValueError) and str(e) == 'selected model does not support native tool calls':
                        code, reason = 'unsupported_model', 'This model cannot choose tools. Choose a supported model, or use Search or Research.'
                    elif isinstance(e, ValueError) and str(e) == 'no Tavily API key configured':
                        code, reason = 'key_unavailable', 'Web search needs a Tavily key in Settings.'
                    elif isinstance(e, (TimeoutError, asyncio.TimeoutError)):
                        code, reason = 'timeout', 'The agent run timed out. Try again.'
                    elif isinstance(e, (ToolDenied, ToolNotFound)):
                        code, reason = 'invalid_call', 'The tool call was denied or unavailable.'
                    elif isinstance(e, ValueError) and 'budget' in str(e):
                        code, reason = 'budget', 'The agent reached its tool limit.'
                    else:
                        code, reason = 'internal', 'The agent could not complete this run. Try again or change models.'
                    logging.getLogger(__name__).warning('agent run failed: code=%s run_id=%s phase=%s',
                                                        code, run_id or 'unknown', phase or 'start')
                    emit({'type': 'run.failed', 'run_id': run_id, 'code': code,
                          'phase': phase, 'reason': reason})
                finally:
                    queue.put_nowait(None)

        worker = asyncio.create_task(work())
        try:
            while True:
                if await request.is_disconnected():
                    cancelled.set()
                    worker.cancel()
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.1)
                except asyncio.TimeoutError:
                    continue
                if event is None:
                    break
                yield f"data: {json.dumps(event)}\n\n"
        finally:
            cancelled.set()
            if not worker.done():
                worker.cancel()
            await asyncio.gather(worker, return_exceptions=True)

    return StreamingResponse(events(), media_type='text/event-stream')


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


@app.post("/documents", status_code=201)
def ingest_document(body: DocumentCreate):
    try:
        source_id = Documents(get_store().con).ingest_document(body.name, body.text)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"source_id": source_id}


@app.get("/documents")
def list_documents():
    return Documents(get_store().con).list_documents()


@app.get("/documents/search")
def search_documents(q: str = Query(min_length=1, max_length=512),
                     limit: int = Query(6, ge=1, le=20)):
    return Documents(get_store().con).search_documents(q, limit)


@app.delete("/documents/{source_id}", status_code=204)
def delete_document(source_id: str):
    Documents(get_store().con).delete_document(source_id)
    return Response(status_code=204)


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
