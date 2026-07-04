"""
The adapter contract.

Every LLM provider -- pure-request (Gemini) or browser-backed (ChatGPT) --
implements this same interface, so the orchestrator never cares which one it's
talking to. Add a provider = add a new subclass, nothing else changes.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class Reply:
    """A normalized response, identical shape across all providers."""
    text: str
    provider: str
    meta: dict = field(default_factory=dict)


@dataclass
class ImageInput:
    """A single image attached to a prompt -- base64-encoded, no data: prefix."""
    data: str
    mime: str


class BaseAdapter(ABC):
    name: str = "base"

    @abstractmethod
    async def init(self) -> None:
        """Authenticate / open the session. Call once before send()."""

    @abstractmethod
    async def send(self, prompt: str, images: list[ImageInput] | None = None) -> Reply:
      """Send a prompt (plus optional images for vision-capable models),
      return the full reply. Keeps multi-turn context."""

    @abstractmethod
    async def send_stream(self, prompt: str, images: list[ImageInput] | None = None):
      """Send a prompt, yielding tokens (strings) as they arrive.
      Keeps multi-turn context."""

    @abstractmethod
    async def close(self) -> None:
        """Release resources (browser, http client, etc.)."""

    async def new_chat(self) -> None:
        """Start a fresh conversation (drop context)."""
        raise NotImplementedError

    async def __aenter__(self):
        await self.init()
        return self

    async def __aexit__(self, *exc):
        await self.close()
