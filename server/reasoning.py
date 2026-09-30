"""Reasoning-effort levels and their per-provider request parameters.

One user-facing scale (off/low/medium/high/max) is translated here into each
provider's native control, so adapters never guess. Unknown model families
get no parameter at all rather than a value the API might reject.
"""
import re
from typing import Literal

from policy import ExecutionMode

ReasoningLevel = Literal['off', 'low', 'medium', 'high', 'max']
LEVELS: tuple[str, ...] = ('off', 'low', 'medium', 'high', 'max')

# Auto picks the level from the routed mode; the user's slider is a ceiling.
_MODE_DEFAULT = {ExecutionMode.DOCUMENTATION: 'low', ExecutionMode.CODING: 'medium',
                 ExecutionMode.RESEARCH: 'high'}


def auto_level(mode: ExecutionMode, ceiling: str, uncertain: bool, web: bool) -> str:
    wanted = 'low' if uncertain or web else _MODE_DEFAULT.get(mode, 'low')
    return LEVELS[min(LEVELS.index(wanted), LEVELS.index(ceiling))]


_OPENAI_REASONING = re.compile(r'^(o\d|gpt-5|gpt-6)', re.I)
_OPENAI_CAN_DISABLE = re.compile(r'^(gpt-5\.[1-9]|gpt-6)', re.I)


def openai_effort(model: str, level: str | None) -> str | None:
    """`reasoning_effort` for OpenAI reasoning models; None for models (gpt-4o) that reject it."""
    if not level or not _OPENAI_REASONING.match(model):
        return None
    if level == 'off':
        # Older reasoning models cannot disable reasoning; low is the closest honest value.
        return 'none' if _OPENAI_CAN_DISABLE.match(model) else 'low'
    # ponytail: max maps to high; use xhigh/max once per-model support is catalogued.
    return 'high' if level == 'max' else level


def local_effort(level: str | None) -> str | None:
    """OpenAI-compatible local servers (Ollama, LM Studio, vLLM) accept `reasoning_effort`."""
    if not level:
        return None
    return {'off': 'none', 'max': 'high'}.get(level, level)


def openrouter_reasoning(level: str | None) -> dict | None:
    if not level:
        return None
    return {'effort': {'off': 'none', 'max': 'xhigh'}.get(level, level), 'exclude': True}


# Anthropic extended thinking. Totals stay under the SDK's non-streaming limit.
_ANTHROPIC_BUDGET = {'low': 2048, 'medium': 4096, 'high': 8192, 'max': 16000}


def anthropic_thinking(level: str | None) -> int | None:
    return _ANTHROPIC_BUDGET.get(level or 'off')


_GEMINI_FLASH_BUDGET = {'off': 0, 'low': 1024, 'medium': 4096, 'high': 12288, 'max': 24576}
_GEMINI_PRO_BUDGET = {'off': 128, 'low': 1024, 'medium': 4096, 'high': 16384, 'max': 32768}


def gemini_thinking(model: str, level: str | None) -> dict | None:
    """ThinkingConfig kwargs; 2.5 Pro cannot disable thinking, so off is its minimum."""
    if not level:
        return None
    # include_thoughts returns thought summaries so the app can show what the model considered.
    if model.startswith('gemini-2.5-pro'):
        return {'thinking_budget': _GEMINI_PRO_BUDGET[level], 'include_thoughts': True}
    if model.startswith('gemini-2.5'):
        budget = _GEMINI_FLASH_BUDGET[level]
        return {'thinking_budget': budget, 'include_thoughts': budget > 0}
    if model.startswith('gemini-3'):
        return {'thinking_level': 'low' if level in ('off', 'low') else 'high', 'include_thoughts': True}
    return None
