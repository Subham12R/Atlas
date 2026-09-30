"""
Real internet search for the "Search the web" / "Research mode" tools --
backed by Tavily's REST API (https://docs.tavily.com/), which is built for
handing results straight to an LLM (clean title/url/content per result, no
HTML scraping needed on our end).
"""
from __future__ import annotations

import ipaddress
import math
from urllib.parse import urlsplit

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

    results = []
    for hit in data.get("results", []):
        if not isinstance(hit, dict):
            continue
        url = hit.get("url")
        if not isinstance(url, str) or len(url) > 2048 or any(char.isspace() for char in url):
            continue
        try:
            parsed = urlsplit(url)
            host = parsed.hostname
            _ = parsed.port  # Reject malformed explicit ports.
            if (parsed.scheme not in ("http", "https") or not host or
                    parsed.username or parsed.password or host == "localhost" or
                    host.endswith(".localhost")):
                continue
            try:
                if not ipaddress.ip_address(host).is_global:
                    continue
            except ValueError:
                pass
        except ValueError:
            continue
        title = hit.get('title') if isinstance(hit.get('title'), str) else ''
        content = hit.get('content') if isinstance(hit.get('content'), str) else ''
        result = {'title': title[:500], 'url': url, 'content': content[:2000]}
        published = hit.get('published_date')
        if isinstance(published, str) and len(published) <= 100:
            result['published_date'] = published
        score = hit.get('score')
        if isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(score):
            result['score'] = float(score)
        results.append(result)
    return results
