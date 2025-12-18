"""Firestore-backed channel registry service."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from google.cloud import firestore

logger = logging.getLogger(__name__)


class ChannelRegistryService:
    """Persist channel registry records in Firestore."""

    def __init__(
        self,
        *,
        project_id: str,
        collection: str = "channels",
    ):
        self._client = firestore.Client(project=project_id)
        self._collection = self._client.collection(collection)

    def upsert(
        self,
        channel_id: str,
        *,
        channel_title: str,
        description: Optional[str] = None,
        last_indexed_at: Optional[Any] = None,
        increment_video_count: bool = False,
    ) -> Dict[str, Any]:
        if not channel_id:
            raise ValueError("channel_id is required")
        doc_ref = self._collection.document(channel_id)
        updates: Dict[str, Any] = {
            "channel_id": channel_id,
            "channel_title": channel_title,
            "description": description,
            "last_indexed_at": last_indexed_at or firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        if increment_video_count:
            updates["total_videos_indexed"] = firestore.Increment(1)
        doc_ref.set(updates, merge=True)
        return updates

    def get(self, channel_id: str) -> Optional[Dict[str, Any]]:
        if not channel_id:
            return None
        snap = self._collection.document(channel_id).get()
        return snap.to_dict() if snap.exists else None

    def delete(self, channel_id: str) -> None:
        if not channel_id:
            return
        self._collection.document(channel_id).delete()


__all__ = ["ChannelRegistryService"]


