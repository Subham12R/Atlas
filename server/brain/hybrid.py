"""Shared pieces of hybrid retrieval: keyword queries and rank fusion."""
from __future__ import annotations

import re

# Words that carry no retrieval signal on their own.
_STOP = frozenset("""
a about above after again all also am an and any are as at be because been before being
between both but by can could did do does doing down during each few for from further had
has have having he her here hers him his how i if in into is it its itself just me more most
my no nor not now of off on once only or other our out over own please same she should so
some such than that the their them then there these they this those through to too under
until up very was we were what when where which while who whom why will with would you your
tell show give find explain describe summarize summarise list
""".split())


def query_terms(text: str, limit: int = 12) -> list[str]:
    """Distinct content words of a query, in order."""
    words = [w for w in re.findall(r"\w+", text.lower()) if len(w) > 1 and w not in _STOP]
    return list(dict.fromkeys(words))[:limit]


def fts_query(text: str) -> str | None:
    """An FTS5 MATCH expression: any content word, each quoted so input can't inject syntax."""
    terms = query_terms(text)
    return " OR ".join(f'"{term}"' for term in terms) if terms else None


def rrf(*rankings: list, k: int = 60) -> list:
    """Reciprocal rank fusion of ranked id lists: robust to the lists' different score scales."""
    scores: dict = {}
    for ranking in rankings:
        for rank, item in enumerate(ranking):
            scores[item] = scores.get(item, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores, key=lambda item: -scores[item])
