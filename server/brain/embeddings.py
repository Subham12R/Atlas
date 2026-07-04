
from __future__ import annotations

from fastembed import TextEmbedding


class Embedder:
    def __init__(self, model: str, dim: int):
        self._model = TextEmbedding(model)
        self.dim = dim

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [v.tolist() for v in self._model.embed(list(texts))]

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]
