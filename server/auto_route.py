"""Auto turn policy on top of routing.choose_model: model, tool, and reasoning level.

Deterministic and explainable like routing.py -- text signals only, no classifier
calls. Cloud eligibility is decided by the caller's candidates and policy.
"""
import re

from policy import ExecutionMode, ExecutionPolicy, ModelCandidate
from reasoning import auto_level
from routing import choose_model

# Signals that an answer depends on information newer than the model's training data.
_WEB = re.compile(
    r'https?://|\b(latest|today|tonight|yesterday|this (?:week|month|year)|right now|currently|'
    r'news|headlines|price of|stock price|weather|search (?:the )?(?:web|online|internet)|'
    r'look (?:it |this |that )?up|google|browse|'
    r'who (?:is|was|are|were) \w|tell me about \w|(?:info|information|details|background) (?:on|about) \w|'
    r'(?:ceo|founder|president|owner|headquarters) of|release date|exchange rate|score of|'
    r'(?:latest|newest|recent) (?:version|release|update))\b|https?://', re.I)

# Explicit agent tools imply the text mode used to pick a model for them.
_AGENT_MODE_INTENT = {'search_web': ExecutionMode.RESEARCH, 'research': ExecutionMode.RESEARCH,
                      'tools': ExecutionMode.RESEARCH, 'write': ExecutionMode.CODING,
                      'plan': ExecutionMode.DOCUMENTATION, 'draft': ExecutionMode.DOCUMENTATION}


def needs_web(prompt: str) -> bool:
    return bool(_WEB.search(prompt))


def route_turn(prompt: str, mode: ExecutionMode, agent_mode: str,
               candidates: list[ModelCandidate], policy: ExecutionPolicy,
               preference: tuple[str, str] | None, ceiling: str, search_key: bool, follows_search: bool = False) -> dict:
    requested = _AGENT_MODE_INTENT.get(agent_mode, ExecutionMode(mode))
    pool = [c for c in candidates if 'tools' in c.capabilities] if agent_mode == 'tools' else candidates
    # A user-picked model gets the exact reasoning level; Auto treats it as a ceiling.
    explicit_model = preference is not None
    if preference and not preference[1]:  # A provider without a model means its default.
        pool = [c for c in pool if c.provider == preference[0]]
        preference = None
    decision = choose_model(prompt, requested, pool, policy, preference)
    chosen = next((c for c in pool if (c.provider, c.model) == (decision.provider, decision.model)), None)

    web = agent_mode == 'chat' and ExecutionMode(mode) is ExecutionMode.AUTO and (
        needs_web(prompt) or follows_search)
    tool, state, reason = None, decision.state, decision.reason
    if web and chosen:
        if not search_key:
            state, reason = 'degraded', reason + '; needs current web info but no search key is set'
        else:
            # Always the search pipeline: it works with any text model, rewrites follow-ups from
            # the chat, and keeps memory out of public queries. 'safeTools' runs with chat memory
            # attached lose their web tools by design, so Auto could never actually search there.
            tool = 'searchWeb'
            reason += '; needs current web info'

    level = ceiling if explicit_model else auto_level(
        decision.mode, ceiling, decision.state == 'degraded', web)
    return {'state': state, 'mode': decision.mode, 'provider': decision.provider,
            'model': decision.model, 'reason': reason, 'tool': tool,
            'reasoning': level if decision.provider else None}
