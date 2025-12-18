"""Firestore-backed video metadata service with custom tag merging."""

from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, List, Optional

import google.auth
from google.api_core import exceptions as gcloud_exceptions
from google.cloud import firestore

logger = logging.getLogger(__name__)


class VideoMetadataService:
    """CRUD wrapper for the `videos` collection."""

    def __init__(
        self,
        *,
        project_id: str,
        collection: str = "videos",
    ):
        self._client = firestore.Client(project=project_id)
        self._collection = self._client.collection(collection)

        # Log the resolved project and principal to debug IAM/ADC issues (no secrets).
        principal = None
        detected_project = None
        try:
            creds, detected_project = google.auth.default()
            principal = getattr(creds, "service_account_email", None)
        except Exception as exc:  # noqa: BLE001
            logger.debug("Unable to introspect default credentials: %s", exc)

        logger.info(
            "Initialized VideoMetadataService",
            extra={
                "configured_project": project_id,
                "client_project": self._client.project,
                "collection": self._collection.id,
                "default_project": detected_project,
                "principal": principal,
            },
        )

    def upsert_metadata(
        self,
        video_id: str,
        payload: Dict[str, Any],
        merge_custom_tags: bool = True,
    ) -> Dict[str, Any]:
        """Create/update a video document while preserving custom tags."""
        if not video_id:
            raise ValueError("video_id is required")

        doc_ref = self._collection.document(video_id)
        existing_snapshot = doc_ref.get()
        existing = existing_snapshot.to_dict() if existing_snapshot.exists else {}

        incoming_custom = payload.get("custom_tags") or []
        existing_custom = existing.get("custom_tags") or []
        merged_custom = sorted(set(existing_custom + incoming_custom)) if merge_custom_tags else incoming_custom

        final_payload: Dict[str, Any] = {
            **payload,
            "video_id": video_id,
            "custom_tags": merged_custom,
            "updated_at": firestore.SERVER_TIMESTAMP,
        }
        # Preserve create time for new docs.
        if not existing_snapshot.exists:
            final_payload["created_at"] = firestore.SERVER_TIMESTAMP

        doc_ref.set(final_payload, merge=True)
        return final_payload

    def get(self, video_id: str) -> Optional[Dict[str, Any]]:
        if not video_id:
            return None
        snap = self._collection.document(video_id).get()
        return snap.to_dict() if snap.exists else None

    def list(
        self,
        *,
        custom_tag: Optional[str] = None,
        limit: int = 200,
    ) -> List[Dict[str, Any]]:
        query = self._collection
        if custom_tag:
            query = query.where("custom_tags", "array_contains", custom_tag)
        query = query.order_by("published_at", direction=firestore.Query.DESCENDING)

        try:
            docs = query.limit(limit).stream()
            results: List[Dict[str, Any]] = []
            for doc in docs:
                item = doc.to_dict() or {}
                item["has_transcript"] = bool(item.get("rag_resource_name"))
                results.append(item)
            return results
        except gcloud_exceptions.GoogleAPICallError as exc:
            logger.error(
                "Firestore query failed",
                extra={
                    "project": self._client.project,
                    "collection_path": getattr(self._collection, "path", None),
                    "custom_tag": custom_tag,
                    "limit": limit,
                    "code": getattr(exc, "code", None),
                    "details": getattr(exc, "details", None),
                },
            )
            raise
        except Exception:
            logger.exception(
                "Unexpected failure querying Firestore",
                extra={
                    "project": self._client.project,
                    "collection_path": getattr(self._collection, "path", None),
                    "custom_tag": custom_tag,
                    "limit": limit,
                },
            )
            raise

    def delete(self, video_id: str) -> Optional[str]:
        """Delete video doc and return rag_resource_name for cascade."""
        if not video_id:
            return None
        doc_ref = self._collection.document(video_id)
        snap = doc_ref.get()
        rag_resource_name = None
        if snap.exists:
            data = snap.to_dict() or {}
            rag_resource_name = data.get("rag_resource_name")
        doc_ref.delete()
        return rag_resource_name

    def bulk_update_stats(self, stats: Iterable[Dict[str, Any]]) -> None:
        """Batch update numeric counters (view/like) for multiple videos."""
        batch = self._client.batch()
        for entry in stats:
            video_id = entry.get("video_id")
            if not video_id:
                continue
            doc_ref = self._collection.document(video_id)
            batch.set(
                doc_ref,
                {
                    k: v
                    for k, v in entry.items()
                    if k in {"view_count", "like_count", "duration_sec", "published_at"}
                },
                merge=True,
            )
        batch.commit()


__all__ = ["VideoMetadataService"]


