"""Static, per-run allowlist; model-supplied names and arguments never choose code."""
from __future__ import annotations

import asyncio
import re
import time
from collections.abc import Awaitable, Callable, Iterable
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .contracts import ToolContext, ToolResult, ToolRunBudget
from .web import FetchInput, SearchInput, fetch_page, search_web
from .local_search import (AttachmentReadInput, AttachmentSearchInput, MemoryInput,
                           memory_search, read_attached_file, search_attached_files)
from .analysis import CalculatorInput, CompareSourcesInput, calculator, compare_sources


class ToolNotFound(ValueError):
    pass


class ToolDenied(ValueError):
    pass


class ToolSpec(BaseModel):
    model_config = ConfigDict(extra='forbid', arbitrary_types_allowed=True)
    name: str
    input_model: type[BaseModel]
    handler: Callable[[ToolContext, BaseModel], Awaitable[ToolResult]]
    description: str = ''
    effect: Literal['local_read', 'external_read', 'write'] = 'external_read'
    approval: Literal['none', 'mode_selection', 'explicit_user_confirmation'] = 'mode_selection'
    timeout_seconds: float = Field(default=10, gt=0, le=90)
    max_output_bytes: int = Field(default=64 * 1024, ge=1, le=1024 * 1024)

    @model_validator(mode='after')
    def valid_name(self):
        if not re.fullmatch(r'[a-z][a-z0-9_]*', self.name):
            raise ValueError('invalid tool name')
        return self


class ToolRegistry:
    def __init__(self, specs: Iterable[ToolSpec]):
        definitions = list(specs)
        self._specs = {spec.name: spec for spec in definitions}
        if len(self._specs) != len(definitions):
            raise ValueError('duplicate tool name')

    def lookup(self, name: str) -> ToolSpec:
        try:
            return self._specs[name]
        except KeyError:
            raise ToolNotFound(name) from None

    async def run(self, name: str, args: dict, context: ToolContext,
                  budget: ToolRunBudget | None = None, call_id: str | None = None) -> ToolResult:
        spec = self.lookup(name)
        if name not in context.allowed_tools or (spec.effect == 'write' and
                (not call_id or call_id not in context.approved_calls)):
            raise ToolDenied('tool not authorized for this run')
        try:
            context.check()
            if budget is not None:
                budget.consume()
        except RuntimeError as e:
            raise ToolDenied(str(e)) from e
        params = spec.input_model.model_validate(args, extra='forbid')
        remaining = min(spec.timeout_seconds, context.deadline - time.monotonic())
        if remaining <= 0:
            raise ToolDenied('run deadline exceeded')
        work = asyncio.create_task(spec.handler(context, params))
        stopped = asyncio.create_task(context.cancelled.wait())
        try:
            done, _ = await asyncio.wait({work, stopped}, timeout=remaining,
                                         return_when=asyncio.FIRST_COMPLETED)
            if stopped in done or not done:
                raise ToolDenied('tool cancelled or timed out')
            result = await work
            if len(result.model_dump_json().encode('utf-8')) > spec.max_output_bytes:
                raise ToolDenied('tool output exceeds limit')
            return result
        finally:
            for task in (work, stopped):
                if not task.done():
                    task.cancel()
            await asyncio.gather(work, stopped, return_exceptions=True)


def default_registry() -> ToolRegistry:
    return ToolRegistry([
        ToolSpec(name='web_search', input_model=SearchInput, handler=search_web,
                 description='Search public web pages'),
        ToolSpec(name='fetch_page', input_model=FetchInput, handler=fetch_page,
                 description='Fetch only a search-result source ID', timeout_seconds=10),
        ToolSpec(name='memory_search', input_model=MemoryInput, handler=memory_search,
                 effect='local_read', description='Search only the current Brain thread'),
        ToolSpec(name='search_attached_files', input_model=AttachmentSearchInput,
                 handler=search_attached_files, effect='local_read',
                 description='Search text files selected for this turn'),
        ToolSpec(name='read_attached_file', input_model=AttachmentReadInput,
                 handler=read_attached_file, effect='local_read',
                 description='Read a bounded range of a selected text file'),
        ToolSpec(name='calculator', input_model=CalculatorInput, handler=calculator,
                 effect='local_read', description='Calculate basic decimal arithmetic'),
        ToolSpec(name='compare_sources', input_model=CompareSourcesInput,
                 handler=compare_sources, effect='local_read',
                 description='Compare excerpts from two or three issued public sources')
    ])
