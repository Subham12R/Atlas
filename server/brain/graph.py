"""Entity graph for indexed documents (no model calls).

Entities are proper-noun phrases and acronyms. Each is linked to the chunks
that mention it, and two entities in the same chunk get a weighted
co-occurrence edge. At query time, entities named in (or semantically close
to) the question, plus their strongest neighbours, pull in the chunks that
mention them -- passages a plain similarity search can miss because they
don't restate the question's wording.
"""
from __future__ import annotations

import re
from itertools import combinations

# Words keep inner dots ("Node.js", "U.S") but not a sentence's full stop.
_TOKEN = re.compile(r"[A-Za-z][\w&'-]*(?:\.[A-Za-z0-9]+)*|\d[\w-]*(?:\.\d+)*|[.!?;:\n,]")
# Joiners inside one name ("Bank of India"); "and" is not one: it joins two names.
_CONNECTORS = {"of", "for", "the", "de", "la", "von", "van"}
# Capitalised for grammar, not because they name something.
_NOT_NAMES = frozenset("""
The A An This That These Those It Its I We You He She They Our Your Their My His Her
In On At For From To Of And Or But If When While With Without By As Is Are Was Were Be
Page Figure Table Section Chapter Note See Also However Therefore Thus Here There Yes No
Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May
June July August September October November December Mr Mrs Ms Dr
""".split())
MAX_ENTITIES_PER_CHUNK = 15


def _is_name(token: str) -> bool:
    return token[:1].isupper() and token not in _NOT_NAMES


def extract_entities(text: str) -> list[str]:
    """Proper-noun phrases ("Atlas Desktop", "Bank of India") and acronyms ("RAG", "GPT4")."""
    tokens = _TOKEN.findall(text)
    found: list[str] = []
    run: list[str] = []
    sentence_start = True

    def flush() -> None:
        while run and run[-1].lower() in _CONNECTORS:
            run.pop()
        if run:
            phrase = " ".join(run).strip(".-'")
            single = len(run) == 1
            acronym = single and phrase.isupper() and len(phrase) >= 2
            # A lone capitalised word at a sentence start is usually just grammar.
            if len(phrase) >= 2 and (not single or acronym or not run_started_sentence[0]):
                found.append(phrase)
        run.clear()

    run_started_sentence = [False]
    for token in tokens:
        if token in ".!?;:\n,":
            flush()
            sentence_start = token != ","
            continue
        if _is_name(token) or (run and token.lower() in _CONNECTORS):
            if not run:
                run_started_sentence[0] = sentence_start
            run.append(token)
            if len(run) > 5:
                flush()
        else:
            flush()
        sentence_start = False
    flush()
    return list(dict.fromkeys(found))[:MAX_ENTITIES_PER_CHUNK]


def link_chunk(con, chunk_id: int, text: str) -> None:
    """Record a chunk's entities and their co-occurrence. Call inside a transaction."""
    ids = []
    for name in extract_entities(text):
        con.execute("INSERT INTO doc_entities(name, mentions) VALUES (?, 1) "
                    "ON CONFLICT(name) DO UPDATE SET mentions = mentions + 1", (name,))
        ids.append(con.execute("SELECT id FROM doc_entities WHERE name = ?", (name,)).fetchone()[0])
        con.execute("INSERT OR IGNORE INTO doc_entity_chunks(entity_id, chunk_id) VALUES (?, ?)",
                    (ids[-1], chunk_id))
    for a, b in combinations(sorted(set(ids)), 2):
        con.execute("INSERT INTO doc_entity_edges(a_id, b_id) VALUES (?, ?) "
                    "ON CONFLICT(a_id, b_id) DO UPDATE SET weight = weight + 1", (a, b))


def unlink_chunks(con, chunk_ids: list[int]) -> None:
    """Undo link_chunk for deleted chunks and drop entities nothing mentions any more."""
    if not chunk_ids:
        return
    marks = ",".join("?" * len(chunk_ids))
    for chunk_id in chunk_ids:
        ids = [r[0] for r in con.execute(
            "SELECT entity_id FROM doc_entity_chunks WHERE chunk_id = ?", (chunk_id,))]
        for a, b in combinations(sorted(ids), 2):
            con.execute("UPDATE doc_entity_edges SET weight = weight - 1 WHERE a_id = ? AND b_id = ?", (a, b))
        con.executemany("UPDATE doc_entities SET mentions = mentions - 1 WHERE id = ?", [(i,) for i in ids])
    con.execute(f"DELETE FROM doc_entity_chunks WHERE chunk_id IN ({marks})", chunk_ids)
    con.execute("DELETE FROM doc_entity_edges WHERE weight <= 0")
    gone = "SELECT id FROM doc_entities WHERE id NOT IN (SELECT entity_id FROM doc_entity_chunks)"
    con.execute(f"DELETE FROM vec_doc_entities WHERE rowid IN ({gone})")
    con.execute(f"DELETE FROM doc_entity_edges WHERE a_id IN ({gone}) OR b_id IN ({gone})")
    con.execute(f"DELETE FROM doc_entities WHERE id IN ({gone})")


def graph_chunks(con, query: str, query_vec: list[float] | None, pack,
                 limit: int = 12, entity_distance: float = 0.3) -> list[int]:
    """Chunk ids reached through the entity graph, best first."""
    seeds: dict[int, float] = {}
    lowered = f" {query.lower()} "
    for row in con.execute("SELECT id, name FROM doc_entities"):
        if re.search(rf"(?<!\w){re.escape(row['name'].lower())}(?!\w)", lowered):
            seeds[row["id"]] = 2.0
    if query_vec is not None:
        for row in con.execute(
                "SELECT rowid AS id, distance FROM vec_doc_entities WHERE embedding MATCH ? "
                "ORDER BY distance LIMIT 8", (pack(query_vec),)):
            if row["distance"] <= entity_distance:
                seeds.setdefault(row["id"], 1.5)
    if not seeds:
        return []
    weights = dict(seeds)
    marks = ",".join("?" * len(seeds))
    # One hop: the strongest co-occurring neighbours, weighted below the seeds themselves.
    for row in con.execute(
            f"""SELECT CASE WHEN a_id IN ({marks}) THEN b_id ELSE a_id END AS other, weight
                FROM doc_entity_edges WHERE a_id IN ({marks}) OR b_id IN ({marks})
                ORDER BY weight DESC LIMIT 6""", [*seeds, *seeds, *seeds]):
        weights.setdefault(row["other"], 0.5)
    entity_marks = ",".join("?" * len(weights))
    scores: dict[int, float] = {}
    for row in con.execute(
            f"SELECT entity_id, chunk_id FROM doc_entity_chunks WHERE entity_id IN ({entity_marks})",
            list(weights)):
        scores[row["chunk_id"]] = scores.get(row["chunk_id"], 0.0) + weights[row["entity_id"]]
    return sorted(scores, key=lambda cid: (-scores[cid], cid))[:limit]
