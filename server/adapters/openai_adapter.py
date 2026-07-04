"""OpenAI adapter -- wraps the official `openai` Python SDK.

Chat completions are stateless per call, so multi-turn context is kept as a
plain in-memory message list, same as every other adapter in this codebase
keeps its own conversation handle.
"""
from __future__ import annotations

from openai import AsyncOpenAI

from .base import BaseAdapter, ImageInput, Reply

DEFAULT_MODEL = "gpt-4o"


def _content(prompt: str, images: list[ImageInput] | None):
    """Plain string when there's no image, else OpenAI's multi-part content
    shape (a vision-capable model reads the image parts directly)."""
    if not images:
        return prompt
    parts: list[dict] = [{"type": "text", "text": prompt}]
    for img in images:
        parts.append({"type": "image_url",
                      "image_url": {"url": f"data:{img.mime};base64,{img.data}"}})
    return parts


class OpenAIAdapter(BaseAdapter):
    name = "openai"

    def __init__(self, api_key: str, model: str | None = None,
                 base_url: str | None = None, debug: bool = False):
        self.model = model or DEFAULT_MODEL
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._messages: list[dict] = []
        self.debug = debug

    async def init(self) -> None:
        pass

    async def send(self, prompt: str, images: list[ImageInput] | None = None) -> Reply:
        self._messages.append({"role": "user", "content": _content(prompt, images)})
        resp = await self._client.chat.completions.create(
            model=self.model, messages=self._messages,
        )
        text = resp.choices[0].message.content or ""
        self._messages.append({"role": "assistant", "content": text})
        return Reply(text=text, provider=self.name,
                     meta={"model": resp.model,
                           "usage": resp.usage.model_dump() if resp.usage else None})

    async def send_stream(self, prompt: str, images: list[ImageInput] | None = None):
        self._messages.append({"role": "user", "content": _content(prompt, images)})
        resp = await self._client.chat.completions.create(
            model=self.model, messages=self._messages, stream=True
        )
        text_chunks = []
        async for chunk in resp:
            content = chunk.choices[0].delta.content or ""
            if content:
                text_chunks.append(content)
                yield content
        
        full_text = "".join(text_chunks)
        self._messages.append({"role": "assistant", "content": full_text})

    async def close(self) -> None:
        await self._client.close()

    async def new_chat(self) -> None:
        self._messages = []
