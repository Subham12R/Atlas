"""Offline cosine-search baseline using checked-in, synthetic vectors (not model quality)."""

# ponytail: synthetic vectors test SQLite ranking only; use a labeled public corpus
# and cached local embeddings before promoting retrieval or chunking changes.

from __future__ import annotations

import json
from contextlib import closing
from math import log2
from pathlib import Path
from statistics import fmean

from brain.db import connect
from brain.store import MemoryStore


def _check_k(k: int) -> None:
    if type(k) is not int or k < 1:
        raise ValueError("k must be a positive integer")


def recall_at_k(relevant_ids: set[str], ranked_ids: list[str], k: int) -> float:
    _check_k(k)
    relevant = set(relevant_ids)
    return len(relevant.intersection(ranked_ids[:k])) / len(relevant) if relevant else 0.0


def reciprocal_rank(relevant_ids: set[str], ranked_ids: list[str]) -> float:
    relevant = set(relevant_ids)
    return next((1 / rank for rank, doc_id in enumerate(ranked_ids, 1)
                 if doc_id in relevant), 0.0)


def ndcg_at_k(relevant_ids: set[str], ranked_ids: list[str], k: int) -> float:
    _check_k(k)
    relevant = set(relevant_ids)
    if not relevant:
        return 0.0
    ideal = sum(1 / log2(rank + 1) for rank in range(1, min(k, len(relevant)) + 1))
    seen: set[str] = set()
    score = 0.0
    for rank, doc_id in enumerate(ranked_ids[:k], 1):
        if doc_id in relevant and doc_id not in seen:
            score += 1 / log2(rank + 1)
            seen.add(doc_id)
    return score / ideal


def evaluate_fixtures(path: Path | None = None) -> dict:
    path = path or Path(__file__).with_name("rag_fixtures.jsonl")
    fixtures = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()]
    if not fixtures:
        raise ValueError("no RAG fixtures")
    version = fixtures[0]["fixture_version"]
    source = fixtures[0]["embedding_source"]
    k = fixtures[0]["k"]
    if version != 1:
        raise ValueError(f"unsupported RAG fixture version: {version}")
    _check_k(k)
    results = []
    for fixture in fixtures:
        if (fixture["fixture_version"], fixture["embedding_source"], fixture["k"]) != (version, source, k):
            raise ValueError("RAG fixtures must share version, embedding source, and k")
        chunks = fixture["chunks"]
        # ponytail: search returns text, not IDs; use unique fixture texts until
        # real document benchmarks require chunk IDs from MemoryStore.search.
        id_by_text = {chunk["text"]: chunk["id"] for chunk in chunks}
        ids = set(id_by_text.values())
        if not chunks or len(id_by_text) != len(chunks) or len(ids) != len(chunks):
            raise ValueError("each fixture needs uniquely identified chunk texts")
        relevant = set(fixture["relevant_ids"])
        if not relevant <= ids:
            raise ValueError("relevant IDs must exist in the fixture corpus")

        with closing(connect(":memory:", len(fixture["query_embedding"]))) as con:
            store = MemoryStore(con)
            thread_id = fixture["query_id"]
            store.create_thread(thread_id, "local")
            for chunk in chunks:
                store.add_message(thread_id, "assistant", chunk["text"],
                                  chunks=[(chunk["text"], chunk["embedding"])])
            hits = store.search(fixture["query_embedding"], k=len(chunks))
        ranked_ids = [id_by_text[text] for text, _, _ in hits]
        results.append({
            "query_id": fixture["query_id"],
            "ranked_ids": ranked_ids,
            "recall_at_k": recall_at_k(relevant, ranked_ids, k),
            "reciprocal_rank": reciprocal_rank(relevant, ranked_ids),
            "ndcg_at_k": ndcg_at_k(relevant, ranked_ids, k),
        })

    return {
        "fixture_version": version,
        "embedding_source": source,
        "retriever": "MemoryStore.search (cosine distance, no cutoff)",
        "k": k,
        "queries": results,
        "mean_recall_at_k": fmean(row["recall_at_k"] for row in results),
        "mrr": fmean(row["reciprocal_rank"] for row in results),
        "mean_ndcg_at_k": fmean(row["ndcg_at_k"] for row in results),
    }


if __name__ == "__main__":
    print(json.dumps(evaluate_fixtures(), sort_keys=True))
