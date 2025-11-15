"""Utilities for persisting channel facts into Vertex AI Memory Bank."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Iterable, List, Optional, Sequence

from google.adk.events.event import Event
from google.adk.memory import VertexAiMemoryBankService
from google.adk.sessions.session import Session
from google.genai import types

logger = logging.getLogger(__name__)


def _format_user_scope(channel_id: str) -> str:
    return f"channel:{channel_id}"


@dataclass(frozen=True)
class ChannelMemoryItem:
    """Represents a single fact we want to persist about a channel."""

    channel_id: str
    fact: str
    owner: Optional[str] = None
    source: Optional[str] = None
    tags: Sequence[str] = field(default_factory=tuple)

    def as_text(self) -> str:
        segments: List[str] = [f"Channel ID: {self.channel_id}"]
        if self.owner:
            segments.append(f"Owner: {self.owner}")
        if self.tags:
            segments.append(f"Tags: {', '.join(sorted(set(self.tags)))}")
        segments.append(f"Fact: {self.fact}")
        if self.source:
            segments.append(f"Source: {self.source}")
        return " | ".join(segments)


class ChannelMemoryService:
    """Thin wrapper around Vertex AI Memory Bank for channel intelligence."""

    def __init__(
        self,
        *,
        project_id: str,
        location: str,
        agent_engine_id: Optional[str],
        app_name: str,
        enabled: bool = True,
    ):
        self._app_name = app_name
        self._enabled = bool(enabled and project_id and agent_engine_id)
        self._memory_service: Optional[VertexAiMemoryBankService]
        if self._enabled:
            self._memory_service = VertexAiMemoryBankService(
                project=project_id,
                location=location,
                agent_engine_id=agent_engine_id,
            )
        else:
            self._memory_service = None
            logger.info(
                "Channel memory service disabled. Missing project or agent engine id."
            )

    def enabled(self) -> bool:
        return self._enabled and self._memory_service is not None

    def remember(
        self,
        items: Iterable[ChannelMemoryItem],
    ) -> bool:
        """Persist the provided channel facts into the memory bank."""
        if not self.enabled():
            return False

        materialized = [item for item in items if item.fact]
        if not materialized:
            return False

        # Group by user scope so each channel = user namespace.
        grouped: dict[str, list[Event]] = {}
        for item in materialized:
            scope = _format_user_scope(item.channel_id)
            grouped.setdefault(scope, []).append(
                Event(
                    author="channel_memory",
                    content=types.Content(parts=[types.Part(text=item.as_text())]),
                )
            )

        for scope, events in grouped.items():
            session = Session(
                id=f"{scope}-memory",
                app_name=self._app_name,
                user_id=scope,
                events=events,
            )
            self._run_async(self._memory_service.add_session_to_memory(session))  # type: ignore[arg-type]

        return True

    def recall(self, channel_id: str, query: str) -> list[str]:
        """Retrieve relevant stored context for a channel."""
        if not self.enabled():
            return []
        scope = _format_user_scope(channel_id)
        response = self._run_async(
            self._memory_service.search_memory(  # type: ignore[union-attr]
                app_name=self._app_name,
                user_id=scope,
                query=query,
            )
        )
        snippets: list[str] = []
        if not response or not response.memories:
            return snippets
        for memory_entry in response.memories:
            if not memory_entry.content or not memory_entry.content.parts:
                continue
            part = memory_entry.content.parts[0]
            if part.text:
                snippets.append(part.text)
        return snippets

    def _run_async(self, coro):
        loop = asyncio.new_event_loop()
        try:
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(coro)
        finally:
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()
            asyncio.set_event_loop(None)


__all__ = ["ChannelMemoryItem", "ChannelMemoryService"]


