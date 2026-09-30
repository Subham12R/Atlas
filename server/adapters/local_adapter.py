"""Local LLM adapter -- talks to any OpenAI-compatible local server (Ollama,
LM Studio, vLLM's OpenAI-compatible endpoint, ...). No API key required by
default since local servers are typically unauthenticated.
"""
from __future__ import annotations

from reasoning import local_effort

from .openai_adapter import OpenAIAdapter
from .base import AdapterCapabilities

DEFAULT_BASE_URL = "http://localhost:11434/v1"
DEFAULT_MODEL = "llama3.2"


class LocalAdapter(OpenAIAdapter):
    name = "local"
    # Local runtimes/models do not have a common verified function-call contract.
    capabilities = AdapterCapabilities()

    def __init__(self, base_url: str | None = None, model: str | None = None,
                 api_key: str | None = None, debug: bool = False):
        super().__init__(api_key or "not-needed", model or DEFAULT_MODEL,
                         base_url=base_url or DEFAULT_BASE_URL, debug=debug)

    def _reasoning_kwargs(self) -> dict:
        # Non-thinking local models may reject this; OpenAIAdapter._create retries without it.
        effort = local_effort(self.reasoning)
        return {'reasoning_effort': effort} if effort else {}
