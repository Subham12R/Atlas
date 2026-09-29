"""Execution-mode decisions and model eligibility; no tools or provider calls."""

from dataclasses import dataclass
from enum import Enum


class ExecutionMode(str, Enum):
    AUTO = "auto"
    RESEARCH = "research"
    CODING = "coding"
    DOCUMENTATION = "documentation"


@dataclass(frozen=True)
class ModeDecision:
    requested_mode: ExecutionMode
    effective_mode: ExecutionMode | None


@dataclass(frozen=True)
class ModelCandidate:
    provider: str
    model: str
    capabilities: frozenset[str]
    is_local: bool


@dataclass(frozen=True)
class ExecutionPolicy:
    allow_cloud: bool = False
    allowed_tools: frozenset[str] = frozenset()


def resolve_explicit_mode(mode: ExecutionMode) -> ModeDecision:
    requested = ExecutionMode(mode)
    return ModeDecision(requested, None if requested is ExecutionMode.AUTO else requested)


def eligible_models(
    mode: ExecutionMode, candidates: list[ModelCandidate], policy: ExecutionPolicy
) -> list[ModelCandidate]:
    requested = ExecutionMode(mode)
    if requested is ExecutionMode.AUTO:
        return []  # Classification is not implemented; never route unresolved Auto.
    return [
        candidate for candidate in candidates
        if requested.value in candidate.capabilities and (candidate.is_local or policy.allow_cloud)
    ]
