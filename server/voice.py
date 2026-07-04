"""
Voice-typing transcription -- backed by Groq's Whisper API
(https://console.groq.com/docs/speech-to-text), which serves whisper-large-v3-turbo
over an OpenAI-compatible multipart endpoint.
"""
from __future__ import annotations

import base64

import httpx

_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
_MODEL = "whisper-large-v3-turbo"


async def transcribe(api_key: str, audio_b64: str, mime: str) -> str:
    audio_bytes = base64.b64decode(audio_b64)
    ext = mime.split("/")[-1].split(";")[0] or "webm"

    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(
            _URL,
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": _MODEL},
            files={"file": (f"audio.{ext}", audio_bytes, mime)},
        )
        resp.raise_for_status()
        return resp.json()["text"]
