"""
Image generation -- a separate concern from chat: no conversation state, just
prompt -> image(s). Only providers with a real image-gen API are wired up
here (see factory.IMAGE_GEN_PROVIDERS).
"""
from __future__ import annotations

import base64

from google import genai
from openai import AsyncOpenAI


async def generate_openai_image(api_key: str, prompt: str, model: str) -> list[dict]:
    client = AsyncOpenAI(api_key=api_key)
    try:
        resp = await client.images.generate(model=model, prompt=prompt, n=1)
    finally:
        await client.close()
    images = []
    for d in resp.data:
        if d.b64_json:
            images.append({"data": d.b64_json, "mime": "image/png"})
        elif d.url:
            images.append({"url": d.url})
    return images


async def generate_gemini_image(api_key: str, prompt: str, model: str) -> list[dict]:
    client = genai.Client(api_key=api_key)
    resp = await client.aio.models.generate_images(model=model, prompt=prompt)
    return [{"data": base64.b64encode(gi.image.image_bytes).decode(), "mime": "image/png"}
            for gi in resp.generated_images]
