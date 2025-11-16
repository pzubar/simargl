"Quota-aware tools interacting with the YouTube Data API v3."

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from pydantic import BaseModel, Field

from config.settings import (
    YOUTUBE_API_KEY,
    YOUTUBE_DEFAULT_COMMENT_MAX_RESULTS,
    YOUTUBE_DEFAULT_MAX_RESULTS,
)
from memory import get_file_search_service

logger = logging.getLogger(__name__)
_youtube_service = None


def _format_rfc3339(dt: datetime) -> str:
    """Format datetimes as RFC3339 strings for the YouTube API."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def _maybe_normalize_timestamp(value: Optional[str]) -> Optional[str]:
    """Attempt to coerce user-provided timestamps into RFC3339 strings."""
    if not value:
        return None
    try:
        cleaned = value.strip()
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        dt = datetime.fromisoformat(cleaned)
        return _format_rfc3339(dt)
    except ValueError:
        logger.warning("Unable to parse timestamp '%s'; passing through as-is.", value)
        return value


def get_youtube_service():
    """Create or reuse a YouTube Data API service client."""
    global _youtube_service  # noqa: PLW0603
    if _youtube_service is None:
        _youtube_service = build(
            "youtube",
            "v3",
            developerKey=YOUTUBE_API_KEY,
            cache_discovery=False,
        )
    return _youtube_service


class LatestVideosInput(BaseModel):
    channel_id: str = Field(..., description="The ID of the YouTube channel.")
    max_results: int = Field(
        YOUTUBE_DEFAULT_MAX_RESULTS,
        description="Number of videos to fetch (default 5).",
    )


class VideoCommentsInput(BaseModel):
    video_id: str = Field(..., description="The ID of the YouTube video.")
    max_results: int = Field(
        YOUTUBE_DEFAULT_COMMENT_MAX_RESULTS,
        description="Number of comments to fetch (default 100).",
    )
    file_search_store_name: Optional[str] = Field(
        default=None,
        description="Optional Gemini File Search store name to ingest the retrieved comments.",
    )
    video_title: Optional[str] = Field(
        default=None,
        description="Optional video title used for File Search document naming.",
    )
    channel_id: Optional[str] = Field(
        default=None,
        description="Optional channel ID used when storing metadata.",
    )


class ChannelDetailsInput(BaseModel):
    channel_id: Optional[str] = Field(
        None,
        description="Comma-separated list of YouTube channel IDs.",
    )
    for_username: Optional[str] = Field(
        None,
        description="YouTube username.",
    )
    for_handle: Optional[str] = Field(
        None,
        description="YouTube handle (e.g., GoogleDevelopers or @GoogleDevelopers).",
    )
    part: str = Field(
        "snippet,statistics",
        description="Comma-separated list of channel resource properties to include (e.g., snippet, contentDetails, statistics). Defaults to snippet,statistics.",
    )
    max_results: int = Field(
        YOUTUBE_DEFAULT_MAX_RESULTS,
        description="Number of channels to fetch (0 to 50, default 5).",
    )


class VideoDetailsInput(BaseModel):
    video_id: str = Field(..., description="The ID of the YouTube video.")


class ChannelVideoSearchInput(BaseModel):
    channel_id: str = Field(..., description="The ID of the YouTube channel.")
    q: str = Field(
        "",
        description="Search query string. An empty string returns all videos.",
    )
    published_after: Optional[str] = Field(
        None,
        description="Fetch videos published on or after this RFC3339 timestamp (e.g. 2024-08-01T00:00:00Z).",
    )
    max_results: int = Field(
        YOUTUBE_DEFAULT_MAX_RESULTS,
        description="Number of videos to fetch (default 5).",
    )
    order: str = Field(
        "relevance",
        description="Order of returned resources. Acceptable values are: date, rating, relevance, title, videoCount, viewCount. Defaults to relevance.",
    )


class GetLatestVideosTool(BaseTool):
    """Tool to get the latest videos from a channel. COST: 100 quota units."""

    NAME = "get_latest_videos"
    DESCRIPTION = (
        "Fetches the latest videos (max 5 by default) from a channel. "
        "WARNING: This call costs 100 quota units, so limit usage."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[LatestVideosInput]:
        return LatestVideosInput

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
            max_results=args.get("max_results", YOUTUBE_DEFAULT_MAX_RESULTS),
        )
    def __call__(self, channel_id: str, max_results: int = YOUTUBE_DEFAULT_MAX_RESULTS) -> Dict[str, Any]:
        try:
            max_results = max(1, min(50, max_results))
            service = get_youtube_service()
            request = service.search().list(
                part="snippet",
                channelId=channel_id,
                maxResults=max_results,
                order="date",
                type="video",
            )
            response = request.execute()
            items: List[Dict[str, Any]] = response.get("items", [])
            return {
                "channel_id": channel_id,
                "videos": items,
            }
        except HttpError as http_err:
            logger.exception("YouTube API error when fetching latest videos for %s", channel_id)
            return {
                "channel_id": channel_id,
                "error": f"YouTube API error: {http_err}",
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error when fetching latest videos for %s", channel_id)
            return {
                "channel_id": channel_id,
                "error": f"Unexpected error: {exc}",
            }


class GetVideoCommentsTool(BaseTool):
    """Tool to get top comments from a video. COST: 1 quota unit."""

    NAME = "get_video_comments"
    DESCRIPTION = (
        "Fetches top-level comments (max 100 by default) for a video. "
        "This call costs approximately 1 quota unit."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[VideoCommentsInput]:
        return VideoCommentsInput

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
            max_results=args.get("max_results", YOUTUBE_DEFAULT_COMMENT_MAX_RESULTS),
            file_search_store_name=args.get("file_search_store_name"),
            video_title=args.get("video_title"),
            channel_id=args.get("channel_id"),
        )
    def __call__(
        self,
        video_id: str,
        max_results: int = YOUTUBE_DEFAULT_COMMENT_MAX_RESULTS,
        file_search_store_name: Optional[str] = None,
        video_title: Optional[str] = None,
        channel_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        try:
            max_results = max(1, min(100, max_results))
            service = get_youtube_service()
            request = service.commentThreads().list(
                part="snippet",
                videoId=video_id,
                maxResults=max_results,
                order="relevance",
                textFormat="plainText",
            )
            response = request.execute()
            items: List[Dict[str, Any]] = response.get("items", [])
            payload: Dict[str, Any] = {
                "video_id": video_id,
                "comments": items,
            }
            if file_search_store_name and items:
                ingestion = self._ingest_comments_into_file_search(
                    store_name=file_search_store_name,
                    video_id=video_id,
                    channel_id=channel_id,
                    video_title=video_title,
                    comments=items,
                )
                if ingestion:
                    payload["file_search_document"] = ingestion
            return payload
        except HttpError as http_err:
            logger.exception("YouTube API error when fetching comments for %s", video_id)
            return {
                "video_id": video_id,
                "error": f"YouTube API error: {http_err}",
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error when fetching comments for %s", video_id)
            return {
                "video_id": video_id,
                "error": f"Unexpected error: {exc}",
            }

    def _ingest_comments_into_file_search(
        self,
        *,
        store_name: str,
        video_id: str,
        channel_id: Optional[str],
        video_title: Optional[str],
        comments: List[Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        try:
            snippets: List[str] = []
            for item in comments:
                try:
                    comment_snippet = item["snippet"]["topLevelComment"]["snippet"]
                except KeyError:
                    continue
                author = comment_snippet.get("authorDisplayName", "Unknown")
                text = comment_snippet.get("textDisplay") or comment_snippet.get("textOriginal")
                if not text:
                    continue
                snippets.append(f"{author}: {text}")
            if not snippets:
                return None
            service = get_file_search_service()
            metadata = {
                "video_id": video_id,
                "artifact_type": "comments",
            }
            if channel_id:
                metadata["channel_id"] = channel_id
            display_name = video_title or f"Comments {video_id}"
            return service.upload_text(
                store_name=store_name,
                content="\n".join(snippets),
                display_name=display_name,
                metadata=metadata,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to ingest comments for %s into File Search store %s: %s",
                video_id,
                store_name,
                exc,
            )
            return None

class GetChannelDetailsTool(BaseTool):
    """Tool to get detailed channel metadata. COST: 1 quota unit."""

    NAME = "get_channel_details"
    DESCRIPTION = (
        "Fetches detailed metadata (snippet, statistics, contentDetails) for YouTube channels "
        "by ID, username, or handle. This call costs approximately 1 quota unit."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[ChannelDetailsInput]:
        return ChannelDetailsInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(
            channel_id=args.get("channel_id"),
            for_username=args.get("for_username"),
            for_handle=args.get("for_handle"),
            part=args.get("part", "snippet,statistics"),
            max_results=args.get("max_results", YOUTUBE_DEFAULT_MAX_RESULTS),
        )

    def __call__(
        self,
        channel_id: Optional[str] = None,
        for_username: Optional[str] = None,
        for_handle: Optional[str] = None,
        part: str = "snippet,statistics",
        max_results: int = YOUTUBE_DEFAULT_MAX_RESULTS,
    ) -> Dict[str, Any]:
        try:
            service = get_youtube_service()
            params: Dict[str, Any] = {"part": part}
            filter_count = 0

            if channel_id:
                params["id"] = channel_id
                filter_count += 1
            if for_username:
                params["forUsername"] = for_username
                filter_count += 1
            if for_handle:
                params["forHandle"] = for_handle
                filter_count += 1

            if filter_count != 1:
                return {
                    "error": "Exactly one of channel_id, for_username, or for_handle must be provided."
                }

            params["maxResults"] = max(0, min(50, max_results))

            request = service.channels().list(**params)
            response = request.execute()
            items: List[Dict[str, Any]] = response.get("items", [])
            return {"channels": items}
        except HttpError as http_err:
            logger.exception("YouTube API error when fetching channel details")
            return {"error": f"YouTube API error: {http_err}"}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error when fetching channel details")
            return {"error": f"Unexpected error: {exc}"}


class GetVideoDetailsTool(BaseTool):
    """Tool to get detailed video metadata. COST: 1 quota unit."""

    NAME = "get_video_details"
    DESCRIPTION = (
        "Fetches detailed metadata (snippet, statistics) for a video. "
        "This call costs approximately 1 quota unit."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[VideoDetailsInput]:
        return VideoDetailsInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(video_id=args["video_id"])

    def __call__(self, video_id: str) -> Dict[str, Any]:
        try:
            service = get_youtube_service()
            request = service.videos().list(
                part="snippet,statistics",
                id=video_id,
            )
            response = request.execute()
            items: List[Dict[str, Any]] = response.get("items", [])
            return {
                "video_id": video_id,
                "videos": items,
            }
        except HttpError as http_err:
            logger.exception("YouTube API error when fetching details for %s", video_id)
            return {
                "video_id": video_id,
                "error": f"YouTube API error: {http_err}",
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception("Unexpected error when fetching details for %s", video_id)
            return {
                "video_id": video_id,
                "error": f"Unexpected error: {exc}",
            }


class SearchChannelVideosTool(BaseTool):
    """Tool to search channel videos within a timeframe. COST: 100 quota units."""

    NAME = "search_channel_videos"
    DESCRIPTION = (
        "Searches for channel videos filtered by publication window. "
        "WARNING: This call costs 100 quota units, so limit usage."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[ChannelVideoSearchInput]:
        return ChannelVideoSearchInput

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
            q=args.get("q", ""),
            published_after=args.get("published_after"),
            published_before=args.get("published_before"),
            max_results=args.get("max_results", YOUTUBE_DEFAULT_MAX_RESULTS),
            order=args.get("order", "relevance"),
        )
    def __call__(
        self,
        channel_id: str,
        q: str = "",
        published_after: Optional[str] = None,
        published_before: Optional[str] = None,
        max_results: int = YOUTUBE_DEFAULT_MAX_RESULTS,
        order: str = "relevance",
    ) -> Dict[str, Any]:
        try:
            max_results = max(1, min(50, max_results))
            service = get_youtube_service()
            params: Dict[str, Any] = {
                "part": "snippet",
                "channelId": channel_id,
                "q": q,
                "maxResults": max_results,
                "order": order,
                "type": "video",
            }
            normalized_after = _maybe_normalize_timestamp(published_after)
            normalized_before = _maybe_normalize_timestamp(published_before)
            if normalized_after:
                params["publishedAfter"] = normalized_after
            if normalized_before:
                params["publishedBefore"] = normalized_before

            request = service.search().list(**params)
            response = request.execute()
            items: List[Dict[str, Any]] = response.get("items", [])
            return {
                "channel_id": channel_id,
                "published_after": params.get("publishedAfter"),
                "published_before": params.get("publishedBefore"),
                "videos": items,
            }
        except HttpError as http_err:
            logger.exception(
                "YouTube API error when searching videos for %s", channel_id
            )
            return {
                "channel_id": channel_id,
                "error": f"YouTube API error: {http_err}",
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Unexpected error when searching videos for %s", channel_id
            )
            return {
                "channel_id": channel_id,
                "error": f"Unexpected error: {exc}",
            }


__all__ = (
    "GetLatestVideosTool",
    "GetVideoCommentsTool",
    "GetVideoDetailsTool",
    "GetChannelDetailsTool",
    "SearchChannelVideosTool",
)