from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field


class TranscriptSegment(BaseModel):
    """A single segment of the transcript with timestamp boundaries."""

    text: str = Field(description="The transcript text for this segment.")
    start_time: float = Field(description="Start time in seconds.")
    end_time: Optional[float] = Field(
        default=None, description="End time in seconds (if available)."
    )


class VideoData(BaseModel):
    """Unified representation of transcript or synthetic video understanding output."""

    video_id: str
    source_type: Literal["transcript_api", "gemini_video_understanding"]
    content: str = Field(
        description=(
            "Markdown text content. For transcripts, the full text with timestamps like "
            "[MM:SS] text. For Gemini fallback, the generated detailed transcript/description "
            "formatted the same way."
        )
    )
    segments: List[TranscriptSegment] = Field(
        default_factory=list,
        description="Transcript segments; may be estimated for Gemini fallback.",
    )


__all__ = ["TranscriptSegment", "VideoData"]
