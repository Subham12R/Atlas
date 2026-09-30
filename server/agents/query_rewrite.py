"""Turn a fragment follow-up ("from adamas university") into a standalone public search query.

Only visible chat turns are used. Private memory and attachments never reach this step.
"""
from __future__ import annotations

import asyncio
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from factory import build_adapter

# Follow-ups that lean on the previous turn: short prompts, or ones that open with a
# preposition/conjunction/pointer rather than a full question.
_FRAGMENT = re.compile(
    r'^\s*(?:from|at|in|of|on|for|with|and|or|also|but|what about|how about|the|that|this|those|'
    r'these|he|she|they|it|same|more|another|other|which)\b', re.I)
_MAX_WORDS = 8


class Rewrite(BaseModel):
    model_config = ConfigDict(extra='ignore')
    query: str = Field(min_length=1, max_length=200)
    confident: bool = True
    question: str | None = Field(default=None, max_length=300)


def needs_rewrite(prompt: str, recent: list) -> bool:
    if not any(turn.role == 'user' for turn in recent):
        return False
    return len(prompt.split()) <= _MAX_WORDS or bool(_FRAGMENT.match(prompt))


def _transcript(recent: list) -> str:
    lines = []
    for turn in recent[-4:]:
        text = ' '.join(turn.content.split())
        lines.append(f'{turn.role}: {text[:300]}')
    return '\n'.join(lines)


def heuristic_query(prompt: str, recent: list) -> str:
    """No model available: prepend the previous user question so the subject is not lost."""
    previous = next((t.content for t in reversed(recent) if t.role == 'user'), '')
    return f'{previous.strip()} {prompt.strip()}'.strip()[:200]


async def rewrite_query(prompt: str, recent: list, provider: str, model: str | None,
                        timeout: float = 20) -> Rewrite:
    """Standalone query plus a confidence flag. Never raises: falls back to a heuristic."""
    fallback = Rewrite(query=heuristic_query(prompt, recent))
    adapter = build_adapter(provider, model=model)
    try:
        await adapter.init()
        # A short JSON rewrite needs no deliberation; thinking models stall on it.
        adapter.reasoning = 'off'
        reply = await asyncio.wait_for(adapter.send(
            'Rewrite the latest user message as ONE standalone public web search query, using the '
            'conversation only to fill in what it refers to (keep full names, organizations, places). '
            'Do not answer it. Return ONLY JSON: {"query": string, "confident": boolean, '
            '"question": string or null}. Set confident=false and give a short clarifying question '
            'only if the conversation leaves it unclear who or what is meant.\n'
            f'Conversation:\n{_transcript(recent)}\nLatest message: {prompt}'), timeout=timeout)
        from .research import parse_model_json
        rewrite = Rewrite.model_validate(parse_model_json(reply.text, Rewrite))
        if not rewrite.confident and not rewrite.question:
            return fallback
        return rewrite
    except asyncio.CancelledError:
        raise
    except Exception:
        return fallback
    finally:
        try:
            await adapter.close()
        except Exception:
            pass
