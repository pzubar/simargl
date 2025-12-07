"""Tools for fetching channel and video metadata from YouTube."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from googleapiclient.errors import HttpError
from pydantic import BaseModel, Field

from config.settings import YOUTUBE_DEFAULT_MAX_RESULTS
from tools.youtube.client import execute_request, get_youtube_service, redact_request_uri
from tools.youtube.time_utils import parse_iso8601_duration

logger = logging.getLogger(__name__)


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
        description="Comma-separated list of channel resource properties to include.",
    )
    max_results: int = Field(
        YOUTUBE_DEFAULT_MAX_RESULTS,
        description="Number of channels to fetch (0 to 50, default 5).",
    )


class VideoDetailsInput(BaseModel):
    video_id: str = Field(..., description="The ID of the YouTube video.")


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
            sanitized_uri = redact_request_uri(request)
            if sanitized_uri:
                logger.info("YouTube API request (channel details): %s", sanitized_uri)
            response = execute_request(request, retries=2, label="channel details")
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
                part="snippet,statistics,contentDetails",
                id=video_id,
            )
            sanitized_uri = redact_request_uri(request)
            if sanitized_uri:
                logger.info("YouTube API request (video details): %s", sanitized_uri)
            response = execute_request(request, retries=2, label="video details")
            items: List[Dict[str, Any]] = response.get("items", [])

            if not items:
                return {
                    "video_id": video_id,
                    "error": "Video not found.",
                }

            item = items[0]
            result = {
                "video_id": video_id,
                "videos": items,
            }

            if "contentDetails" in item and "duration" in item["contentDetails"]:
                duration_iso = item["contentDetails"]["duration"]
                try:
                    duration_seconds = parse_iso8601_duration(duration_iso)
                    result["duration_seconds"] = duration_seconds
                except ValueError:
                    logger.warning("Failed to parse duration for video %s: %s", video_id, duration_iso)

            return result
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


__all__ = [
    "ChannelDetailsInput",
    "VideoDetailsInput",
    "GetChannelDetailsTool",
    "GetVideoDetailsTool",
]
