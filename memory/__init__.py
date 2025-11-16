"""Memory helpers for the Simargl YouTube assistant."""

from __future__ import annotations

from typing import Optional

from config.settings import (
    ADK_APP_NAME,
    FILE_SEARCH_ENABLED,
    FILE_SEARCH_MODEL,
    FILE_SEARCH_POLL_SECONDS,
    FILE_SEARCH_POLL_TIMEOUT_SECONDS,
    GCP_PROJECT_ID,
    GCP_REGION,
    MEMORY_ENABLED,
    VERTEX_MEMORY_AGENT_ENGINE_ID,
)

from .channel_memory_service import ChannelMemoryItem, ChannelMemoryService
from .file_search_service import FileSearchService
from .local_memory_service import LocalMemoryService

_channel_memory_service: Optional[ChannelMemoryService] = None
_file_search_service: Optional[FileSearchService] = None


def get_channel_memory_service() -> ChannelMemoryService:
    global _channel_memory_service  # noqa: PLW0603
    if _channel_memory_service is None:
#         _channel_memory_service = ChannelMemoryService(
#             project_id=GCP_PROJECT_ID,
#             location=GCP_REGION,
#             agent_engine_id=VERTEX_MEMORY_AGENT_ENGINE_ID,
#             app_name=ADK_APP_NAME,
#             enabled=MEMORY_ENABLED,
#         )
        _channel_memory_service = LocalMemoryService() # Temporary switch to local memory service
    return _channel_memory_service


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


__all__ = [
    "ChannelMemoryItem",
    "ChannelMemoryService",
    "FileSearchService",
    "get_channel_memory_service",
    "get_file_search_service",
]


