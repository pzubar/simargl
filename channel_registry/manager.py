"""High-level registry manager for menu-driven channel operations."""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional

from . import get_channel_registry
from .models import ChannelRecord
from .refresh_service import ChannelRefreshService
from .registry import ChannelRegistry
from .utils import dedupe_aliases, normalize_handle

logger = logging.getLogger(__name__)


def _normalize_aliases(candidate_aliases: Iterable[Optional[str]]) -> List[str]:
    return dedupe_aliases(candidate_aliases)


class ChannelRegistryManager:
    """Coordinates registry CRUD with YouTube fetches and manual fields."""

    def __init__(
        self,
        registry: Optional[ChannelRegistry] = None,
        refresher: Optional[ChannelRefreshService] = None,
    ):
        self._registry = registry or get_channel_registry()
        self._refresher = refresher or ChannelRefreshService()

    def view_summary(self) -> List[Dict[str, Any]]:
        """Return a compact summary of all channels."""
        records = self._registry.list_channels()
        return [self._summarize_record(record) for record in records]

    def add_channel(
        self,
        identifier: str,
        owner: Optional[str] = None,
        notes: Optional[str] = None,
        aliases: Optional[Iterable[str]] = None,
    ) -> ChannelRecord:
        """Add or resolve a channel and refresh metadata."""
        normalized_id = identifier.strip()
        record = self._registry.resolve(normalized_id) or self._registry.find_or_create_by_identifier(normalized_id)
        manual_aliases = _normalize_aliases(aliases or [])
        self._registry.update_partial(
            record.channel_id,
            owner=owner,
            notes=notes,
            aliases=manual_aliases,
            base_identifier=normalized_id,
        )
        refreshed = self._refresher.refresh(record.channel_id or normalized_id, force=True)
        return refreshed

    def update_manual_fields(
        self,
        identifier: str,
        owner: Optional[str] = None,
        notes: Optional[str] = None,
        aliases: Optional[Iterable[str]] = None,
    ) -> Optional[ChannelRecord]:
        """Update only owner/notes/aliases for an existing record."""
        record = self._registry.resolve(identifier)
        if not record:
            return None
        manual_aliases = _normalize_aliases(aliases or [])
        return self._registry.update_partial(
            record.channel_id,
            owner=owner,
            notes=notes,
            aliases=manual_aliases,
            base_identifier=identifier,
        )

    def refresh(self, identifier: str, force: bool = False) -> ChannelRecord:
        """Refresh metadata while preserving manual fields."""
        return self._refresher.refresh(identifier, force=force)

    @staticmethod
    def _summarize_record(record: ChannelRecord) -> Dict[str, Any]:
        handle = normalize_handle(record.handle)
        return {
            "channel_id": record.channel_id,
            "handle": handle,
            "title": record.title,
            "owner": record.owner,
            "notes": record.notes,
            "aliases": record.aliases,
            "subscriber_count": record.metadata.subscriber_count,
            "video_count": record.metadata.video_count,
            "view_count": record.metadata.view_count,
            "last_refreshed_at": record.metadata.last_refreshed_at.isoformat() if record.metadata.last_refreshed_at else None,
        }


__all__ = ["ChannelRegistryManager"]
