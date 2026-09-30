"""
Search/Research transport: Tavily by default, or an explicitly selected
installed free-search-mcp stdio server. Only normalized public hits cross
into agent evidence; MCP never becomes a model-granted tool registry.
"""
from __future__ import annotations

import asyncio
import ipaddress
import math
import os
from urllib.parse import urlsplit

import httpx

import credentials_store
from free_search_setup import PROVIDER_KEY, find_executable

_URL = "https://api.tavily.com/search"


class SearchUnavailable(ValueError):
    pass


def provider() -> str:
    """ATLAS_WEB_SEARCH_PROVIDER overrides the choice saved by one-click setup in Settings."""
    selected = os.environ.get('ATLAS_WEB_SEARCH_PROVIDER')
    if not selected:
        saved = credentials_store.get_value(PROVIDER_KEY)
        # An unknown saved value falls back to the default; a bad env override still fails.
        selected = saved if saved in ('tavily', 'free-search-mcp') else 'tavily'
    if selected not in ('tavily', 'free-search-mcp'):
        raise SearchUnavailable('unknown web search provider')
    return selected


def require_backend(api_key: str | None) -> None:
    if provider() == 'tavily' and not api_key:
        raise SearchUnavailable('no Tavily API key configured')
    if provider() == 'free-search-mcp' and not find_executable('search-mcp'):
        raise SearchUnavailable('free-search-mcp is not installed (search-mcp executable missing)')


def available(api_key: str | None) -> bool:
    try:
        require_backend(api_key)
        return True
    except SearchUnavailable:
        return False


async def _free_search(query: str, max_results: int) -> dict:
    executable = find_executable('search-mcp')
    if not executable:
        raise SearchUnavailable('free-search-mcp is not installed (search-mcp executable missing)')
    try:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client
    except ImportError as error:
        raise SearchUnavailable('MCP Python SDK is not installed') from error
    params = StdioServerParameters(command=executable, args=['--transport', 'stdio'],
                                   env={'SEARCH_MCP_DOWNLOAD_ENABLED': 'false',
                                        'SEARCH_MCP_TRANSPORT': 'stdio',
                                        # Its default 'moderate' let adult sites into results.
                                        'SEARCH_MCP_SAFESEARCH': 'strict'})
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool('search', arguments={
                'query': query, 'max_results': max_results, 'format': 'json'})
    if result.is_error or not isinstance(result.structured_content, dict):
        raise SearchUnavailable('free-search-mcp search failed or returned invalid data')
    return result.structured_content


async def search_free_raw(query: str, max_results: int) -> dict:
    # Longer than Tavily's 20s: the local MCP server may cold-start on its first search.
    return await asyncio.wait_for(_free_search(query, max_results), timeout=45)


async def search_free(query: str, max_results: int = 5) -> dict:
    data = await search_free_raw(query, max_results)
    if not isinstance(data, dict) or not isinstance(data.get('results'), list):
        raise SearchUnavailable('free-search-mcp returned invalid data')
    return data


async def search(api_key: str | None, query: str, max_results: int = 5) -> list[dict]:
    """Return bounded public hits with the same shape for either search backend."""
    if provider() == 'free-search-mcp':
        data = await search_free_raw(query, max_results)
    else:
        require_backend(api_key)
        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(_URL, json={
                "api_key": api_key,
                "query": query,
                "max_results": max_results,
            })
            resp.raise_for_status()
            data = resp.json()
    if not isinstance(data, dict) or not isinstance(data.get('results'), list):
        raise SearchUnavailable('web search returned invalid data')
    if provider() == 'free-search-mcp' and not data['results'] and data.get('errors'):
        raise SearchUnavailable('free-search-mcp search failed')

    results = []
    for hit in data['results'][:max_results]:
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
        raw_content = hit.get('content', hit.get('snippet', ''))
        content = raw_content if isinstance(raw_content, str) else ''
        result = {'title': title[:500], 'url': url, 'content': content[:2000]}
        published = hit.get('published_date')
        if isinstance(published, str) and len(published) <= 100:
            result['published_date'] = published
        score = hit.get('score')
        if isinstance(score, (int, float)) and not isinstance(score, bool) and math.isfinite(score):
            result['score'] = float(score)
        results.append(result)
    return results
