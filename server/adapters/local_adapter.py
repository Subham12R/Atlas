"""Local LLM adapter -- talks to any OpenAI-compatible local server (Ollama,
LM Studio, vLLM's OpenAI-compatible endpoint, ...). No API key required by
default since local servers are typically unauthenticated.
"""
from __future__ import annotations

from budget import local_max_tokens, local_num_ctx
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

    def _generation_kwargs(self) -> dict:
        # Bounded output and mild repetition control keep small models from looping. Ollama gets
        # its context size from OLLAMA_CONTEXT_LENGTH (set when Atlas starts it); the options
        # below also apply for Ollama servers that honor them. Other servers ignore extras.
        kwargs = {'max_tokens': local_max_tokens(), 'temperature': 0.4}
        if ':11434' in str(self._client.base_url):
            kwargs['extra_body'] = {'options': {'num_ctx': local_num_ctx(), 'repeat_penalty': 1.15}}
        return kwargs
