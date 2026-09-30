"""Bounded public-page reads. Connect to the validated IP, not a second DNS lookup."""
from __future__ import annotations

import asyncio
import http.client
import ipaddress
import re
import socket
import ssl
import time
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit, urlunsplit

import credentials_store
import websearch
from pydantic import BaseModel, Field

from .contracts import ToolContext, ToolResult

MAX_BODY = 1024 * 1024
MAX_TEXT = 12000
MAX_FETCH_SECONDS = 10


class UnsafePage(ValueError):
    pass


class SearchInput(BaseModel):
    query: str = Field(min_length=1, max_length=1000)
    max_results: int = Field(default=8, ge=1, le=8)


class FetchInput(BaseModel):
    source_id: str = Field(pattern=r'^S[1-9][0-9]*$')


def validate_target(url: str) -> tuple[str, str, int]:
    if not isinstance(url, str) or any(c.isspace() or ord(c) < 32 for c in url):
        raise UnsafePage('invalid page URL')
    try:
        target = urlsplit(url)
        host = target.hostname
        port = target.port or (443 if target.scheme == 'https' else 80)
        if (target.scheme not in ('http', 'https') or not host or target.username or
                target.password or host == 'localhost' or host.endswith('.localhost') or
                port != (443 if target.scheme == 'https' else 80)):
            raise UnsafePage('page target not public HTTP(S)')
        addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM,
                                        proto=socket.IPPROTO_TCP)
        ips = [addr[4][0] for addr in addresses]
        if not ips or any(not ipaddress.ip_address(ip).is_global for ip in ips):
            raise UnsafePage('page target resolved to a non-public address')
        return ips[0], host, port
    except (ValueError, OSError, socket.gaierror) as e:
        raise UnsafePage('invalid or unavailable public page') from e


class _Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip = 0
        self.title_depth = 0
        self.title: list[str] = []
        self.text: list[str] = []

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'noscript', 'svg', 'head'):
            self.skip += 1
        if tag == 'title':
            self.title_depth += 1

    def handle_endtag(self, tag):
        if tag == 'title':
            self.title_depth = max(0, self.title_depth - 1)
        if tag in ('script', 'style', 'noscript', 'svg', 'head'):
            self.skip = max(0, self.skip - 1)

    def handle_data(self, data):
        if self.title_depth:
            self.title.append(data)
        elif not self.skip and data.strip():
            self.text.append(data.strip())


def _fetch_one(url: str, ip: str, host: str, port: int,
               deadline: float | None = None) -> tuple[int, dict, bytes]:
    target = urlsplit(url)
    path = (target.path or '/') + (f'?{target.query}' if target.query else '')
    deadline = deadline or time.monotonic() + MAX_FETCH_SECONDS
    timeout = min(MAX_FETCH_SECONDS, deadline - time.monotonic())
    if timeout <= 0:
        raise UnsafePage('page fetch timed out')
    sock = socket.create_connection((ip, port), timeout=timeout)
    try:
        if target.scheme == 'https':
            sock = ssl.create_default_context().wrap_socket(sock, server_hostname=host)
            conn = http.client.HTTPSConnection(host, port, timeout=timeout)
        else:
            conn = http.client.HTTPConnection(host, port, timeout=timeout)
        conn.sock = sock
        try:
            if time.monotonic() >= deadline:
                raise UnsafePage('page fetch timed out')
            sock.settimeout(max(0.001, deadline - time.monotonic()))
            conn.request('GET', path, headers={
                'Host': host, 'Accept': 'text/html, text/plain',
                'Accept-Encoding': 'identity', 'User-Agent': 'AtlasResearch/1.0'
            })
            response = conn.getresponse()
            headers = {name.lower(): value for name, value in response.getheaders()}
            if (response.status in (301, 302, 303, 307, 308)):
                return response.status, headers, b''
            if response.status != 200:
                raise UnsafePage(f'page returned HTTP {response.status}')
            mime = headers.get('content-type', '').split(';')[0].strip().lower()
            if mime not in ('text/html', 'text/plain') or headers.get('content-encoding', 'identity') != 'identity':
                raise UnsafePage('unsupported page content type')
            if int(headers.get('content-length', '0')) > MAX_BODY:
                raise UnsafePage('page too large')
            body = bytearray()
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise UnsafePage('page fetch timed out')
                sock.settimeout(remaining)
                chunk = response.read1(min(8192, MAX_BODY + 1 - len(body)))
                if not chunk:
                    break
                body.extend(chunk)
                if len(body) > MAX_BODY:
                    raise UnsafePage('page too large')
            return response.status, headers, bytes(body)
        finally:
            conn.close()
    finally:
        sock.close()


def read_page(url: str) -> tuple[str, str, str]:
    deadline = time.monotonic() + MAX_FETCH_SECONDS
    seen: set[str] = set()
    for _ in range(4):
        if url in seen:
            raise UnsafePage('redirect loop')
        seen.add(url)
        if time.monotonic() >= deadline:
            raise UnsafePage('page fetch timed out')
        ip, host, port = validate_target(url)
        if time.monotonic() >= deadline:
            raise UnsafePage('page fetch timed out')
        status, headers, body = _fetch_one(url, ip, host, port, deadline)
        if status in (301, 302, 303, 307, 308):
            location = headers.get('location')
            if not location:
                raise UnsafePage('redirect missing destination')
            url = urljoin(url, location)
            continue
        if status != 200:
            raise UnsafePage('page read failed')
        mime = headers.get('content-type', '').split(';')[0].strip().lower()
        if mime not in ('text/html', 'text/plain') or len(body) > MAX_BODY:
            raise UnsafePage('unsupported page content or size')
        text = body.decode('utf-8', errors='replace')
        if mime == 'text/html':
            parser = _Text()
            parser.feed(text)
            return ' '.join(parser.title)[:200], ' '.join(parser.text)[:MAX_TEXT], url
        return '', text[:MAX_TEXT], url
    raise UnsafePage('too many redirects')


async def search_web(context: ToolContext, params: SearchInput) -> ToolResult:
    key = credentials_store.get_value('TAVILY_API_KEY')
    websearch.require_backend(key)
    hits = await websearch.search(key, params.query, params.max_results)
    found = []
    for hit in hits:
        parsed = urlsplit(hit['url'])
        canonical_url = urlunsplit(parsed._replace(fragment=''))
        web_sources = [source for source in context.sources.values() if source.get('url')]
        if len(web_sources) >= 12:
            break
        if any(existing['url'] == canonical_url for existing in web_sources):
            continue
        sid = f'S{len(web_sources) + 1}'
        record = {'source_id': sid, 'title': hit['title'], 'url': canonical_url,
                  'host': parsed.hostname or '',
                  'snippet': hit['content'][:2000], 'query': params.query,
                  'provider': websearch.provider()}
        record.update({key: hit[key] for key in ('published_date', 'score') if key in hit})
        context.sources[sid] = record
        found.append(record)
    return ToolResult(summary=f'{len(found)} sources found', data={'results': found},
                      source_ids=[record['source_id'] for record in found], untrusted=True)


async def fetch_page(context: ToolContext, params: FetchInput) -> ToolResult:
    source = context.sources.get(params.source_id)
    if source is None:
        raise UnsafePage('unknown source ID')
    title, text, final_url = await asyncio.to_thread(read_page, source['url'])
    source.update({'title': title or source['title'], 'text': text, 'final_url': final_url,
                   'fetched': True})
    return ToolResult(summary=f'Fetched {params.source_id}', data={
        'source_id': params.source_id, 'title': source['title'], 'text': text,
        'url': final_url
    }, source_ids=[params.source_id], untrusted=True)
