"""Token-ish budgeting so small local context windows never silently drop instructions."""
from __future__ import annotations

import os

CHARS_PER_TOKEN = 3.5


def local_num_ctx() -> int:
    try:
        return min(131072, max(2048, int(os.environ.get('ATLAS_LOCAL_NUM_CTX', '8192'))))
    except ValueError:
        return 8192


def local_max_tokens() -> int:
    try:
        return min(16384, max(256, int(os.environ.get('ATLAS_LOCAL_MAX_TOKENS', '4096'))))
    except ValueError:
        return 4096


def char_budget(num_ctx: int, reserve_tokens: int) -> int:
    """Characters available for the prompt after reserving room for the reply."""
    return max(1000, int((num_ctx - reserve_tokens) * CHARS_PER_TOKEN))


def fit_history(turns: list, limit: int) -> list:
    """Newest turns that fit in `limit` characters (oldest dropped first, never cut mid-turn)."""
    kept, used = [], 0
    for turn in reversed(turns):
        used += len(turn.content)
        if used > limit and kept:
            break
        kept.append(turn)
    return kept[::-1]


def fit_items(items: list[str], limit: int) -> list[str]:
    """Leading items that fit in `limit` characters; an item is never cut in half."""
    kept, used = [], 0
    for item in items:
        used += len(item) + 1
        if used > limit and kept:
            break
        kept.append(item)
    return kept
