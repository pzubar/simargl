"""Service utilities for refreshing channel metadata via YouTube Data API."""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any, Dict, Optional

from googleapiclient.errors import HttpError

from config.settings import CHANNEL_METADATA_TTL_HOURS
from memory import ChannelMemoryItem, get_channel_memory_service
from tools.youtube_tool import get_youtube_service

from . import get_channel_registry
from .models import ChannelRecord
from .utils import dedupe_aliases, normalize_handle

logger = logging.getLogger(__name__)


class ChannelRefreshService:
    """Fetches fresh snippet/statistics data and updates the registry + memory."""

    def __init__(self, ttl_hours: float = CHANNEL_METADATA_TTL_HOURS):
        self._ttl = ttl_hours
        self._registry = get_channel_registry()
        self._memory = get_channel_memory_service()

    def refresh(self, identifier: str, force: bool = False) -> ChannelRecord:
        """Refresh metadata if stale or forced."""
        record = self._registry.resolve(identifier) or self._registry.find_or_create_by_identifier(identifier)
        if not force and not self._is_stale(record):
            return record

        payload = self._fetch_channel_payload(record)
        if not payload:
            return record

        self._apply_payload(record, payload)
        self._registry.upsert(record)
        self._write_memory_snapshot(record)
        return record

    def _is_stale(self, record: ChannelRecord) -> bool:
        refreshed_at = record.metadata.last_refreshed_at
        if refreshed_at is None:
            return True
        max_age = refreshed_at + timedelta(hours=self._ttl)
        return datetime.utcnow() >= max_age

    def _fetch_channel_payload(self, record: ChannelRecord) -> Optional[Dict[str, Any]]:
        service = get_youtube_service()
        params: Dict[str, Any] = {
            "part": "snippet,statistics",
            "maxResults": 1,
        }
        if record.channel_id.startswith("UC"):
            params["id"] = record.channel_id
        elif record.handle:
            params["forHandle"] = record.handle.lstrip("@")
        else:
            logger.warning("Cannot determine canonical identifier for channel '%s'", record.channel_id)
            return None

        try:
            response = service.channels().list(**params).execute()
        except HttpError as exc:
            logger.warning("YouTube API error when refreshing %s: %s", record.channel_id, exc)
            return None
        items = response.get("items") or []
        if not items:
            logger.warning("No channel data returned for %s", record.channel_id)
            return None
        return items[0]

    def _apply_payload(self, record: ChannelRecord, payload: Dict[str, Any]) -> None:
        snippet = payload.get("snippet", {})
        statistics = payload.get("statistics", {})

        record.channel_id = payload.get("id") or record.channel_id
        record.title = snippet.get("title") or record.title
        record.description = snippet.get("description") or record.description
        record.handle = normalize_handle(snippet.get("customUrl") or record.handle)
        record.metadata.subscriber_count = self._safe_int(statistics.get("subscriberCount"))
        record.metadata.video_count = self._safe_int(statistics.get("videoCount"))
        record.metadata.view_count = self._safe_int(statistics.get("viewCount"))
        record.metadata.last_refreshed_at = datetime.utcnow()
        record.metadata.snapshot = {
            "statistics": statistics,
            "snippet": {
                "publishedAt": snippet.get("publishedAt"),
                "description": snippet.get("description"),
                "title": snippet.get("title"),
            },
        }
        alias_candidates = [record.title, record.handle, record.channel_id]
        record.aliases = dedupe_aliases(record.aliases + [candidate for candidate in alias_candidates if candidate])
        record.updated_at = datetime.utcnow()

    def _write_memory_snapshot(self, record: ChannelRecord) -> None:
        summary_bits = [
            f"Channel title: {record.title or 'Unknown'}",
            f"Handle: @{record.handle}" if record.handle else "",
        ]
        if record.metadata.subscriber_count is not None:
            summary_bits.append(f"Subscribers: {record.metadata.subscriber_count:,}")
        if record.metadata.video_count is not None:
            summary_bits.append(f"Videos: {record.metadata.video_count:,}")
        fact = " | ".join(bit for bit in summary_bits if bit)
        if not fact:
            return
        try:
            self._memory.remember(
                [
                    ChannelMemoryItem(
                        channel_id=record.channel_id,
                        fact=fact,
                        owner=record.owner,
                        tags=["channel_profile"],
                    )
                ]
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to store channel memory for %s: %s", record.channel_id, exc)

    @staticmethod
    def _safe_int(value: Any) -> Optional[int]:
        try:
            return int(value)
        except (TypeError, ValueError):
            return None


__all__ = ["ChannelRefreshService"]


