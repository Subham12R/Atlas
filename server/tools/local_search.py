"""Read only the selected turn's files or the active Brain thread."""
from __future__ import annotations

from pydantic import BaseModel, Field

from .contracts import ToolContext, ToolResult


class MemoryInput(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    top_k: int = Field(default=5, ge=1, le=5)


class AttachmentSearchInput(BaseModel):
    attachment_ids: list[str] = Field(min_length=1, max_length=5)
    query: str = Field(min_length=1, max_length=200)


class AttachmentReadInput(BaseModel):
    attachment_id: str
    start: int = Field(default=0, ge=0)
    length: int = Field(default=2000, ge=1, le=4000)


async def memory_search(context: ToolContext, params: MemoryInput) -> ToolResult:
    import factory
    if not factory.BRAIN_ENABLED or not context.thread_id:
        return ToolResult(summary='Brain memory unavailable', data={'hits': [], 'unavailable': True})
    embedding = factory.get_embedder().embed_one(params.query)
    hits = factory.get_store().search(embedding, k=params.top_k,
                                      scope_thread_id=context.thread_id)
    return ToolResult(summary=f'{len(hits)} local memory hits', data={
        'hits': [{'text': text[:1500], 'thread_id': thread_id, 'distance': distance}
                 for text, thread_id, distance in hits]
    })


async def search_attached_files(context: ToolContext, params: AttachmentSearchInput) -> ToolResult:
    if any(identifier not in context.attachments for identifier in params.attachment_ids):
        raise ValueError('attachment not selected for this run')
    matches = []
    query = params.query.casefold()
    for identifier in params.attachment_ids:
        entry = context.attachments[identifier]
        lower = entry.content.casefold()
        cursor = 0
        for _ in range(3):
            offset = lower.find(query, cursor)
            if offset < 0:
                break
            sid = context.next_attachment_source_id()
            excerpt = entry.content[max(0, offset - 300):offset + min(len(query), 200) + 300]
            matches.append({'source_id': sid, 'attachment_id': identifier,
                            'filename': entry.name, 'section': f'character {offset}',
                            'excerpt': excerpt[:700]})
            cursor = offset + len(query)
    return ToolResult(summary=f'{len(matches)} attachment matches',
                      data={'matches': matches}, source_ids=[m['source_id'] for m in matches],
                      untrusted=True)


async def read_attached_file(context: ToolContext, params: AttachmentReadInput) -> ToolResult:
    entry = context.attachments.get(params.attachment_id)
    if not entry:
        raise ValueError('attachment not selected for this run')
    return ToolResult(summary=f'Read {entry.name}', data={
        'filename': entry.name, 'section': f'characters {params.start}-{params.start + params.length}',
        'text': entry.content[params.start:params.start + params.length]
    }, untrusted=True)
