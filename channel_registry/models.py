"""Data models for channel registry records."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class ChannelMetadata(BaseModel):
    """Stores the latest known stats for a channel."""

    subscriber_count: Optional[int] = Field(default=None)
    video_count: Optional[int] = Field(default=None)
    view_count: Optional[int] = Field(default=None)
    latest_video_id: Optional[str] = Field(default=None)
    last_refreshed_at: Optional[datetime] = Field(default=None)
    snapshot: Dict[str, Any] = Field(default_factory=dict)


class ChannelRecord(BaseModel):
    """Canonical registry entry for a YouTube channel."""

    channel_id: str = Field(..., description="Canonical YouTube channel ID (UC...).")
    handle: Optional[str] = Field(default=None, description="Channel handle (e.g. @example).")
    custom_url: Optional[str] = Field(default=None, description="Custom vanity URL slug.")
    title: Optional[str] = Field(default=None, description="Channel title.")
    description: Optional[str] = Field(default=None, description="Channel description summary.")
    owner: Optional[str] = Field(default=None, description="Owner or organization behind the channel.")
    notes: Optional[str] = Field(default=None, description="Analyst-provided qualitative notes.")
    tags: List[str] = Field(default_factory=list, description="Free-form labels describing the channel.")
    aliases: List[str] = Field(
        default_factory=list,
        description="Alternate spellings or colloquial references to aid fuzzy lookup.",
    )
    file_search_store_name: Optional[str] = Field(
        default=None,
        description="Gemini File Search store resource storing transcripts and comments.",
    )
    metadata: ChannelMetadata = Field(default_factory=ChannelMetadata)
    uploads_playlist_id: Optional[str] = Field(
        default=None,
        description="Uploads playlist ID (UU...) for efficient video listing.",
    )
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    def search_tokens(self) -> List[str]:
        """Tokens used for fuzzy resolution (handles, owner names, etc.)."""
        tokens = {
            self.channel_id.lower(),
        }
        for value in [
            self.handle,
            self.custom_url,
            self.title,
            self.owner,
            *(self.aliases or []),
        ]:
            if not value:
                continue
            stripped = value.strip().lower()
            if not stripped:
                continue
            tokens.add(stripped)
            tokens.add(stripped.lstrip("@"))
        return sorted(tokens)

    def update_metadata(self, data: Dict[str, Any]) -> None:
        """Update metadata snapshot and timestamps."""
        self.metadata.snapshot = data
        self.metadata.last_refreshed_at = datetime.utcnow()
        self.updated_at = datetime.utcnow()


__all__ = ["ChannelRecord", "ChannelMetadata"]


