"""One-click setup for keyless web search (free-search-mcp), run headless by the backend.

Installs a pinned free-search-mcp with uv (bootstrapping uv from its official installer
if missing), then selects it as the search provider. Nothing runs in a visible
terminal, nothing is installed at search time, and every step is bounded by a timeout.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import sys
from pathlib import Path

import httpx

import credentials_store

PACKAGE = 'free-search-mcp==0.13.1'
UV_INSTALLER = 'https://astral.sh/uv/install.sh'
PROVIDER_KEY = 'WEB_SEARCH_PROVIDER'
_STEP_TIMEOUT = 300
_lock = asyncio.Lock()


class SetupFailed(RuntimeError):
    pass


def tool_dirs() -> list[str]:
    """Where uv and its tools live. Apps opened from Finder get a minimal PATH without these."""
    home = Path.home()
    return [str(home / '.local' / 'bin'), str(home / '.cargo' / 'bin'),
            '/opt/homebrew/bin', '/usr/local/bin']


def find_executable(name: str) -> str | None:
    path = os.pathsep.join([os.environ.get('PATH', ''), *tool_dirs()])
    return shutil.which(name, path=path)


async def _run(*command: str, env: dict | None = None, stdin: bytes | None = None) -> None:
    process = await asyncio.create_subprocess_exec(
        *command, stdin=asyncio.subprocess.PIPE if stdin is not None else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        env={**os.environ, **(env or {})})
    try:
        output, _ = await asyncio.wait_for(process.communicate(stdin), timeout=_STEP_TIMEOUT)
    except asyncio.TimeoutError:
        process.kill()
        raise SetupFailed(f'{Path(command[0]).name} timed out after {_STEP_TIMEOUT}s')
    if process.returncode != 0:
        tail = output.decode(errors='replace').strip()[-600:]
        raise SetupFailed(f'{Path(command[0]).name} failed: {tail or f"exit {process.returncode}"}')


async def _ensure_uv() -> str:
    uv = find_executable('uv')
    if uv:
        return uv
    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        response = await client.get(UV_INSTALLER)
        response.raise_for_status()
    # INSTALLER_NO_MODIFY_PATH: never edit the user's shell profile; we find uv ourselves.
    await _run('sh', env={'INSTALLER_NO_MODIFY_PATH': '1'}, stdin=response.content)
    uv = find_executable('uv')
    if not uv:
        raise SetupFailed('uv installed but was not found in ~/.local/bin')
    return uv


async def _verify() -> None:
    """One real search: absorbs the first-launch cold start and proves the connection works."""
    from websearch import SearchUnavailable, search_free  # Lazy: websearch imports this module.
    try:
        await asyncio.wait_for(search_free('Atlas desktop assistant', 1), timeout=120)
    except (SearchUnavailable, asyncio.TimeoutError, OSError) as error:
        raise SetupFailed(f'installed, but a test search failed: {error or type(error).__name__}')


def status() -> dict:
    return {'installed': find_executable('search-mcp') is not None}


async def install() -> dict:
    """Install (idempotent) and select free-search-mcp. Concurrent clicks share one run."""
    if sys.platform == 'win32':
        raise SetupFailed('One-click setup supports macOS and Linux; install free-search-mcp manually.')
    async with _lock:
        if not find_executable('search-mcp'):
            uv = await _ensure_uv()
            await _run(uv, 'tool', 'install', PACKAGE)
        if not find_executable('search-mcp'):
            raise SetupFailed('free-search-mcp installed but its search-mcp command was not found')
        await _verify()  # Only switch providers once a real search has succeeded.
        credentials_store.set_many({PROVIDER_KEY: 'free-search-mcp'})
        return {'installed': True, 'provider': 'free-search-mcp'}
