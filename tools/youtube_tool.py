"""Backward-compatible aggregation of YouTube tools and helpers.

The implementations now live under the `tools.youtube` package to keep this
module small and maintainable.
"""

from tools.youtube import (
    ChannelDetailsInput,
    ChannelVideoSearchInput,
    GetChannelDetailsTool,
    GetLatestVideosTool,
    GetVideoCommentsTool,
    GetVideoDetailsTool,
    EnrichPlaylistVideosInput,
    EnrichPlaylistVideosTool,
    ListChannelUploadsTool,
    LatestVideosInput,
    PlaylistVideosInput,
    SearchChannelVideosTool,
    UploadTranscriptToGeminiFileInput,
    UploadTranscriptToGeminiFileTool,
    VideoCommentsInput,
    VideoDetailsInput,
    execute_request,
    format_rfc3339,
    get_youtube_service,
    maybe_normalize_timestamp,
    parse_iso8601_duration,
    resolve_uploads_playlist_id,
    redact_request_uri,
    upload_text_to_gemini_file,
)

__all__ = (
    "execute_request",
    "get_youtube_service",
    "redact_request_uri",
    "resolve_uploads_playlist_id",
    "format_rfc3339",
    "maybe_normalize_timestamp",
    "parse_iso8601_duration",
    "upload_text_to_gemini_file",
    "LatestVideosInput",
    "GetLatestVideosTool",
    "VideoCommentsInput",
    "GetVideoCommentsTool",
    "ChannelDetailsInput",
    "GetChannelDetailsTool",
    "VideoDetailsInput",
    "GetVideoDetailsTool",
    "ChannelVideoSearchInput",
    "PlaylistVideosInput",
    "EnrichPlaylistVideosInput",
    "SearchChannelVideosTool",
    "ListChannelUploadsTool",
    "EnrichPlaylistVideosTool",
    "UploadTranscriptToGeminiFileInput",
    "UploadTranscriptToGeminiFileTool",
)
