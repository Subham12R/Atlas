"""Deterministic text-only routing. No classifier inference, tool grants, or cloud consent."""
from dataclasses import dataclass
import re
from urllib.parse import urlsplit

from policy import ExecutionMode, ExecutionPolicy, ModelCandidate, eligible_models


@dataclass(frozen=True)
class RouteDecision:
    state: str
    mode: ExecutionMode
    provider: str | None
    model: str | None
    reason: str


_SIGNALS = (
    (ExecutionMode.CODING, re.compile(r'\b(code|function|python|javascript|typescript|debug|bug|refactor|parser|script)\b', re.I)),
    (ExecutionMode.RESEARCH, re.compile(r'\b(research|sources?|studies|case law|evidence|investigate)\b', re.I)),
    (ExecutionMode.DOCUMENTATION, re.compile(r'\b(documentation|document|readme|guide|manual|explain|summary)\b', re.I)),
)


def is_loopback_endpoint(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == 'http' and parsed.hostname in {'127.0.0.1', 'localhost', '::1'}
                and not parsed.username and not parsed.password and parsed.port is not None)
    except ValueError:
        return False


def classify_mode(prompt: str, requested: ExecutionMode) -> tuple[ExecutionMode, bool]:
    requested = ExecutionMode(requested)
    if requested is not ExecutionMode.AUTO:
        return requested, False
    matched = [mode for mode, signal in _SIGNALS if signal.search(prompt)]
    if len(matched) == 1:
        return matched[0], False
    # ponytail: ambiguous text defaults to documentation; use reviewed fixtures before adding inference.
    return ExecutionMode.DOCUMENTATION, True


def choose_model(prompt: str, requested: ExecutionMode, candidates: list[ModelCandidate],
                 policy: ExecutionPolicy, preference: tuple[str, str] | None = None) -> RouteDecision:
    mode, uncertain = classify_mode(prompt, requested)
    eligible = eligible_models(mode, candidates, policy)
    if preference is not None:
        eligible = [c for c in eligible if (c.provider, c.model) == preference]
    if not eligible:
        return RouteDecision('no_eligible_model', mode, None, None,
                             'No permitted text model matches the mode and model preference')
    chosen = eligible[0]  # Stable catalog order; no unmeasured quality or price claims.
    reason = ('low confidence; documentation fallback' if uncertain else
              'explicit mode' if requested != ExecutionMode.AUTO else 'deterministic text classification')
    return RouteDecision('degraded' if uncertain else 'ready', mode,
                         chosen.provider, chosen.model, reason)
