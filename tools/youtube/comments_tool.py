"""Tooling for fetching and ingesting YouTube video comments."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from googleapiclient.errors import HttpError
from pydantic import BaseModel, Field

from config.settings import (
    YOUTUBE_DEFAULT_COMMENT_MAX_RESULTS,
)
from memory import get_file_search_service
from tools.youtube.client import execute_request, get_youtube_service, redact_request_uri

logger = logging.getLogger(__name__)


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
            sanitized_uri = redact_request_uri(request)
            if sanitized_uri:
                logger.info("YouTube API request (comments): %s", sanitized_uri)
            response = execute_request(request, retries=2, label="comments")
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


__all__ = ["VideoCommentsInput", "GetVideoCommentsTool"]
