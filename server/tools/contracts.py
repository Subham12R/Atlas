"""Validated agent-run inputs and bounded tool output. Never serialize ToolContext to a model."""
from __future__ import annotations

import asyncio
import time
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RecentTurn(StrictModel):
    role: Literal['user', 'assistant']
    content: str = Field(max_length=8000)


class TextAttachment(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=255)
    mime: str = Field(max_length=100)
    content: str = Field(max_length=5 * 1024 * 1024)


class ImagePart(StrictModel):
    data: str = Field(min_length=1, max_length=7 * 1024 * 1024)
    mime: Literal['image/png', 'image/jpeg', 'image/webp', 'image/gif']


class AgentTurnRequest(StrictModel):
    prompt: str = Field(min_length=1, max_length=10000)
    mode: Literal['chat', 'search_web', 'research', 'plan', 'write', 'draft', 'tools'] = 'chat'
    draft_kind: Literal['research_brief', 'comparison', 'decision_memo', 'readme'] = 'research_brief'
    instructions: str = Field(default='', max_length=4000)
    images: list[ImagePart] | None = Field(default=None, max_length=4)
    recent: list[RecentTurn] = Field(default_factory=list, max_length=4)
    attachments: list[TextAttachment] = Field(default_factory=list, max_length=5)

    @model_validator(mode='after')
    def bounded_context(self):
        if not self.prompt.strip() or sum(len(m.content) for m in self.recent) > 8000:
            raise ValueError('empty prompt or conversation too long')
        if self.mode == 'search_web' and len(self.prompt) > 1000:
            raise ValueError('search query too long')
        if self.mode == 'tools' and self.images:
            raise ValueError('safe tool runs do not accept image payloads')
        extensions = ('.md', '.txt', '.csv', '.json', '.log', '.yaml', '.yml', '.py', '.js',
                      '.jsx', '.ts', '.tsx', '.html', '.css', '.sql', '.java', '.c', '.cpp',
                      '.go', '.rs', '.sh')
        if any('/' in a.name or '\\' in a.name or a.name in ('.', '..') or
               not (a.name.lower().endswith(extensions) or a.mime.startswith('text/') or
                    a.mime == 'application/json') for a in self.attachments):
            raise ValueError('unsupported attachment name or type')
        if len({a.id for a in self.attachments}) != len(self.attachments):
            raise ValueError('duplicate attachment ID')
        sizes = [len(a.content.encode('utf-8')) for a in self.attachments]
        if any(size > 5 * 1024 * 1024 for size in sizes) or sum(sizes) > 10 * 1024 * 1024:
            raise ValueError('attachments too large')
        if sum(len(image.data) for image in self.images or []) > 20 * 1024 * 1024:
            raise ValueError('image payload too large')
        return self


class SourceEvent(StrictModel):
    source_id: str = Field(min_length=2, max_length=20)
    title: str = Field(default='', max_length=500)
    url: str = Field(min_length=1, max_length=2048)
    final_url: str | None = Field(default=None, max_length=2048)
    host: str = Field(default='', max_length=255)
    published_date: str | None = Field(default=None, max_length=100)
    score: float | None = Field(default=None, allow_inf_nan=False)
    snippet: str = Field(default='', max_length=2000)
    fetched: bool | None = None
    query: str | None = Field(default=None, max_length=1000)
    query_id: int | None = Field(default=None, ge=1, le=3)
    provider: str | None = Field(default=None, max_length=40)


class AttachmentEvent(StrictModel):
    source_id: str = Field(pattern=r'^A[1-9][0-9]*$')
    filename: str = Field(min_length=1, max_length=255)
    section: str = Field(min_length=1, max_length=100)
    attachment_id: str | None = Field(default=None, max_length=100)


class DraftEvent(StrictModel):
    id: str = Field(pattern=r'^[a-f0-9]{32}$')
    filename: str = Field(min_length=1, max_length=120)
    kind: Literal['research_brief', 'comparison', 'decision_memo', 'readme']


class RunStarted(StrictModel):
    type: Literal['run.started']
    run_id: str | None = None
    mode: str | None = None


class PlanReady(StrictModel):
    type: Literal['plan.ready']
    run_id: str | None = None
    queries: list[str] = Field(min_length=1, max_length=3)
    objective: str = Field(max_length=300)
    freshness: str | None = Field(default=None, max_length=100)
    source_criteria: list[str] = Field(default_factory=list, max_length=3)


class PlanDegraded(StrictModel):
    type: Literal['plan.degraded']
    run_id: str | None = None
    reason: str = Field(max_length=200)


