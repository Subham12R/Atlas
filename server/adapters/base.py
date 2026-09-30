"""
The adapter contract.

Every LLM provider -- pure-request (Gemini) or browser-backed (ChatGPT) --
implements this same interface, so the orchestrator never cares which one it's
talking to. Add a provider = add a new subclass, nothing else changes.
"""
from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Literal


@dataclass
class Reply:
    """A normalized response, identical shape across all providers."""
    text: str
    provider: str
    meta: dict = field(default_factory=dict)


@dataclass
class ImageInput:
    """A single image attached to a prompt -- base64-encoded, no data: prefix."""
    data: str
    mime: str


@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: str  # Raw JSON, bounded and schema-validated by the runner.

    def __post_init__(self):
        if (not isinstance(self.id, str) or not self.id or len(self.id) > 200 or
                not isinstance(self.name, str) or not self.name or len(self.name) > 100 or
                not isinstance(self.arguments, str) or len(self.arguments) > 8192):
            raise ValueError('invalid or oversized provider tool call')


@dataclass(frozen=True)
class TurnMessage:
    role: Literal['system', 'user', 'assistant', 'tool', 'evidence']
    content: str = ''
    images: list[ImageInput] | None = None
    tool_call_id: str | None = None
    calls: tuple[ToolCall, ...] = ()


@dataclass(frozen=True)
class AdapterTurn:
    text: str
    calls: tuple[ToolCall, ...] = ()
    stop_reason: str = 'stop'
    # The model's visible thinking, kept apart from the answer (never cited or stored).
    reasoning: str = ''


@dataclass(frozen=True)
class AdapterEvent:
    kind: Literal['text.delta', 'reasoning.delta', 'tool.call', 'turn.final']
    text: str = ''
    call: ToolCall | None = None
    stop_reason: str = ''


@dataclass(frozen=True)
class AdapterCapabilities:
    tool_calls: bool = False
    streamed_arguments: bool = False
    supported_models: tuple[str, ...] = ()


_CONTROL_TOKEN = re.compile(r'<\|[A-Za-z0-9_]{1,40}\|>')
_TAGS = ('<think>', '</think>')


class ReasoningSplitter:
    """Streams model output into ('text' | 'thinking', str) pieces: inline <think>...</think>
    becomes thinking, and chat-template control tokens (e.g. GLM's <|begin_of_box|>) are
    dropped. A possible tag split across chunks is held back until it can be decided."""

    def __init__(self):
        self._buffer = ''
        self._thinking = False

    def _emit(self, out: list, text: str) -> None:
        if text:
            out.append(('thinking' if self._thinking else 'text', text))

    def feed(self, chunk: str) -> list[tuple[str, str]]:
        self._buffer += chunk or ''
        out: list[tuple[str, str]] = []
        while True:
            start = self._buffer.find('<')
            if start < 0:
                self._emit(out, self._buffer)
                self._buffer = ''
                return out
            self._emit(out, self._buffer[:start])
            rest = self._buffer = self._buffer[start:]
            tag = next((t for t in _TAGS if rest.startswith(t)), None)
            token = _CONTROL_TOKEN.match(rest)
            if tag:
                self._thinking = tag == '<think>'
                self._buffer = rest[len(tag):]
            elif token:
                self._buffer = rest[token.end():]
            elif any(t.startswith(rest) for t in _TAGS) or re.fullmatch(r'<\|[A-Za-z0-9_]{0,40}\|?', rest):
                return out  # Incomplete tag; wait for the next chunk.
            else:
                self._emit(out, '<')
                self._buffer = rest[1:]

    def flush(self) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        self._emit(out, self._buffer)
        self._buffer = ''
        return out


def split_reasoning(text: str) -> tuple[str, str]:
    """(answer, thinking) for a complete reply."""
    splitter = ReasoningSplitter()
    pieces = splitter.feed(text) + splitter.flush()
    return (''.join(t for kind, t in pieces if kind == 'text'),
            ''.join(t for kind, t in pieces if kind == 'thinking'))


def alternating_turns(turns: list[tuple[str, str]]) -> list[tuple[str, str]]:
    """Provider-safe history: starts with the user, strictly alternates, no empty turns."""
    out: list[tuple[str, str]] = []
    for role, content in turns:
        if not content.strip() or (not out and role != 'user'):
            continue
        if out and out[-1][0] == role:
            out[-1] = (role, out[-1][1] + '\n\n' + content)
        else:
            out.append((role, content))
    return out


class BaseAdapter(ABC):
    name: str = "base"
    capabilities = AdapterCapabilities()
    # User-selected reasoning level (see reasoning.py); set per request by the API.
    reasoning: str | None = None

    async def run_turn(self, messages: list[TurnMessage], tools: list[dict]) -> AdapterTurn:
        """Provider-native calls when supported; never execute a tool here."""
        if tools:
            raise NotImplementedError('model tool calls unsupported by this adapter')
        reply = await self.send(messages[-1].content)
        return AdapterTurn(text=reply.text)

    async def stream_turn(self, messages: list[TurnMessage], tools: list[dict]):
        """Normalize a complete turn for adapters without native streaming."""
        turn = await self.run_turn(messages, tools)
        if turn.text:
            yield AdapterEvent(kind='text.delta', text=turn.text)
        for call in turn.calls:
            yield AdapterEvent(kind='tool.call', call=call)
        yield AdapterEvent(kind='turn.final', stop_reason=turn.stop_reason)

    @abstractmethod
    async def init(self) -> None:
        """Authenticate / open the session. Call once before send()."""

    @abstractmethod
    async def send(self, prompt: str, images: list[ImageInput] | None = None) -> Reply:
      """Send a prompt (plus optional images for vision-capable models),
      return the full reply. Keeps multi-turn context."""

    @abstractmethod
    async def send_stream(self, prompt: str, images: list[ImageInput] | None = None):
      """Send a prompt, yielding tokens (strings) as they arrive.
      Keeps multi-turn context."""

    @abstractmethod
    async def close(self) -> None:
        """Release resources (browser, http client, etc.)."""

    async def new_chat(self) -> None:
        """Start a fresh conversation (drop context)."""
        raise NotImplementedError

    def set_history(self, turns: list[tuple[str, str]]) -> None:
        """Replace the conversation with the chat's own (role, text) turns. The client's saved
        chat is the source of truth, so a session rebuilt after a restart or model switch
        continues exactly where the chat left off."""
        raise NotImplementedError

    async def __aenter__(self):
        await self.init()
        return self

    async def __aexit__(self, *exc):
        await self.close()
