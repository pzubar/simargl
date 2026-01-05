"""AnalyzeVideoTool now reads Stenographer outputs from File Search (no direct video understanding)."""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

from config.settings import STENOGRAPHER_STORE_NAME
from memory import get_file_search_service

logger = logging.getLogger(__name__)


class AnalyzeVideoInput(BaseModel):
    video_url: Optional[str] = Field(
        default=None, description="YouTube URL (used only to extract video_id if provided)."
    )
    video_id: Optional[str] = Field(default=None, description="YouTube video ID to analyze.")
    channel_id: Optional[str] = Field(
        default=None, description="Optional channel ID to tighten metadata_filter."
    )
    file_search_store_name: Optional[str] = Field(
        default=None,
        description="File Search store containing stenographer artifacts. Defaults to STENOGRAPHER_STORE_NAME.",
    )
    analysis_query: Optional[str] = Field(
        default=None,
        description="Custom analysis prompt to run against the stenographer transcript.",
    )
    top_k: int = Field(
        default=10,
        description="How many chunks to retrieve from File Search during analysis.",
    )


class AnalyzeVideoTool(BaseTool):
    """Analyze Stenographer markdown stored in File Search."""

    NAME = "analyze_video"
    DESCRIPTION = (
        "Analyzes the stenographer transcript stored in Gemini File Search. "
        "No direct video fetching or Gemini video understanding."
    )

    def __init__(self) -> None:
        super().__init__(name=self.NAME, description=self.DESCRIPTION)

    @property
    def args_schema(self) -> type[AnalyzeVideoInput]:
        return AnalyzeVideoInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    def _extract_video_id(self, video_url: str) -> Optional[str]:
        try:
            if "youtube.com/watch?v=" in video_url:
                return video_url.split("youtube.com/watch?v=")[1].split("&")[0]
            if "youtu.be/" in video_url:
                return video_url.split("youtu.be/")[1].split("?")[0]
        except Exception:
            return None
        return None

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return await self(
            video_url=args.get("video_url"),
            video_id=args.get("video_id"),
            channel_id=args.get("channel_id"),
            file_search_store_name=args.get("file_search_store_name"),
            analysis_query=args.get("analysis_query"),
            top_k=args.get("top_k", 10),
        )

    async def __call__(
        self,
        video_url: Optional[str] = None,
        video_id: Optional[str] = None,
        channel_id: Optional[str] = None,
        file_search_store_name: Optional[str] = None,
        analysis_query: Optional[str] = None,
        top_k: int = 10,
    ) -> Dict[str, Any]:
        try:
            if not video_id:
                if video_url:
                    video_id = self._extract_video_id(video_url)
                if not video_id:
                    return {"status": "error", "error": "video_id is required for analysis."}

            store_name = file_search_store_name or STENOGRAPHER_STORE_NAME
            if not store_name:
                return {"status": "error", "error": "No File Search store configured for stenographer artifacts."}

            metadata_parts = [f'video_id="{video_id}"', 'artifact_type="stenographer"']
            if channel_id:
                metadata_parts.append(f'channel_id="{channel_id}"')
            metadata_filter = " AND ".join(metadata_parts)

            query_text = analysis_query or (
                "Provide an analytical summary of the stenographer transcript. "
                "Highlight key themes, notable claims, participants, and emotional cues. "
                "Cite supporting snippets."
            )

            service = get_file_search_service()
            response = service.query(
                store_name=store_name,
                query=query_text,
                top_k=top_k,
                metadata_filter=metadata_filter,
                instructions=(
                    "Use only the retrieved stenographer markdown. "
                    "Include citations and avoid hallucinating content not present in the transcript."
                ),
            )

            return {
                "status": "success",
                "video_id": video_id,
                "store_name": store_name,
                "metadata_filter": metadata_filter,
                "model": response.get("model"),
                "analysis": response.get("answer"),
                "grounding": response.get("grounding"),
            }
        except Exception as exc:  # noqa: BLE001
            logger.exception("Error analyzing stenographer transcript for %s", video_id)
            return {"status": "error", "error": str(exc), "video_id": video_id}


__all__ = ("AnalyzeVideoTool",)