class ToolStarted(StrictModel):
    type: Literal['tool.started']
    run_id: str | None = None
    tool: str = Field(min_length=1, max_length=100)
    call_id: str | None = Field(default=None, max_length=200)
    source_id: str | None = Field(default=None, max_length=20)
    query: str | None = Field(default=None, max_length=1000)


class ToolCompleted(StrictModel):
    type: Literal['tool.completed']
    run_id: str | None = None
    tool: str = Field(min_length=1, max_length=100)
    call_id: str | None = Field(default=None, max_length=200)
    source_id: str | None = Field(default=None, max_length=20)


class ToolFailed(StrictModel):
    type: Literal['tool.failed']
    run_id: str | None = None
    tool: str = Field(min_length=1, max_length=100)
    call_id: str | None = Field(default=None, max_length=200)
    source_id: str | None = Field(default=None, max_length=20)
    query: str | None = Field(default=None, max_length=1000)
    reason: str = Field(max_length=200)


class ToolProgress(StrictModel):
    type: Literal['tool.progress']
    run_id: str | None = None
    phase: str = Field(min_length=1, max_length=200)


class SourceFound(StrictModel):
    type: Literal['source.found']
    run_id: str | None = None
    source: SourceEvent


class AttachmentFound(StrictModel):
    type: Literal['attachment.found']
    run_id: str | None = None
    attachment: AttachmentEvent


class ApprovalRequired(StrictModel):
    type: Literal['approval.required']
    run_id: str | None = None
    call_id: str = Field(min_length=1, max_length=200)


class AssistantDelta(StrictModel):
    type: Literal['assistant.delta']
    run_id: str | None = None
    text: str = Field(max_length=100000)


class RunCompleted(StrictModel):
    type: Literal['run.completed']
    run_id: str | None = None
    status: Literal['completed', 'partial']
    reason: str | None = Field(default=None, max_length=200)
    sources: list[SourceEvent] = Field(default_factory=list, max_length=12)
    attachments: list[AttachmentEvent] = Field(default_factory=list, max_length=5)
    queries: list[str] = Field(default_factory=list, max_length=3)
    draft: DraftEvent | None = None


class RunFailed(StrictModel):
    type: Literal['run.failed']
    run_id: str | None = None
    code: Literal['unsupported_model', 'key_unavailable', 'timeout', 'budget',
                  'invalid_call', 'provider_unavailable', 'internal'] = 'internal'
    phase: str | None = Field(default=None, max_length=100)
    reason: str = Field(max_length=500)


class RunCancelled(StrictModel):
    type: Literal['run.cancelled']
    run_id: str | None = None
    reason: str | None = Field(default=None, max_length=200)


AgentEvent = Annotated[Union[RunStarted, PlanReady, PlanDegraded, ToolStarted,
                             ToolCompleted, ToolFailed, ToolProgress, SourceFound,
                             AttachmentFound, ApprovalRequired, AssistantDelta,
                             RunCompleted, RunFailed, RunCancelled], Field(discriminator='type')]
AgentEventAdapter = TypeAdapter(AgentEvent)


class ToolContext(StrictModel):
    model_config = ConfigDict(extra='forbid', arbitrary_types_allowed=True)
    run_id: str
    session_id: str | None = None
    thread_id: str | None = None
    allowed_tools: frozenset[str]
    deadline: float
    cancelled: asyncio.Event = Field(exclude=True)
    attachments: dict[str, TextAttachment] = Field(default_factory=dict, exclude=True)
    sources: dict[str, dict] = Field(default_factory=dict, exclude=True)
    approved_calls: frozenset[str] = frozenset()
    attachment_source_counter: int = 0
    degraded_reason: str | None = None

    def next_attachment_source_id(self) -> str:
        self.attachment_source_counter += 1
        return f'A{self.attachment_source_counter}'

    def check(self) -> None:
        if self.cancelled.is_set() or time.monotonic() >= self.deadline:
            raise RuntimeError('run cancelled or expired')


class ToolResult(StrictModel):
    summary: str = Field(max_length=2000)
    data: dict = Field(default_factory=dict)
    source_ids: list[str] = Field(default_factory=list)
    untrusted: bool = False


class ToolRunBudget(StrictModel):
    max_calls: int = Field(default=6, ge=1, le=6)
    max_rounds: int = Field(default=4, ge=1, le=4)
    calls: int = 0
    rounds: int = 0

    def consume(self) -> None:
        if self.calls >= self.max_calls:
            raise RuntimeError('tool call budget exhausted')
        self.calls += 1
