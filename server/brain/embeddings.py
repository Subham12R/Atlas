"""Local text embeddings.

`embed()` encodes stored passages and `embed_one()` encodes a search query. The
default model, EmbeddingGemma 2, is asymmetric: it expects different task
prompts for the two sides, so callers must use the right method.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import numpy as np

EMBEDDINGGEMMA_2 = "google/embeddinggemma-2"
# Int8 ONNX export of the text tower: as accurate as 4-bit on retrieval and ~2x
# faster on CPU. Pinned to a revision so every install embeds identically.
_EG2_REPO = "onnx-community/embeddinggemma-2-ONNX"
_EG2_REVISION = "daa72c51243991dfcaf9f9137d2c573d8f7790c0"
_EG2_FILES = ("tokenizer.json", "onnx/model_quantized.onnx", "onnx/model_quantized.onnx_data")
# Task prompts from the model's sentence-transformers config.
_EG2_QUERY = "task: search result | query: "
_EG2_DOCUMENT = "title: {title} | text: "
_EG2_DIM = 768
# Passages are chunked to ~1k characters; a little headroom covers the prompt.
_EG2_MAX_TOKENS = 512


def models_dir() -> Path:
    """Where downloaded embedding models live (the desktop app points this at userData)."""
    return Path(os.getenv("ATLAS_MODELS_DIR") or Path.home() / ".cache" / "atlas" / "models")


class EmbeddingGemma2:
    """EmbeddingGemma 2 text encoder via ONNX Runtime (no torch, runs on CPU)."""

    model_id = EMBEDDINGGEMMA_2

    def __init__(self, dim: int = _EG2_DIM):
        from huggingface_hub import hf_hub_download
        import onnxruntime as ort
        from tokenizers import Tokenizer

        if dim not in (128, 256, 512, 768):
            raise ValueError("EmbeddingGemma 2 supports 128, 256, 512 or 768 dimensions")
        paths = [hf_hub_download(_EG2_REPO, name, revision=_EG2_REVISION,
                                 cache_dir=str(models_dir())) for name in _EG2_FILES]
        self._tokenizer = Tokenizer.from_file(paths[0])
        self._tokenizer.enable_truncation(_EG2_MAX_TOKENS)
        options = ort.SessionOptions()
        options.intra_op_num_threads = max(1, min(4, (os.cpu_count() or 2) // 2))
        self._session = ort.InferenceSession(paths[1], options, providers=["CPUExecutionProvider"])
        self._lock = threading.Lock()  # one inference at a time; ORT already uses several threads
        self._no_media = np.zeros((0, 512), np.float32)
        self.dim = dim

    def _encode(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        out = []
        for start in range(0, len(texts), 16):
            encodings = self._tokenizer.encode_batch(texts[start:start + 16])
            width = max(len(e.ids) for e in encodings)
            ids = np.array([e.ids + [0] * (width - len(e.ids)) for e in encodings], np.int64)
            mask = (np.arange(width)[None, :] < np.array([[len(e.ids)] for e in encodings])).astype(np.int64)
            with self._lock:
                vectors = self._session.run(["sentence_embedding"], {
                    "input_ids": ids, "attention_mask": mask, "image_features": self._no_media,
                    "video_features": self._no_media, "audio_features": self._no_media})[0]
            # Matryoshka: the leading dimensions form a valid smaller embedding once re-normalized.
            vectors = vectors[:, :self.dim]
            vectors /= np.linalg.norm(vectors, axis=1, keepdims=True) + 1e-12
            out.extend(vectors.tolist())
        return out

    def embed(self, texts: list[str], titles: list[str] | None = None) -> list[list[float]]:
        titles = titles or ["none"] * len(texts)
        return self._encode([_EG2_DOCUMENT.format(title=(title or "none").replace("|", " ")) + text
                             for text, title in zip(texts, titles)])

    def embed_one(self, text: str) -> list[float]:
        return self._encode([_EG2_QUERY + text])[0]


class FastEmbedModel:
    """Any fastembed model (e.g. BAAI/bge-small-en-v1.5); symmetric, no task prompts."""

    def __init__(self, model: str, dim: int):
        from fastembed import TextEmbedding
        self._model = TextEmbedding(model, cache_dir=str(models_dir()))
        self.model_id = model
        self.dim = dim

    def embed(self, texts: list[str], titles: list[str] | None = None) -> list[list[float]]:
        return [v.tolist() for v in self._model.embed(list(texts))]

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]


def Embedder(model: str, dim: int):
    """Build the configured embedding model (downloads it on first use)."""
    if model == EMBEDDINGGEMMA_2:
        return EmbeddingGemma2(dim)
    return FastEmbedModel(model, dim)
