from __future__ import annotations


def build_context(store, embedder, prompt: str, thread_id: str,
                  topk: int = 6, budget: int = 2000,
                  max_distance: float | None = 0.6) -> str:
    parts = []

    summary = store.get_summary(thread_id)
    if summary:
        parts.append("[Rolling summary]\n" + summary)


    if not store.has_messages(thread_id):
        return "\n\n".join(parts)[:budget]

    hits = store.search(embedder.embed_one(prompt), k=topk, max_distance=max_distance)
    if hits:
        lines = "\n".join(f"- {text.strip()}" for text, _, _ in hits)
        parts.append("[Relevant memory]\n" + lines)

    names = _entities(store, prompt, hits)
    triples = store.neighbors(names) if names else []
    if triples:
        lines = "\n".join(f"- {s} {r} {d}" for s, r, d in triples)
        parts.append("[Known facts]\n" + lines)

    return "\n\n".join(parts)[:budget]


def _entities(store, prompt: str, hits: list[tuple]) -> list[str]:
    names = store.entity_names_in(prompt)
    for text, _, _ in hits:
        names.extend(store.entity_names_in(text))
    return list(dict.fromkeys(names))
