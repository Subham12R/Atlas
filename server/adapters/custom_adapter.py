"""Custom cloud adapter -- any hosted OpenAI-compatible API (Together, Groq, DeepSeek,
Fireworks, Mistral, a gateway, or a model server on another machine). The user
supplies the base URL, model, and key; nothing is assumed about the provider.
"""
from __future__ import annotations

from reasoning import local_effort

from .openai_adapter import OpenAIAdapter
from .base import AdapterCapabilities


class CustomAdapter(OpenAIAdapter):
    name = "custom"
    # Unknown provider/model: no verified tool-call contract.
    capabilities = AdapterCapabilities()

    def __init__(self, base_url: str, model: str, api_key: str | None = None,
                 debug: bool = False):
        super().__init__(api_key or "not-needed", model, base_url=base_url, debug=debug)

    def _reasoning_kwargs(self) -> dict:
        # The common OpenAI-compatible control; OpenAIAdapter._create retries without it
        # when an endpoint or model rejects the parameter.
        effort = local_effort(self.reasoning)
        return {'reasoning_effort': effort} if effort else {}
