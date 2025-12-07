"""Tool for uploading transcript text to Gemini Files."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

from tools.youtube.storage import upload_text_to_gemini_file

logger = logging.getLogger(__name__)


class UploadTranscriptToGeminiFileInput(BaseModel):
    video_id: str = Field(..., description="The ID of the YouTube video.")
    transcript_text: str = Field(..., description="Transcript text to store off-chat.")
    video_title: Optional[str] = Field(
        default=None,
        description="Optional display name for the Gemini file.",
    )


class UploadTranscriptToGeminiFileTool(BaseTool):
    """Upload transcript text to Gemini Files and return a file reference."""

    NAME = "upload_transcript_to_gemini_file"
    DESCRIPTION = (
        "Uploads raw transcript text to Gemini Files and returns a file_uri. "
        "Use when a transcript string is available and must be kept out of the chat context."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[UploadTranscriptToGeminiFileInput]:
        return UploadTranscriptToGeminiFileInput

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
            transcript_text=args["transcript_text"],
            video_title=args.get("video_title"),
        )

    def __call__(
        self,
        video_id: str,
        transcript_text: str,
        video_title: Optional[str] = None,
    ) -> Dict[str, Any]:
        try:
            display_name = video_title or f"Transcript {video_id}"
            file_uri = upload_text_to_gemini_file(
                text=transcript_text,
                display_name=display_name,
            )
            return {
                "status": "success",
                "video_id": video_id,
                "file_uri": file_uri,
                "usage_instruction": "Pass this file_uri to the analysis_tool.",
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to upload transcript for %s", video_id)
            return {
                "status": "error",
                "video_id": video_id,
                "error": f"Failed to upload transcript: {exc}",
            }


__all__ = ["UploadTranscriptToGeminiFileInput", "UploadTranscriptToGeminiFileTool"]
