"""Tools for ingesting, maintaining, and retrieving hybrid memory records."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from pydantic import BaseModel, Field
from youtube_transcript_api import YouTubeTranscriptApi, NoTranscriptFound, TranscriptsDisabled

from config.settings import YOUTUBE_API_KEY
from memory import (
    get_channel_registry_service,
    get_file_search_service,
    get_video_metadata_service,
)
from tools.youtube.time_utils import parse_iso8601_duration

logger = logging.getLogger(__name__)


# ---------- Pydantic Schemas ----------
class IngestVideoInput(BaseModel):
    video_id: str = Field(..., description="YouTube video ID to ingest.")
    file_search_store_name: str = Field(
        ...,
        description="Gemini File Search store name where the transcript/content will be saved.",
    )


class MaintenanceInput(BaseModel):
    video_id: str = Field(..., description="Target video ID.")
    add_custom_tags: Optional[List[str]] = Field(
        default=None, description="Tags to merge into custom_tags (deduped)."
    )
    agent_summary: Optional[str] = Field(
        default=None, description="Updated short summary for UI display."
    )
    view_count: Optional[int] = Field(default=None, description="Updated view count.")
    like_count: Optional[int] = Field(default=None, description="Updated like count.")


class RetrievalInput(BaseModel):
    custom_tag: Optional[str] = Field(
        default=None, description="Filter videos that contain this custom tag."
    )
    min_view_count: Optional[int] = Field(default=None, description="Only return videos with at least this many views.")
    limit: int = Field(default=25, description="Maximum rows to return.")


class QueryChannelVideosInput(BaseModel):
    channel_id: str = Field(
        ...,
        description="The YouTube channel ID (UC...) to query videos for.",
    )
    order_by: str = Field(
        default="view_count",
        description="Field to sort by. Options: 'view_count', 'published_at', 'like_count'.",
    )
    descending: bool = Field(
        default=True,
        description="Sort direction. True for descending (highest first), False for ascending.",
    )
    limit: int = Field(
        default=10,
        description="Maximum number of videos to return.",
    )


class RefreshVideoStatsInput(BaseModel):
    video_ids: List[str] = Field(
        ...,
        description="List of YouTube video IDs to refresh stats for (max 50).",
    )


# ---------- Helper utilities ----------
def _fetch_video_details(video_id: str) -> Dict[str, Any]:
    service = build("youtube", "v3", developerKey=YOUTUBE_API_KEY, cache_discovery=False)
    request = service.videos().list(part="snippet,statistics,contentDetails", id=video_id)
    response = request.execute()
    items = response.get("items", [])
    if not items:
        raise ValueError(f"Video {video_id} not found.")
    item = items[0]
    snippet = item.get("snippet", {})
    stats = item.get("statistics", {})
    content_details = item.get("contentDetails", {})
    duration_iso = content_details.get("duration", "PT0S")
    duration_sec = parse_iso8601_duration(duration_iso)
    return {
        "title": snippet.get("title"),
        "description": snippet.get("description"),
        "published_at": snippet.get("publishedAt"),
        "channel_id": snippet.get("channelId"),
        "channel_title": snippet.get("channelTitle"),
        "view_count": int(stats.get("viewCount", 0)),
        "like_count": int(stats.get("likeCount", 0)) if stats.get("likeCount") else 0,
        "duration_sec": duration_sec,
        "tags": snippet.get("tags", []),
    }


def _fetch_transcript_text(video_id: str) -> Optional[str]:
    try:
        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)
        manual = transcript_list.find_manually_created_transcript(transcript_list._manually_created_transcripts.keys())
        if not manual:
            manual = transcript_list.find_transcript(transcript_list._manually_created_transcripts.keys())
        transcript = manual.fetch()
        segments = [seg.get("text", "") for seg in transcript]
        return "\n".join(segments).strip()
    except (NoTranscriptFound, TranscriptsDisabled):
        logger.warning("Transcript unavailable for %s", video_id)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to fetch transcript for %s: %s", video_id, exc)
        return None


# ---------- Tools ----------
class IngestVideoTool(BaseTool):
    """Fetch YouTube data, write to Firestore, and upload transcript to File Search."""

    NAME = "ingest_video_memory"
    DESCRIPTION = (
        "Ingest a YouTube video into hybrid memory: fetch metadata, save channel+video records to Firestore, "
        "upload transcript/description/title to Gemini File Search, and store the returned resource link."
    )

    def __init__(self) -> None:
        super().__init__(name=self.NAME, description=self.DESCRIPTION)

    @property
    def args_schema(self) -> type[IngestVideoInput]:
        return IngestVideoInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(
            video_id=args["video_id"],
            file_search_store_name=args["file_search_store_name"],
        )

    def __call__(self, video_id: str, file_search_store_name: str) -> Dict[str, Any]:
        try:
            details = _fetch_video_details(video_id)
            transcript_text = _fetch_transcript_text(video_id) or ""
            combined_content = "\n\n".join(
                [
                    details.get("title") or "",
                    details.get("description") or "",
                    "Transcript:",
                    transcript_text,
                ]
            ).strip()

            # Upload to File Search
            fs_service = get_file_search_service()
            doc_result = fs_service.upload_text(
                store_name=file_search_store_name,
                content=combined_content,
                display_name=details.get("title") or f"Video {video_id}",
                metadata={
                    "video_id": video_id,
                    "channel_id": details.get("channel_id", ""),
                },
            )
            rag_resource_name = doc_result.get("document_name") if doc_result else None

            # Write channel registry
            channel_service = get_channel_registry_service()
            channel_service.upsert(
                channel_id=details.get("channel_id", ""),
                channel_title=details.get("channel_title") or "",
                description=details.get("description"),
                increment_video_count=True,
            )

            # Write video metadata
            video_service = get_video_metadata_service()
            video_service.upsert_metadata(
                video_id,
                {
                    "title": details.get("title"),
                    "published_at": details.get("published_at"),
                    "duration_sec": details.get("duration_sec"),
                    "view_count": details.get("view_count"),
                    "like_count": details.get("like_count"),
                    "tags": details.get("tags") or [],
                    "custom_tags": [],
                    "channel_id": details.get("channel_id"),
                    "agent_summary": None,
                    "rag_resource_name": rag_resource_name,
                },
            )

            return {
                "status": "success",
                "video_id": video_id,
                "channel_id": details.get("channel_id"),
                "rag_resource_name": rag_resource_name,
            }
        except HttpError as http_err:
            logger.exception("YouTube API error during ingest")
            return {"status": "error", "message": f"YouTube API error: {http_err}"}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to ingest video %s", video_id)
            return {"status": "error", "message": str(exc)}


class MaintainVideoMetadataTool(BaseTool):
    """Atomic updates to Firestore-backed video metadata."""

    NAME = "update_video_metadata"
    DESCRIPTION = "Update video stats, summary, or add custom tags without overwriting existing ones."

    def __init__(self) -> None:
        super().__init__(name=self.NAME, description=self.DESCRIPTION)

    @property
    def args_schema(self) -> type[MaintenanceInput]:
        return MaintenanceInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(**args)

    def __call__(
        self,
        video_id: str,
        add_custom_tags: Optional[List[str]] = None,
        agent_summary: Optional[str] = None,
        view_count: Optional[int] = None,
        like_count: Optional[int] = None,
    ) -> Dict[str, Any]:
        try:
            updates: Dict[str, Any] = {}
            if add_custom_tags:
                updates["custom_tags"] = add_custom_tags
            if agent_summary is not None:
                updates["agent_summary"] = agent_summary
            if view_count is not None:
                updates["view_count"] = view_count
            if like_count is not None:
                updates["like_count"] = like_count

            service = get_video_metadata_service()
            merged = service.upsert_metadata(
                video_id,
                updates,
                merge_custom_tags=True,
            )
            return {"status": "success", "video_id": video_id, "metadata": merged}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to update metadata for %s", video_id)
            return {"status": "error", "message": str(exc)}


class RetrieveVideosTool(BaseTool):
    """Query Firestore metadata with simple filters and return enriched rows."""

    NAME = "retrieve_videos"
    DESCRIPTION = "Return video metadata rows filtered by custom tag and minimum view count."

    def __init__(self) -> None:
        super().__init__(name=self.NAME, description=self.DESCRIPTION)

    @property
    def args_schema(self) -> type[RetrievalInput]:
        return RetrievalInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(
            custom_tag=args.get("custom_tag"),
            min_view_count=args.get("min_view_count"),
            limit=args.get("limit", 25),
        )

    def __call__(
        self,
        custom_tag: Optional[str] = None,
        min_view_count: Optional[int] = None,
        limit: int = 25,
    ) -> Dict[str, Any]:
        service = get_video_metadata_service()
        records = service.list(custom_tag=custom_tag, limit=limit)
        if min_view_count is not None:
            records = [row for row in records if (row.get("view_count") or 0) >= min_view_count]
        # Decorate channel title if available from registry
        channel_service = get_channel_registry_service()
        for row in records:
            channel_id = row.get("channel_id")
            channel = channel_service.get(channel_id) if channel_id else None
            if channel:
                row["channel_title"] = channel.get("channel_title")
        return {"status": "success", "results": records}


class QueryChannelVideosTool(BaseTool):
    """Query videos for a specific channel from Firestore with sorting options."""

    NAME = "query_channel_videos"
    DESCRIPTION = (
        "Query videos from the local database (Firestore) for a specific channel. "
        "Supports sorting by view_count, published_at, or like_count. "
        "Use this as the PRIMARY source for channel video queries - only use YouTube API "
        "when explicitly asked to 'search YouTube' or when the channel is not in the database. "
        "Stats may be stale; use refresh_video_stats to update if needed."
    )

    def __init__(self) -> None:
        super().__init__(name=self.NAME, description=self.DESCRIPTION)

    @property
    def args_schema(self) -> type[QueryChannelVideosInput]:
        return QueryChannelVideosInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(
            channel_id=args["channel_id"],
            order_by=args.get("order_by", "view_count"),
            descending=args.get("descending", True),
            limit=args.get("limit", 10),
        )

    def __call__(
        self,
        channel_id: str,
        order_by: str = "view_count",
        descending: bool = True,
        limit: int = 10,
    ) -> Dict[str, Any]:
        try:
            # Check if channel exists in registry first
            channel_service = get_channel_registry_service()
            channel_record = channel_service.get(channel_id)

            video_service = get_video_metadata_service()

            # Get video count for the channel
            video_count = video_service.count_by_channel(channel_id)

            if video_count == 0:
                return {
                    "status": "not_found",
                    "channel_id": channel_id,
                    "channel_in_registry": channel_record is not None,
                    "message": (
                        f"No videos found in database for channel {channel_id}. "
                        "The channel may not have been ingested yet. "
                        "Would you like me to: (a) Search YouTube for this channel's videos, or "
                        "(b) Ingest this channel first to build the local database?"
                    ),
                    "videos": [],
                    "total_in_database": 0,
                }

            # Query videos with sorting
            videos = video_service.list_by_channel_sorted(
                channel_id,
                order_by=order_by,
                descending=descending,
                limit=limit,
            )

            # Enrich with channel title
            channel_title = None
            if channel_record:
                channel_title = channel_record.get("channel_title")

            for video in videos:
                if channel_title:
                    video["channel_title"] = channel_title
                # Add YouTube URL for convenience
                video_id = video.get("video_id")
                if video_id:
                    video["url"] = f"https://www.youtube.com/watch?v={video_id}"

            return {
                "status": "success",
                "channel_id": channel_id,
                "channel_title": channel_title,
                "order_by": order_by,
                "descending": descending,
                "total_in_database": video_count,
                "returned_count": len(videos),
                "videos": videos,
                "note": "Stats may be stale. Use refresh_video_stats to update view/like counts.",
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to query channel videos for %s", channel_id)
            return {"status": "error", "channel_id": channel_id, "message": str(exc)}


class RefreshVideoStatsTool(BaseTool):
    """Batch-refresh view/like counts from YouTube API for videos in Firestore."""

    NAME = "refresh_video_stats"
    DESCRIPTION = (
        "Refresh view_count and like_count for a list of video IDs from YouTube API. "
        "Use this after query_channel_videos if the user wants up-to-date statistics. "
        "Accepts up to 50 video IDs per call. Cost: 1 quota unit per batch of 50."
    )

    def __init__(self) -> None:
        super().__init__(name=self.NAME, description=self.DESCRIPTION)

    @property
    def args_schema(self) -> type[RefreshVideoStatsInput]:
        return RefreshVideoStatsInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(video_ids=args["video_ids"])

    def __call__(self, video_ids: List[str]) -> Dict[str, Any]:
        if not video_ids:
            return {"status": "error", "message": "No video IDs provided."}

        # Limit to 50 IDs per batch (YouTube API limit)
        video_ids = video_ids[:50]

        try:
            service = build("youtube", "v3", developerKey=YOUTUBE_API_KEY, cache_discovery=False)
            request = service.videos().list(
                part="statistics",
                id=",".join(video_ids),
            )
            response = request.execute()

            stats_updates: List[Dict[str, Any]] = []
            for item in response.get("items", []):
                video_id = item.get("id")
                statistics = item.get("statistics", {})
                view_count = statistics.get("viewCount")
                like_count = statistics.get("likeCount")

                stats_updates.append({
                    "video_id": video_id,
                    "view_count": int(view_count) if view_count else None,
                    "like_count": int(like_count) if like_count else None,
                })

            # Batch update Firestore
            if stats_updates:
                video_service = get_video_metadata_service()
                video_service.bulk_update_stats(stats_updates)

            return {
                "status": "success",
                "updated_count": len(stats_updates),
                "updated_videos": stats_updates,
            }
        except HttpError as http_err:
            logger.exception("YouTube API error during stats refresh")
            return {"status": "error", "message": f"YouTube API error: {http_err}"}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to refresh video stats")
            return {"status": "error", "message": str(exc)}


__all__ = [
    "IngestVideoTool",
    "MaintainVideoMetadataTool",
    "RetrieveVideosTool",
    "QueryChannelVideosTool",
    "RefreshVideoStatsTool",
]



