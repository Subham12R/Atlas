"""
Provider factory -- the single place that knows how to build each adapter from
.env + a few options. The HTTP API (api.py) builds adapters through here, so
wiring lives in exactly one spot.
"""
import os
import threading
import uuid

from dotenv import load_dotenv

import credentials_store
from adapters import (AnthropicAdapter, CustomAdapter, GeminiAdapter, LocalAdapter,
                      OpenAIAdapter, OpenRouterAdapter)

load_dotenv()

DEBUG = bool(os.getenv("SB_DEBUG", "").strip())


def _flag(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip() not in ("", "0", "false", "False")


def _optional_float(name: str, default: str = "") -> float | None:
    """Read an optional float, treating a comment-only value as unset."""
    raw = os.getenv(name, default).partition("#")[0].strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError as exc:
        raise ValueError(f"{name} must be a number; got {raw!r}") from exc


BRAIN_ENABLED = _flag("BRAIN_ENABLED", "1")
BRAIN_DB_PATH = os.getenv("BRAIN_DB_PATH", "brain.db").strip()
# EmbeddingGemma 2 (Google, Oct 2026): on-device, 768-d, asymmetric query/document prompts.
# Any fastembed model also works, e.g. BRAIN_EMBED_MODEL=BAAI/bge-small-en-v1.5 BRAIN_EMBED_DIM=384.
BRAIN_EMBED_MODEL = os.getenv("BRAIN_EMBED_MODEL", "google/embeddinggemma-2").strip()
BRAIN_EMBED_DIM = int(os.getenv("BRAIN_EMBED_DIM", "768"))
# Empty = summarize with the chat's own cloud provider (no extra provider sees the chat);
# local chats skip enrichment so a local server isn't queued behind summary calls.
BRAIN_SUMMARIZER = os.getenv("BRAIN_SUMMARIZER", "").strip()
BRAIN_AUTO_SUMMARY = _flag("BRAIN_AUTO_SUMMARY", "1")
BRAIN_TOPK = int(os.getenv("BRAIN_TOPK", "6"))
BRAIN_CONTEXT_BUDGET = int(os.getenv("BRAIN_CONTEXT_BUDGET", "2000"))
BRAIN_CHUNK_CHARS = int(os.getenv("BRAIN_CHUNK_CHARS", "1000"))
BRAIN_CHUNK_OVERLAP = int(os.getenv("BRAIN_CHUNK_OVERLAP", "150"))
# Cosine-distance cutoffs are model-specific: each model spreads distances differently.
# (memory recall, document passages, entity-name matching)
# EmbeddingGemma 2 values come from a small labeled check: on-topic passages <= 0.356,
# off-topic >= 0.376; entity names: true matches 0.16-0.20, noise ~0.29.
_DISTANCES = {"google/embeddinggemma-2": ("0.36", "0.36", "0.24"),
              "BAAI/bge-small-en-v1.5": ("0.6", "0.6", "0.25")}
_default_distances = _DISTANCES.get(BRAIN_EMBED_MODEL, ("0.6", "0.6", "0.25"))
# Blank (as in .env.example) means the model's default.
BRAIN_MAX_DISTANCE = _optional_float("BRAIN_MAX_DISTANCE") or float(_default_distances[0])
BRAIN_DOC_MAX_DISTANCE = _optional_float("BRAIN_DOC_MAX_DISTANCE") or float(_default_distances[1])
BRAIN_ENTITY_DISTANCE = _optional_float("BRAIN_ENTITY_DISTANCE") or float(_default_distances[2])
# Indexed documents in chat answers (cited as [D1]...): passages per turn and their size.
BRAIN_DOCUMENTS = _flag("BRAIN_DOCUMENTS", "1")
BRAIN_DOC_TOPK = int(os.getenv("BRAIN_DOC_TOPK", "4"))
BRAIN_DOC_BUDGET = int(os.getenv("BRAIN_DOC_BUDGET", "6000"))

PROVIDERS = ["openai", "anthropic", "gemini", "openrouter", "custom", "local"]
ANON_OK: set[str] = set()

MODELS = {
    "openai": ["gpt-4o", "gpt-4o-mini", "o4-mini"],
    "anthropic": ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
    "gemini": ["gemini-2.5-pro", "gemini-2.5-flash"],
    "openrouter": [],
    "custom": [],
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

    if pkey == "custom":
        base_url = credentials_store.get_value("CUSTOM_BASE_URL")
        custom_model = model or credentials_store.get_value("CUSTOM_MODEL")
        if not base_url or not custom_model:
            raise AuthMissing("custom endpoint base URL and model not set")
        return CustomAdapter(base_url, custom_model,
                             api_key=credentials_store.get_value("CUSTOM_API_KEY") or None, debug=DEBUG)

    if pkey == "local":
        base_url = credentials_store.get_value("LOCAL_LLM_BASE_URL") or None
        local_model = model or credentials_store.get_value("LOCAL_LLM_MODEL") or None
        api_key = credentials_store.get_value("LOCAL_LLM_API_KEY") or None
        return LocalAdapter(base_url=base_url, model=local_model, api_key=api_key, debug=DEBUG)

    raise ValueError(f"unknown provider {pkey!r}")


_store = None
_embedder = None
# idle -> loading (may download the model once) -> ready | failed
_embedder_status = {"state": "idle", "model": BRAIN_EMBED_MODEL, "detail": ""}
_embedder_lock = threading.Lock()


def start_embedder() -> None:
    """Load the embedding model in the background. Chat never waits for it: until it
    is ready, recall uses keyword search and new text is embedded later by the backfill."""
    with _embedder_lock:
        if _embedder_status["state"] in ("loading", "ready"):
            return
        _embedder_status.update(state="loading", detail="")

    def load() -> None:
        global _embedder
        try:
            from brain import Embedder
            model = Embedder(BRAIN_EMBED_MODEL, BRAIN_EMBED_DIM)
            _embedder = model
            _embedder_status.update(state="ready", detail="")
        except Exception as exc:  # offline first run, disk full, ...: retried on next start
            _embedder_status.update(state="failed", detail=str(exc)[:300])

    threading.Thread(target=load, name="embedder-load", daemon=True).start()


def embedder_status() -> dict:
    return dict(_embedder_status)


def get_embedder():
    """The loaded embedding model, or None while it is loading (or failed to load)."""
    return _embedder


class _EmbedderHandle:
    """Lets a long-lived Brain pick up the model once it finishes loading."""

    def get(self):
        return get_embedder()


def get_store():
    global _store
    if _store is None:
        from brain import MemoryStore, connect
        _store = MemoryStore(connect(BRAIN_DB_PATH, BRAIN_EMBED_DIM, BRAIN_EMBED_MODEL))
    return _store


def build_brain(pkey: str, anonymous: bool = False, model: str | None = None,
                thread_id: str | None = None):
    """Wrap a freshly built chat adapter in a Brain backed by the shared store.

    The summarizer uses a *separate* adapter: BRAIN_SUMMARIZER when set, else the
    chat's own cloud provider. Otherwise memory degrades to RAG-only (no summary/graph).
    """
    from brain import Brain, Summarizer

    adapter = build_adapter(pkey, anonymous, model)
    summarizer = None
    summarizer_provider = BRAIN_SUMMARIZER or (pkey if pkey != "local" else "")
    if BRAIN_AUTO_SUMMARY and summarizer_provider:
        try:
            summarizer = Summarizer(build_adapter(
                summarizer_provider, model=model if summarizer_provider == pkey else None))
        except AuthMissing:
            summarizer = None

    return Brain(adapter, get_store(), _EmbedderHandle(),
                 thread_id or uuid.uuid4().hex, pkey,
                 summarizer=summarizer, auto_summary=BRAIN_AUTO_SUMMARY,
                 topk=BRAIN_TOPK, budget=BRAIN_CONTEXT_BUDGET,
                 chunk_chars=BRAIN_CHUNK_CHARS, chunk_overlap=BRAIN_CHUNK_OVERLAP,
                 max_distance=BRAIN_MAX_DISTANCE, documents=BRAIN_DOCUMENTS,
                 doc_k=BRAIN_DOC_TOPK, doc_budget=BRAIN_DOC_BUDGET,
                 doc_max_distance=BRAIN_DOC_MAX_DISTANCE,
                 entity_distance=BRAIN_ENTITY_DISTANCE)
