from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from googleapiclient.errors import HttpError
from pydantic import BaseModel, Field

from config.settings import YOUTUBE_DEFAULT_MAX_RESULTS
from tools.youtube.client import (
    execute_request,
    get_youtube_service,
    redact_request_uri,
    resolve_channel_identifier,
    resolve_uploads_playlist_id,
)

logger = logging.getLogger(__name__)


class PlaylistVideosInput(BaseModel):
    channel_id: str = Field(..., description="The ID of the YouTube channel.")
    max_results: int = Field(
        YOUTUBE_DEFAULT_MAX_RESULTS,
        description="Number of playlistItems to fetch (1-50, default 5).",
    )
    page_token: Optional[str] = Field(
        None,
        description="Optional pageToken for pagination through playlistItems.",
    )


class ListChannelUploadsTool(BaseTool):
    """
    Tool to list uploads via playlistItems. COST: 1 quota unit.

    Note: playlistItems.list does NOT support server-side ordering or date
    filters. This tool returns raw playlistItems in playlist order (usually newest first).
    """

    NAME = "list_channel_uploads"
    DESCRIPTION = (
        "Lists a channel's uploads using playlistItems (uploads playlist). "
        "Returns raw playlistItems in playlist order with pageToken support. "
        "Use enrich_playlist_videos to add stats or custom ordering."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[PlaylistVideosInput]:
        return PlaylistVideosInput

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
            page_token=args.get("page_token"),
        )

    def __call__(
        self,
        channel_id: str,
        max_results: int = YOUTUBE_DEFAULT_MAX_RESULTS,
        page_token: Optional[str] = None,
    ) -> Dict[str, Any]:
        try:
            resolved_channel_id = resolve_channel_identifier(channel_id)
            if not resolved_channel_id:
                return {
                    "channel_id": channel_id,
                    "error": "Invalid channel identifier. Provide a YouTube channel ID or known handle/title from registry.",
                }

            max_results = max(1, min(50, max_results))
            service = get_youtube_service()
            playlist_id = resolve_uploads_playlist_id(resolved_channel_id, service=service)
            if not playlist_id:
                return {
                    "channel_id": resolved_channel_id,
                    "error": "Could not resolve uploads playlist for channel.",
                }

            request = service.playlistItems().list(
                part="snippet,contentDetails",
                playlistId=playlist_id,
                maxResults=max_results,
                pageToken=page_token,
            )
            sanitized_uri = redact_request_uri(request)
            if sanitized_uri:
                logger.info("YouTube API request (playlist uploads): %s", sanitized_uri)
            response = execute_request(request, retries=2, label="playlist uploads")
            playlist_items = response.get("items", [])
            return {
                "channel_id": resolved_channel_id,
                "playlist_id": playlist_id,
                "videos": playlist_items,
                "next_page_token": response.get("nextPageToken"),
                "page_info": response.get("pageInfo"),
                "source": "playlistItems",
            }
        except HttpError as http_err:
            logger.exception(
                "YouTube API error when listing uploads for %s", channel_id
            )
            return {
                "channel_id": resolved_channel_id if "resolved_channel_id" in locals() else channel_id,
                "error": f"YouTube API error: {http_err}",
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception(
                "Unexpected error when listing uploads for %s", channel_id
            )
            return {
                "channel_id": resolved_channel_id if "resolved_channel_id" in locals() else channel_id,
                "error": f"Unexpected error: {exc}",
            }
