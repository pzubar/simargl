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
        channel_title: Optional[str] = None,
        description: Optional[str] = None,
        last_indexed_at: Optional[Any] = None,
        increment_video_count: bool = False,
        owner: Optional[str] = None,
        notes: Optional[str] = None,
        uploads_next_page_token: Optional[str] = None,
        uploads_last_ingested_at: Optional[Any] = None,
    ) -> Dict[str, Any]:
        if not channel_id:
            raise ValueError("channel_id is required")
        doc_ref = self._collection.document(channel_id)
        updates: Dict[str, Any] = {
            "channel_id": channel_id,
            "channel_title": channel_title or channel_id,
            "description": description,
            "last_indexed_at": last_indexed_at or firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        if uploads_next_page_token is not None:
            updates["uploads_next_page_token"] = uploads_next_page_token
        if uploads_last_ingested_at is not None:
            updates["uploads_last_ingested_at"] = uploads_last_ingested_at
        if increment_video_count:
            updates["total_videos_indexed"] = firestore.Increment(1)
        if owner:
            updates["owner"] = owner
        if notes:
            updates["notes"] = notes
        doc_ref.set(updates, merge=True)
        return updates

    def list_channels(self, limit: int = 100) -> list[Dict[str, Any]]:
        """Return channel docs ordered by channel_id (Firetore collection)."""
        query = self._collection.order_by("channel_id").limit(limit)
        docs = query.stream()
        results: list[Dict[str, Any]] = []
        for doc in docs:
            data = doc.to_dict() or {}
            # Ensure channel_id is always present for downstream UI.
            data["channel_id"] = data.get("channel_id") or doc.id
            results.append(data)
        return results

    def get(self, channel_id: str) -> Optional[Dict[str, Any]]:
        if not channel_id:
            return None
        snap = self._collection.document(channel_id).get()
        return snap.to_dict() if snap.exists else None

    def update_partial(self, channel_id: str, **changes: Any) -> Optional[Dict[str, Any]]:
        """Update selected fields like owner/notes/title without overwriting others."""
        if not channel_id:
            return None
        allowed_fields = {
            "owner",
            "notes",
            "channel_title",
            "description",
            "last_indexed_at",
            "total_videos_indexed",
            "uploads_next_page_token",
            "uploads_last_ingested_at",
        }
        updates: Dict[str, Any] = {
            k: v for k, v in changes.items() if k in allowed_fields and v is not None
        }
        if not updates:
            return self.get(channel_id)

        updates["updated_at"] = firestore.SERVER_TIMESTAMP
        doc_ref = self._collection.document(channel_id)
        if not doc_ref.get().exists:
            return None
        doc_ref.update(updates)
        updated = doc_ref.get()
        return updated.to_dict() if updated.exists else None

    def get_ingest_state(self, channel_id: str) -> Optional[Dict[str, Any]]:
        if not channel_id:
            return None
        snap = self._collection.document(channel_id).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        return {
            "uploads_next_page_token": data.get("uploads_next_page_token"),
            "uploads_last_ingested_at": data.get("uploads_last_ingested_at"),
        }

    def update_ingest_state(
        self,
        channel_id: str,
        *,
        uploads_next_page_token: Optional[str],
        last_ingested_at: Optional[Any],
    ) -> Optional[Dict[str, Any]]:
        if not channel_id:
            return None
        doc_ref = self._collection.document(channel_id)
        updates: Dict[str, Any] = {
            "uploads_next_page_token": uploads_next_page_token,
            "uploads_last_ingested_at": last_ingested_at or firestore.SERVER_TIMESTAMP,
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        doc_ref.set(updates, merge=True)
        snap = doc_ref.get()
        return snap.to_dict() if snap.exists else None

    def delete(self, channel_id: str) -> None:
        if not channel_id:
            return
        self._collection.document(channel_id).delete()


__all__ = ["ChannelRegistryService"]


