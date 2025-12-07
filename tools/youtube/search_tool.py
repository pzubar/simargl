"""Tools for YouTube search and listing flows."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from googleapiclient.errors import HttpError
from pydantic import BaseModel, Field

from config.settings import (
    YOUTUBE_DEFAULT_MAX_RESULTS,
)
from tools.youtube.client import (
    execute_request,
    get_youtube_service,
    redact_request_uri,
    resolve_channel_identifier,
)
from tools.youtube.time_utils import maybe_normalize_timestamp, parse_iso8601_duration

logger = logging.getLogger(__name__)


class LatestVideosInput(BaseModel):
    channel_id: str = Field(..., description="The ID of the YouTube channel.")
    max_results: int = Field(
        YOUTUBE_DEFAULT_MAX_RESULTS,
        description="Number of videos to fetch (default 5).",
    )


class ChannelVideoSearchInput(BaseModel):
    channel_id: str = Field(..., description="The ID of the YouTube channel.")
    q: str = Field(
        "",
        description=(
            "Search query string. Avoid stuffing years/dates here; use published_after/before instead. "
            "An empty string returns all videos."
        ),
    )
    published_after: str = Field(
        ...,
        description=(
            "Fetch videos published on or after this timestamp. "
            "Provide ISO date (YYYY-MM-DD) or RFC3339 (e.g. 2024-08-01T00:00:00Z). "
            "This field is mandatory."
        ),
    )
    published_before: str = Field(
        ...,
        description=(
            "Fetch videos published before this timestamp. "
            "Provide ISO date (YYYY-MM-DD) or RFC3339 (e.g. 2024-09-01T00:00:00Z). "
            "This field is mandatory."
        ),
    )
    max_results: int = Field(
        YOUTUBE_DEFAULT_MAX_RESULTS,
        description="Number of videos to fetch (default 5).",
    )
    order: str = Field(
        "viewCount",
        description=(
            "Order of returned resources. Acceptable values: date, rating, relevance, "
            "title, videoCount, viewCount. Use viewCount for 'most popular' or 'top' queries."
        ),
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
            resolved_channel_id = resolve_channel_identifier(channel_id)
            if not resolved_channel_id:
                return {
                    "channel_id": channel_id,
                    "error": "Invalid channel identifier. Provide a YouTube channel ID or known handle/title from registry.",
                }
            max_results = max(1, min(50, max_results))
            service = get_youtube_service()
            request = service.search().list(
                part="snippet",
                channelId=resolved_channel_id,
                maxResults=max_results,
                order="date",
                type="video",
            )
            sanitized_uri = redact_request_uri(request)
            if sanitized_uri:
                logger.info("YouTube API request (latest videos): %s", sanitized_uri)
            response = execute_request(request, retries=2, label="latest videos")
            items: List[Dict[str, Any]] = response.get("items", [])
            return {
                "channel_id": resolved_channel_id,
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


class SearchChannelVideosTool(BaseTool):
    """Tool to search channel videos within a timeframe. COST: 100 quota units."""

    NAME = "search_channel_videos"
    DESCRIPTION = (
        "Searches for channel videos filtered by a REQUIRED publication window. "
        "Always supply both published_after and published_before (YYYY-MM-DD or RFC3339). "
        "Use order=viewCount for 'most popular' or 'top' requests. Results include tags, duration, "
        "view counts, and topic details to help verify relevance (e.g., political context). "
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
            published_after=args["published_after"],
            published_before=args["published_before"],
            max_results=args.get("max_results", YOUTUBE_DEFAULT_MAX_RESULTS),
            order=args.get("order", "viewCount"),
        )

    def __call__(
        self,
        channel_id: str,
        q: str = "",
        published_after: str = "",
        published_before: str = "",
        max_results: int = YOUTUBE_DEFAULT_MAX_RESULTS,
        order: str = "viewCount",
    ) -> Dict[str, Any]:
        try:
            resolved_channel_id = resolve_channel_identifier(channel_id)
            if not resolved_channel_id:
                return {
                    "channel_id": channel_id,
                    "error": "Invalid channel identifier. Provide a YouTube channel ID or known handle/title from registry.",
                }
            if not published_after or not published_before:
                return {
                    "channel_id": resolved_channel_id,
                    "error": "published_after and published_before are required (use ISO date or RFC3339).",
                }

            max_results = max(1, min(50, max_results))
            search_max_results = (
                max_results if order != "viewCount" else min(50, max_results + 5)
            )
            service = get_youtube_service()
            params: Dict[str, Any] = {
                "part": "snippet",
                "channelId": resolved_channel_id,
                "q": q,
                "maxResults": search_max_results,
                "order": order,
                "type": "video",
            }
            normalized_after = maybe_normalize_timestamp(published_after)
            normalized_before = maybe_normalize_timestamp(published_before)
            if normalized_after:
                params["publishedAfter"] = normalized_after
            if normalized_before:
                params["publishedBefore"] = normalized_before

            logger.info("YouTube search request params: %s", {k: v for k, v in params.items() if k != "key"})
            request = service.search().list(**params)
            sanitized_uri = redact_request_uri(request)
            if sanitized_uri:
                logger.info("YouTube API request (search): %s", sanitized_uri)
            response = execute_request(request, retries=2, label="search")
            items: List[Dict[str, Any]] = response.get("items", [])
            video_ids: List[str] = [
                item.get("id", {}).get("videoId")
                for item in items
                if item.get("id", {}).get("videoId")
            ]

            enriched_items: List[Dict[str, Any]] = []
            details_map: Dict[str, Dict[str, Any]] = {}

            if video_ids:
                try:
                    details_request = service.videos().list(
                        part="snippet,statistics,contentDetails,topicDetails",
                        id=",".join(video_ids),
                    )
                    sanitized_details_uri = redact_request_uri(details_request)
                    if sanitized_details_uri:
                        logger.info(
                            "YouTube API request (video details batch): %s",
                            sanitized_details_uri,
                        )
                    details_response = execute_request(
                        details_request, retries=2, label="video details batch"
                    )
                    details_map = {
                        item["id"]: item
                        for item in details_response.get("items", [])
                        if item.get("id")
                    }
                except HttpError:
                    logger.exception(
                        "YouTube API error when fetching video details for %s", channel_id
                    )
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "Unexpected error when fetching video details for %s", channel_id
                    )

            for item in items:
                video_id = item.get("id", {}).get("videoId")
                detail = details_map.get(video_id, {})
                merged = dict(item)
                merged["video_id"] = video_id
                if detail:
                    merged["statistics"] = detail.get("statistics", {})
                    merged["contentDetails"] = detail.get("contentDetails", {})
                    merged["topicDetails"] = detail.get("topicDetails", {})
                    if detail.get("snippet"):
                        merged["snippet"] = detail.get("snippet")

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

                snippet = merged.get("snippet") or {}
                merged["publish_date"] = snippet.get("publishedAt")
                tags = snippet.get("tags") if isinstance(snippet, dict) else None
                merged["tags"] = tags or []

                duration_iso = (
                    merged.get("contentDetails", {}).get("duration")
                    if isinstance(merged.get("contentDetails"), dict)
                    else None
                )
                if duration_iso:
                    try:
                        merged["duration_seconds"] = parse_iso8601_duration(duration_iso)
                        merged["duration"] = duration_iso
                    except ValueError:
                        logger.warning("Failed to parse duration for video %s", video_id)

                enriched_items.append(merged)

            if order == "viewCount":
                enriched_items.sort(key=lambda item: item.get("view_count") or 0, reverse=True)
            enriched_items = enriched_items[:max_results]

            return {
                "channel_id": resolved_channel_id,
                "published_after": params.get("publishedAfter"),
                "published_before": params.get("publishedBefore"),
                "order": order,
                "videos": enriched_items,
            }
        except HttpError as http_err:
            logger.exception(
                "YouTube API error when searching videos for %s", channel_id
            )
            return {
                "channel_id": resolved_channel_id,
                "error": f"YouTube API error: {http_err}",
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Unexpected error when searching videos for %s", channel_id
            )
            return {
                "channel_id": resolved_channel_id,
                "error": f"Unexpected error: {exc}",
            }


__all__ = [
    "LatestVideosInput",
    "ChannelVideoSearchInput",
    "GetLatestVideosTool",
    "SearchChannelVideosTool",
]
