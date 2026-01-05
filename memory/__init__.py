"""Memory helpers for the Simargl YouTube assistant."""

from __future__ import annotations

from typing import Optional

from config.settings import (
    FILE_SEARCH_ENABLED,
    FILE_SEARCH_MODEL,
    FILE_SEARCH_POLL_SECONDS,
    FILE_SEARCH_POLL_TIMEOUT_SECONDS,
    GCP_PROJECT_ID,
)

from .channel_registry_firestore import ChannelRegistryService
from .file_search_service import FileSearchService
from .video_metadata_service import VideoMetadataService

_file_search_service: Optional[FileSearchService] = None
_channel_registry_service: Optional[ChannelRegistryService] = None
_video_metadata_service: Optional[VideoMetadataService] = None


def get_file_search_service() -> FileSearchService:
    global _file_search_service  # noqa: PLW0603
    if _file_search_service is None:
        _file_search_service = FileSearchService(
            enabled=FILE_SEARCH_ENABLED,
            default_model=FILE_SEARCH_MODEL,
            poll_seconds=FILE_SEARCH_POLL_SECONDS,
            poll_timeout_seconds=FILE_SEARCH_POLL_TIMEOUT_SECONDS,
        )
    return _file_search_service


def get_channel_registry_service() -> ChannelRegistryService:
    global _channel_registry_service  # noqa: PLW0603
    if _channel_registry_service is None:
        _channel_registry_service = ChannelRegistryService(project_id=GCP_PROJECT_ID)
    return _channel_registry_service


def get_video_metadata_service() -> VideoMetadataService:
    global _video_metadata_service  # noqa: PLW0603
    if _video_metadata_service is None:
        _video_metadata_service = VideoMetadataService(project_id=GCP_PROJECT_ID)
    return _video_metadata_service


__all__ = [
    "ChannelRegistryService",
    "VideoMetadataService",
    "FileSearchService",
    "get_file_search_service",
    "get_channel_registry_service",
    "get_video_metadata_service",
]


