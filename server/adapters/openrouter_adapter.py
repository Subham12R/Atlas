"""OpenRouter adapter -- OpenRouter exposes an OpenAI-compatible API, so this
just points the OpenAI SDK client at OpenRouter's base URL instead of
reimplementing a client.
"""
from __future__ import annotations

from .openai_adapter import OpenAIAdapter

BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-4o"


class OpenRouterAdapter(OpenAIAdapter):
    name = "openrouter"

    def __init__(self, api_key: str, model: str | None = None, debug: bool = False):
        super().__init__(api_key, model or DEFAULT_MODEL, base_url=BASE_URL, debug=debug)
