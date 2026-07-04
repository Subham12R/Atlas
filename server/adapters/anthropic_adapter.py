"""Anthropic adapter -- wraps the official `anthropic` Python SDK."""
from __future__ import annotations

from anthropic import AsyncAnthropic

from .base import BaseAdapter, ImageInput, Reply

DEFAULT_MODEL = "claude-sonnet-4-5"
MAX_TOKENS = 4096


def _content(prompt: str, images: list[ImageInput] | None):
    """Plain string when there's no image, else Anthropic's content-block
    shape (images before the text block, as Anthropic's docs recommend)."""
    if not images:
        return prompt
    parts: list[dict] = [
        {"type": "image", "source": {"type": "base64", "media_type": img.mime, "data": img.data}}
        for img in images
    ]
    parts.append({"type": "text", "text": prompt})
    return parts


class AnthropicAdapter(BaseAdapter):
    name = "anthropic"

    def __init__(self, api_key: str, model: str | None = None, debug: bool = False):
        self.model = model or DEFAULT_MODEL
        self._client = AsyncAnthropic(api_key=api_key)
        self._messages: list[dict] = []
        self.debug = debug

    async def init(self) -> None:
        pass

    async def send(self, prompt: str, images: list[ImageInput] | None = None) -> Reply:
        self._messages.append({"role": "user", "content": _content(prompt, images)})
        resp = await self._client.messages.create(
            model=self.model, max_tokens=MAX_TOKENS, messages=self._messages,
        )
        text = "".join(block.text for block in resp.content if block.type == "text")
        self._messages.append({"role": "assistant", "content": text})
        return Reply(text=text, provider=self.name,
                     meta={"model": resp.model, "stop_reason": resp.stop_reason})

    async def send_stream(self, prompt: str, images: list[ImageInput] | None = None):
        self._messages.append({"role": "user", "content": _content(prompt, images)})
        async with self._client.messages.stream(
            model=self.model, max_tokens=MAX_TOKENS, messages=self._messages
        ) as stream:
            async for text in stream.text_stream:
                yield text
        final_message = await stream.get_final_message()
        final_text = "".join(block.text for block in final_message.content if block.type == "text")
        self._messages.append({"role": "assistant", "content": final_text})

    async def close(self) -> None:
        await self._client.close()

    async def new_chat(self) -> None:
        self._messages = []
