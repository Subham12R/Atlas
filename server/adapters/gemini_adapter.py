"""Gemini adapter -- wraps Google's official `google-genai` Python SDK."""
from __future__ import annotations

import base64

from google import genai
from google.genai import types

from .base import BaseAdapter, ImageInput, Reply

DEFAULT_MODEL = "gemini-2.5-flash"


def _content(prompt: str, images: list[ImageInput] | None):
    """Plain string when there's no image, else a list of Parts (image parts
    plus the text prompt) -- what `send_message` expects for multimodal input."""
    if not images:
        return prompt
    parts = [types.Part.from_bytes(data=base64.b64decode(img.data), mime_type=img.mime)
             for img in images]
    parts.append(prompt)
    return parts


class GeminiAdapter(BaseAdapter):
    name = "gemini"

    def __init__(self, api_key: str, model: str | None = None, debug: bool = False):
        self.model = model or DEFAULT_MODEL
        self._client = genai.Client(api_key=api_key)
        self._chat = self._client.aio.chats.create(model=self.model)
        self.debug = debug

    async def init(self) -> None:
        pass

    async def send(self, prompt: str, images: list[ImageInput] | None = None) -> Reply:
        resp = await self._chat.send_message(_content(prompt, images))
        text = resp.text or ""
        return Reply(text=text, provider=self.name, meta={"model": self.model})

    async def send_stream(self, prompt: str, images: list[ImageInput] | None = None):
        resp = await self._chat.send_message_stream(_content(prompt, images))
        async for chunk in resp:
            text = chunk.text or ""
            if text:
                yield text

    async def close(self) -> None:
        pass  # no persistent connection to release

    async def new_chat(self) -> None:
        self._chat = self._client.aio.chats.create(model=self.model)
