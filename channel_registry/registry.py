"""Persistence-backed channel registry for Simargl."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Optional
from urllib.parse import urlparse

from .models import ChannelRecord

logger = logging.getLogger(__name__)


class ChannelRegistry:
    """Stores channel metadata, aliases, File Search stores, and analyst notes."""

    def __init__(self, store_path: str):
        self._path = Path(store_path)
        self._records: Dict[str, ChannelRecord] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            self._path.parent.mkdir(parents=True, exist_ok=True)
            self._persist()
            return
        try:
            with self._path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
        except json.JSONDecodeError:
            logger.warning("Channel registry file %s is invalid JSON. Starting empty.", self._path)
            data = []
        for entry in data:
            try:
                record = ChannelRecord(**entry)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Skipping invalid channel entry: %s", exc)
                continue
            self._records[record.channel_id] = record

    def _persist(self) -> None:
        serializable = [record.model_dump(mode="json") for record in self._records.values()]
        with self._path.open("w", encoding="utf-8") as handle:
            json.dump(serializable, handle, ensure_ascii=False, indent=2)

    def list_channels(self) -> List[ChannelRecord]:
        return sorted(self._records.values(), key=lambda r: r.title or r.channel_id)

    def get(self, channel_id: str) -> Optional[ChannelRecord]:
        return self._records.get(channel_id)

    def upsert(self, record: ChannelRecord) -> ChannelRecord:
        self._records[record.channel_id] = record
        self._persist()
        return record

    def update_partial(self, channel_id: str, **changes) -> Optional[ChannelRecord]:
        record = self._records.get(channel_id)
        if not record:
            return None
        for field_name, value in changes.items():
            if hasattr(record, field_name) and value is not None:
                setattr(record, field_name, value)
        record.updated_at = datetime.utcnow()
        self._persist()
        return record

    def resolve(self, identifier: str) -> Optional[ChannelRecord]:
        """Resolve a handle, URL, owner name, or alias to a registry entry."""
        if not identifier:
            return None
        tokens = self._expand_identifier(identifier)
        for token in tokens:
            # Channel IDs are unique; check direct hit first.
            if token.startswith("UC") and token in self._records:
                return self._records[token]

        for record in self._records.values():
            record_tokens = set(record.search_tokens())
            if record_tokens & tokens:
                return record
        return None

    def find_or_create_by_identifier(self, identifier: str) -> ChannelRecord:
        """Resolve existing entry or bootstrap a minimal shell record."""
        existing = self.resolve(identifier)
        if existing:
            return existing
        channel_id = self._deduce_channel_id(identifier)
        record = ChannelRecord(
            channel_id=channel_id or identifier,
            handle=self._extract_handle(identifier),
            custom_url=self._extract_custom_slug(identifier),
            title=None,
        )
        if identifier.strip():
            record.aliases.append(identifier.strip())
        self._records[record.channel_id] = record
        self._persist()
        return record

    def _deduce_channel_id(self, identifier: str) -> str:
        """Best-effort guess for channel ID when not provided."""
        cleaned = identifier.strip()
        if cleaned.startswith("UC"):
            return cleaned
        # Synthetic placeholder keyed by slug/handle to avoid collisions.
        return f"synthetic::{cleaned.lower()}"

    @staticmethod
    def _expand_identifier(identifier: str) -> set[str]:
        tokens: set[str] = set()
        cleaned = identifier.strip().lower()
        if not cleaned:
            return tokens
        tokens.add(cleaned)

        if cleaned.startswith("@"):
            tokens.add(cleaned.lstrip("@"))

        parsed = urlparse(cleaned)
        if parsed.netloc:
            path = parsed.path.strip("/")
            if "@" in path:
                tokens.add(path.split("@", maxsplit=1)[1])
            if path:
                tokens.add(path)
        return tokens

    @staticmethod
    def _extract_handle(identifier: str) -> Optional[str]:
        text = identifier.strip()
        if "youtube.com" in text:
            parsed = urlparse(text)
            if parsed.path and "@" in parsed.path:
                return parsed.path.split("@", maxsplit=1)[1]
        if text.startswith("@"):
            return text.lstrip("@")
        return None

    @staticmethod
    def _extract_custom_slug(identifier: str) -> Optional[str]:
        text = identifier.strip()
        if "youtube.com" not in text:
            return None
        parsed = urlparse(text)
        path = parsed.path.strip("/")
        if not path:
            return None
        segments = path.split("/")
        if segments[0].lower() in {"c", "channel"} and len(segments) > 1:
            return segments[1]
        return segments[-1]


__all__ = ["ChannelRegistry"]


