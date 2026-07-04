from __future__ import annotations

import json
import re

_SUMMARY_PROMPT = (
    "You maintain a running summary of a conversation. Given the CURRENT SUMMARY "
    "and the NEW EXCHANGE, return an updated summary: concise, factual, third "
    "person, <= 200 words. Return ONLY the summary text, nothing else.\n\n"
    "CURRENT SUMMARY:\n{summary}\n\nNEW EXCHANGE:\nUser: {user}\nAssistant: {assistant}"
)

_TRIPLE_PROMPT = (
    "Extract factual (subject, relation, object) triples stated in the exchange "
    'below. Return ONLY a JSON array like [["subject","relation","object"], ...] '
    "using short noun phrases. Return [] if there are no clear facts.\n\n"
    "User: {user}\nAssistant: {assistant}"
)


def _parse_triples(text: str) -> list[tuple]:
    m = re.search(r"\[.*\]", text, re.S)
    if not m:
        return []
    try:
        data = json.loads(m.group(0))
    except json.JSONDecodeError:
        return []
    out = []
    for t in data:
        if (isinstance(t, list) and len(t) == 3
                and all(isinstance(x, str) and x.strip() for x in t)):
            out.append((t[0].strip(), t[1].strip(), t[2].strip()))
    return out


class Summarizer:
    def __init__(self, adapter):
        self.adapter = adapter

    async def update_summary(self, summary: str, user: str, assistant: str) -> str:
        await self.adapter.new_chat()
        reply = await self.adapter.send(_SUMMARY_PROMPT.format(
            summary=summary or "(none yet)", user=user, assistant=assistant))
        return reply.text.strip()

    async def extract_triples(self, user: str, assistant: str) -> list[tuple]:
        await self.adapter.new_chat()
        reply = await self.adapter.send(_TRIPLE_PROMPT.format(
            user=user, assistant=assistant))
        return _parse_triples(reply.text)
