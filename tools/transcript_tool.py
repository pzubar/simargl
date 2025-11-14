"""Quota-free transcript retrieval tool leveraging youtube-transcript-api."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field
from youtube_transcript_api import YouTubeTranscriptApi

from memory import get_file_search_service

logger = logging.getLogger(__name__)


class TranscriptInput(BaseModel):
    """Pydantic schema representing required tool arguments."""

    video_id: str = Field(..., description="The unique ID of the YouTube video.")
    channel_id: Optional[str] = Field(
        default=None,
        description="Optional channel ID for storing metadata in downstream services.",
    )
    video_title: Optional[str] = Field(
        default=None,
        description="Optional friendly name for the video. Used when storing in File Search.",
    )
    file_search_store_name: Optional[str] = Field(
        default=None,
        description="Optional Gemini File Search store name to ingest the transcript automatically.",
    )


class TranscriptTool(BaseTool):
    """Retrieve and normalize the transcript text for a given YouTube video."""

    NAME = "get_video_transcript"
    DESCRIPTION = (
        "Fetches the full text transcript of a single YouTube video. "
        "Use this to analyze video content without spending API quota."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[TranscriptInput]:
        return TranscriptInput

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
            channel_id=args.get("channel_id"),
            video_title=args.get("video_title"),
            file_search_store_name=args.get("file_search_store_name"),
        )

    def __call__(
        self,
        video_id: str,
        channel_id: Optional[str] = None,
        video_title: Optional[str] = None,
        file_search_store_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fetch and join transcript segments into a single string."""
        try:
            transcript_list = YouTubeTranscriptApi.get_transcript(video_id)
            full_transcript = " ".join(segment["text"].strip() for segment in transcript_list if segment["text"])
            response: Dict[str, Any] = {
                "video_id": video_id,
                "transcript": full_transcript,
                "segments": transcript_list,
            }
            if file_search_store_name and full_transcript:
                ingestion_result = self._ingest_into_file_search(
                    store_name=file_search_store_name,
                    video_id=video_id,
                    channel_id=channel_id,
                    video_title=video_title,
                    transcript=full_transcript,
                )
                if ingestion_result:
                    response["file_search_document"] = ingestion_result
            return response
        except Exception as exc:  # noqa: BLE001
            logger.exception("Error fetching transcript for %s", video_id)
            return {
                "video_id": video_id,
                "error": f"Error fetching transcript: {exc}",
            }

    def _ingest_into_file_search(
        self,
        *,
        store_name: str,
        video_id: str,
        channel_id: Optional[str],
        video_title: Optional[str],
        transcript: str,
    ) -> Optional[Dict[str, Any]]:
        try:
            service = get_file_search_service()
            metadata = {
                "video_id": video_id,
                "artifact_type": "transcript",
            }
            if channel_id:
                metadata["channel_id"] = channel_id
            display_name = video_title or f"Transcript {video_id}"
            return service.upload_text(
                store_name=store_name,
                content=transcript,
                display_name=display_name,
                metadata=metadata,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to ingest transcript for %s into File Search store %s: %s",
                video_id,
                store_name,
                exc,
            )
            return None


__all__ = ("TranscriptTool",)



