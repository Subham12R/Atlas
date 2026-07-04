"""
Real internet search for the "Search the web" / "Research mode" tools --
backed by Tavily's REST API (https://docs.tavily.com/), which is built for
handing results straight to an LLM (clean title/url/content per result, no
HTML scraping needed on our end).
"""
from __future__ import annotations

import httpx

_URL = "https://api.tavily.com/search"


async def search(api_key: str, query: str, max_results: int = 5) -> list[dict]:
    """-> [{"title": ..., "url": ..., "content": ...}, ...]"""
    async with httpx.AsyncClient(timeout=20) as client:
        resp = await client.post(_URL, json={
            "api_key": api_key,
            "query": query,
            "max_results": max_results,
        })
        resp.raise_for_status()
        data = resp.json()

    return [{"title": r.get("title", ""), "url": r["url"], "content": r.get("content", "")}
            for r in data.get("results", [])]
