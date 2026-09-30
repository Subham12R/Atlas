"""OpenRouter adapter -- OpenRouter exposes an OpenAI-compatible API, so this
just points the OpenAI SDK client at OpenRouter's base URL instead of
reimplementing a client.
"""
from __future__ import annotations

from reasoning import openrouter_reasoning

from .openai_adapter import OpenAIAdapter
from .base import AdapterCapabilities

BASE_URL = "https://openrouter.ai/api/v1"
DEFAULT_MODEL = "openai/gpt-4o"


class OpenRouterAdapter(OpenAIAdapter):
    name = "openrouter"
    # Tool support varies per routed model; do not infer it from the API shape.
    capabilities = AdapterCapabilities()

    def __init__(self, api_key: str, model: str | None = None, debug: bool = False):
        super().__init__(api_key, model or DEFAULT_MODEL, base_url=BASE_URL, debug=debug)

    def _reasoning_kwargs(self) -> dict:
        # OpenRouter normalizes one `reasoning` object across the models it routes to.
        reasoning = openrouter_reasoning(self.reasoning)
        return {'extra_body': {'reasoning': reasoning}} if reasoning else {}
