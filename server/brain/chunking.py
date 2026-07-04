from __future__ import annotations

from langchain_core.embeddings import Embeddings
from langchain_experimental.text_splitter import SemanticChunker


class _EmbeddingsAdapter(Embeddings):
   
    def __init__(self, embedder):
        self._embedder = embedder

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return self._embedder.embed(texts)

    def embed_query(self, text: str) -> list[float]:
        return self._embedder.embed_one(text)


def _window(text: str, max_chars: int, overlap: int) -> list[str]:
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


def chunk_text(text: str, embedder, max_chars: int = 800, overlap: int = 100,
               breakpoint_threshold_type: str = "percentile",
               breakpoint_threshold_amount: float | None = None) -> list[str]:
    text = text.strip()
    if len(text) <= max_chars:
        return [text] if text else []

    kwargs = {"breakpoint_threshold_type": breakpoint_threshold_type}
    if breakpoint_threshold_amount is not None:
        kwargs["breakpoint_threshold_amount"] = breakpoint_threshold_amount
    splitter = SemanticChunker(_EmbeddingsAdapter(embedder), **kwargs)

    try:
        pieces = splitter.split_text(text)
    except (IndexError, ValueError, ZeroDivisionError):
       
        return _window(text, max_chars, overlap)

    chunks: list[str] = []
    for piece in pieces:
        piece = piece.strip()
        if not piece:
            continue
        if len(piece) > max_chars:
            chunks.extend(_window(piece, max_chars, overlap))
        else:
            chunks.append(piece)
    return chunks
