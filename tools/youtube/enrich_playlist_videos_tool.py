from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from googleapiclient.errors import HttpError
from pydantic import BaseModel, Field

from tools.youtube.client import execute_request, get_youtube_service, redact_request_uri
from tools.youtube.time_utils import parse_iso8601_duration

logger = logging.getLogger(__name__)


def _parse_rfc3339(timestamp: Optional[str]) -> Optional[datetime]:
    if not timestamp:
        return None
    try:
        cleaned = timestamp.replace("Z", "+00:00")
        return datetime.fromisoformat(cleaned).astimezone(timezone.utc)
    except ValueError:
        logger.warning("Failed to parse timestamp %s", timestamp)
        return None


def _enrich_video_ids(video_ids: List[str], service, order: str) -> List[Dict[str, Any]]:
    request = service.videos().list(
        part="snippet,statistics,contentDetails,topicDetails",
        id=",".join(video_ids),
    )
    sanitized_uri = redact_request_uri(request)
    if sanitized_uri:
        logger.info("YouTube API request (video details for enrich): %s", sanitized_uri)
    response = execute_request(request, retries=2, label="video details enrich")
    items = response.get("items", [])

    enriched: List[Dict[str, Any]] = []
    for item in items:
        video_id = item.get("id")
        merged: Dict[str, Any] = {
            "video_id": video_id,
            "statistics": item.get("statistics", {}),
            "contentDetails": item.get("contentDetails", {}),
            "topicDetails": item.get("topicDetails", {}),
            "snippet": item.get("snippet", {}),
        }
        view_count_value = (
            merged.get("statistics", {}).get("viewCount")
            if isinstance(merged.get("statistics"), dict)
            else None
        )
        try:
            view_count = int(view_count_value) if view_count_value is not None else None
        except (TypeError, ValueError):
            view_count = None
        merged["view_count"] = view_count
        merged["publish_date"] = merged.get("snippet", {}).get("publishedAt")
        duration_iso = merged.get("contentDetails", {}).get("duration")
        if duration_iso:
            try:
                merged["duration_seconds"] = parse_iso8601_duration(duration_iso)
                merged["duration"] = duration_iso
            except ValueError:
                logger.warning("Failed to parse duration for video %s", video_id)
        tags = merged.get("snippet", {}).get("tags")
        merged["tags"] = tags or []
        enriched.append(merged)

    if order == "viewCount":
        enriched.sort(key=lambda item: item.get("view_count") or 0, reverse=True)
    elif order == "date":
        enriched.sort(
            key=lambda item: _parse_rfc3339(item.get("publish_date")) or datetime.min.replace(tzinfo=timezone.utc),
            reverse=True,
        )
    return enriched


class EnrichPlaylistVideosInput(BaseModel):
    video_ids: List[str] = Field(
        ...,
        description="List of video IDs to enrich (max 50).",
    )
    order: str = Field(
        "viewCount",
        description="Local sort order: viewCount (default) or date. Any other value preserves API order.",
    )
    max_results: Optional[int] = Field(
        None,
        description="Optional cap on results after enrichment (<=50).",
    )


class EnrichPlaylistVideosTool(BaseTool):
    """Fetch video details for playlist items and optionally sort locally."""

    NAME = "enrich_playlist_videos"
    DESCRIPTION = (
        "Fetches video details for a list of video IDs (from playlistItems) and sorts locally "
        "by viewCount or publish date. Use after list_channel_uploads when you need stats."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[EnrichPlaylistVideosInput]:
        return EnrichPlaylistVideosInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(
            video_ids=args["video_ids"],
            order=args.get("order", "viewCount"),
            max_results=args.get("max_results"),
        )

    def __call__(
        self,
        video_ids: List[str],
        order: str = "viewCount",
        max_results: Optional[int] = None,
    ) -> Dict[str, Any]:
        try:
            ids = [vid for vid in video_ids if vid]
            if not ids:
                return {"error": "video_ids must be a non-empty list"}
            ids = ids[:50]
            service = get_youtube_service()
            enriched_items = _enrich_video_ids(ids, service, order)
            if max_results is not None:
                try:
                    cap = max(1, min(50, int(max_results)))
                    enriched_items = enriched_items[:cap]
                except (TypeError, ValueError):
                    pass
            return {
                "videos": enriched_items,
                "order": order,
                "source": "videos.list",
            }
        except HttpError as http_err:
            logger.exception("YouTube API error when enriching playlist videos")
            return {"error": f"YouTube API error: {http_err}"}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error when enriching playlist videos")
            return {"error": f"Unexpected error: {exc}"}


__all__ = [
    "EnrichPlaylistVideosInput",
    "EnrichPlaylistVideosTool",
]
