"""Structure-aware chunking for recall and document search.

Text is split at its own boundaries (headings, paragraphs, then sentences) and
packed into chunks of about `max_chars`, with a short sentence-aligned overlap
so a fact that straddles a boundary is still retrievable. PDF text carries
"[Page N]" markers; each chunk records the page it starts on so answers can
cite it. No model calls: chunking cost does not grow with embedding-model size.
"""
from __future__ import annotations

import re

_PAGE = re.compile(r"^\[Page (\d+)\]$", re.M)
_HEADING = re.compile(r"^(#{1,6} |[A-Z][A-Z0-9 ,:&/-]{3,80}$)")
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+(?=[\"'(\[]?[A-Z0-9])")


def _window(text: str, max_chars: int, overlap: int) -> list[str]:
    """Fixed-size fallback for text without usable boundaries (code, tables, logs)."""
    chunks: list[str] = []
    start, n = 0, len(text)
    while start < n:
        end = min(start + max_chars, n)
        if end < n:
            window = text[start:end]
            brk = max(window.rfind("\n"), window.rfind(". "),
                      window.rfind("! "), window.rfind("? "))
            if brk > max_chars * 0.5:
                end = start + brk + 1
        piece = text[start:end].strip()
        if piece:
            chunks.append(piece)
        if end >= n:
            break
        start = max(end - overlap, start + 1)
    return chunks


def _blocks(text: str) -> list[str]:
    """Paragraphs, with each heading glued to the paragraph that follows it."""
    blocks: list[str] = []
    pending = ""
    for para in re.split(r"\n\s*\n", text):
        para = para.strip()
        if not para:
            continue
        if _HEADING.match(para) and "\n" not in para and len(para) < 120:
            pending = f"{pending}\n{para}".strip()
            continue
        blocks.append(f"{pending}\n{para}".strip() if pending else para)
        pending = ""
    if pending:
        blocks.append(pending)
    return blocks


def _sentences(block: str, max_chars: int, overlap: int) -> list[str]:
    parts = [s.strip() for s in _SENTENCE_END.split(block) if s.strip()]
    out: list[str] = []
    for part in parts:
        out.extend(_window(part, max_chars, overlap) if len(part) > max_chars else [part])
    return out


def chunk_text(text: str, max_chars: int = 1000, overlap: int = 150) -> list[str]:
    text = text.strip()
    if not text:
        return []
    if len(text) <= max_chars:
        return [text]
    # (text, starts a new section): a heading never shares a chunk with the section before it.
    units: list[tuple[str, bool]] = []
    for block in _blocks(text):
        parts = [block] if len(block) <= max_chars else _sentences(block, max_chars, overlap)
        heading = bool(_HEADING.match(block))
        units.extend((part, heading and index == 0) for index, part in enumerate(parts))

    chunks: list[str] = []
    current: list[str] = []
    for unit, section_start in units:
        if current and section_start:
            chunks.append("\n\n".join(current))
            current = []
        if current and sum(len(u) + 2 for u in current) + len(unit) > max_chars:
            chunks.append("\n\n".join(current))
            # Carry trailing whole units (up to `overlap` chars) into the next chunk.
            carry: list[str] = []
            for prev in reversed(current):
                if sum(len(c) for c in carry) + len(prev) > overlap:
                    break
                carry.insert(0, prev)
            current = carry
        current.append(unit)
    if current:
        chunks.append("\n\n".join(current))
    return chunks


def chunk_pages(text: str, max_chars: int = 1000, overlap: int = 150) -> list[tuple[str, int | None]]:
    """Chunks paired with the PDF page they come from (None for text without page markers)."""
    marks = list(_PAGE.finditer(text))
    if not marks:
        return [(chunk, None) for chunk in chunk_text(text, max_chars, overlap)]
    out: list[tuple[str, int | None]] = []
    for index, mark in enumerate(marks):
        end = marks[index + 1].start() if index + 1 < len(marks) else len(text)
        page = int(mark.group(1))
        out.extend((chunk, page) for chunk in chunk_text(text[mark.end():end], max_chars, overlap))
    return out
