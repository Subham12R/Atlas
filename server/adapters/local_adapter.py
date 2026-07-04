"""Local LLM adapter -- talks to any OpenAI-compatible local server (Ollama,
LM Studio, vLLM's OpenAI-compatible endpoint, ...). No API key required by
default since local servers are typically unauthenticated.
"""
from __future__ import annotations

from .openai_adapter import OpenAIAdapter

DEFAULT_BASE_URL = "http://localhost:11434/v1"  # Ollama's OpenAI-compatible endpoint
DEFAULT_MODEL = "llama3.2"


class LocalAdapter(OpenAIAdapter):
    name = "local"

    def __init__(self, base_url: str | None = None, model: str | None = None,
                 api_key: str | None = None, debug: bool = False):
        super().__init__(api_key or "not-needed", model or DEFAULT_MODEL,
                         base_url=base_url or DEFAULT_BASE_URL, debug=debug)
