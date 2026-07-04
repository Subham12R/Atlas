"""
Provider factory -- the single place that knows how to build each adapter from
.env + a few options. The HTTP API (api.py) builds adapters through here, so
wiring lives in exactly one spot.
"""
import os
import uuid

from dotenv import load_dotenv

import credentials_store
from adapters import (AnthropicAdapter, GeminiAdapter, LocalAdapter,
                      OpenAIAdapter, OpenRouterAdapter)

load_dotenv()

DEBUG = bool(os.getenv("SB_DEBUG", "").strip())


def _flag(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip() not in ("", "0", "false", "False")


BRAIN_ENABLED = _flag("BRAIN_ENABLED", "1")
BRAIN_DB_PATH = os.getenv("BRAIN_DB_PATH", "brain.db").strip()
BRAIN_EMBED_MODEL = os.getenv("BRAIN_EMBED_MODEL", "BAAI/bge-small-en-v1.5").strip()
BRAIN_EMBED_DIM = int(os.getenv("BRAIN_EMBED_DIM", "384"))
BRAIN_SUMMARIZER = os.getenv("BRAIN_SUMMARIZER", "openai").strip()
BRAIN_AUTO_SUMMARY = _flag("BRAIN_AUTO_SUMMARY", "1")
BRAIN_TOPK = int(os.getenv("BRAIN_TOPK", "6"))
BRAIN_CONTEXT_BUDGET = int(os.getenv("BRAIN_CONTEXT_BUDGET", "2000"))
BRAIN_CHUNK_CHARS = int(os.getenv("BRAIN_CHUNK_CHARS", "800"))
BRAIN_CHUNK_OVERLAP = int(os.getenv("BRAIN_CHUNK_OVERLAP", "100"))
BRAIN_CHUNK_BREAKPOINT_TYPE = os.getenv("BRAIN_CHUNK_BREAKPOINT_TYPE", "percentile").strip()
_bp_amount_raw = os.getenv("BRAIN_CHUNK_BREAKPOINT_AMOUNT", "").strip()
BRAIN_CHUNK_BREAKPOINT_AMOUNT = float(_bp_amount_raw) if _bp_amount_raw else None
_max_dist_raw = os.getenv("BRAIN_MAX_DISTANCE", "0.6").strip()
BRAIN_MAX_DISTANCE = float(_max_dist_raw) if _max_dist_raw else None

PROVIDERS = ["openai", "anthropic", "gemini", "openrouter", "local"]
ANON_OK: set[str] = set()

MODELS = {
    "openai": ["gpt-4o", "gpt-4o-mini", "o4-mini"],
    "anthropic": ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    "gemini": ["gemini-2.5-pro", "gemini-2.5-flash"],
    "openrouter": [],
    "local": [],
}

IMAGE_GEN_PROVIDERS = ["openai", "gemini"]
IMAGE_GEN_MODELS = {
    "openai": "gpt-image-1",
    "gemini": "imagen-4.0-generate-001",
}


class AuthMissing(RuntimeError):
    """Raised when a provider's required API key isn't set."""


def _require(env: str) -> str:
    val = credentials_store.get_value(env)
    if not val or val.startswith("paste"):
        raise AuthMissing(f"{env} not set")
    return val


def build_adapter(pkey: str, anonymous: bool = False, model: str | None = None):
    """Construct (but do not init) the adapter for `pkey`.

    Raises AuthMissing if a required API key is absent, or ValueError for an
    unknown provider. `anonymous` is accepted for call-site compatibility but
    unused -- no provider here has a logged-out mode.
    """
    if pkey == "openai":
        return OpenAIAdapter(_require("OPENAI_API_KEY"), model=model, debug=DEBUG)

    if pkey == "anthropic":
        return AnthropicAdapter(_require("ANTHROPIC_API_KEY"), model=model, debug=DEBUG)

    if pkey == "gemini":
        return GeminiAdapter(_require("GEMINI_API_KEY"), model=model, debug=DEBUG)

    if pkey == "openrouter":
        openrouter_model = model or credentials_store.get_value("OPENROUTER_MODEL") or None
        return OpenRouterAdapter(_require("OPENROUTER_API_KEY"), model=openrouter_model, debug=DEBUG)

    if pkey == "local":
        base_url = credentials_store.get_value("LOCAL_LLM_BASE_URL") or None
        local_model = model or credentials_store.get_value("LOCAL_LLM_MODEL") or None
        return LocalAdapter(base_url=base_url, model=local_model, debug=DEBUG)

    raise ValueError(f"unknown provider {pkey!r}")


_store = None
_embedder = None


def get_embedder():
    global _embedder
    if _embedder is None:
        from brain import Embedder
        _embedder = Embedder(BRAIN_EMBED_MODEL, BRAIN_EMBED_DIM)
    return _embedder


def get_store():
    global _store
    if _store is None:
        from brain import MemoryStore, connect
        _store = MemoryStore(connect(BRAIN_DB_PATH, BRAIN_EMBED_DIM))
    return _store


def build_brain(pkey: str, anonymous: bool = False, model: str | None = None,
                thread_id: str | None = None):
    """Wrap a freshly built chat adapter in a Brain backed by the shared store.

    The summarizer uses a *separate* adapter (BRAIN_SUMMARIZER). If that provider
    isn't configured, memory degrades gracefully to RAG-only (no summary/graph).
    """
    from brain import Brain, Summarizer

    adapter = build_adapter(pkey, anonymous, model)
    summarizer = None
    if BRAIN_AUTO_SUMMARY:
        try:
            summarizer = Summarizer(build_adapter(BRAIN_SUMMARIZER))
        except AuthMissing:
            summarizer = None

    return Brain(adapter, get_store(), get_embedder(),
                 thread_id or uuid.uuid4().hex, pkey,
                 summarizer=summarizer, auto_summary=BRAIN_AUTO_SUMMARY,
                 topk=BRAIN_TOPK, budget=BRAIN_CONTEXT_BUDGET,
                 chunk_chars=BRAIN_CHUNK_CHARS, chunk_overlap=BRAIN_CHUNK_OVERLAP,
                 chunk_breakpoint_type=BRAIN_CHUNK_BREAKPOINT_TYPE,
                 chunk_breakpoint_amount=BRAIN_CHUNK_BREAKPOINT_AMOUNT,
                 max_distance=BRAIN_MAX_DISTANCE)
