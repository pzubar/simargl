"""Tool configuration for Simargl agents."""

from tools.analysis_tool import FileAnalysisTool
from tools.channel_registry_tool import ManageChannelRegistryTool, RefreshChannelMetadataTool
from tools.file_search_tool import (
    CreateFileSearchStoreTool,
    QueryFileSearchStoreTool,
    UploadFileSearchDocumentTool,
)
from tools.transcript_tool import AnalyzeVideoTool
from tools.batch_tool import SubmitBatchJobTool, GetBatchResultsTool
from tools.youtube import (
    GetLatestVideosTool,
    GetVideoCommentsTool,
    GetVideoDetailsTool,
    GetChannelDetailsTool,
    ListChannelUploadsTool,
    EnrichPlaylistVideosTool,
    SearchChannelVideosTool,
    UploadTranscriptToGeminiFileTool,
)

DISCOVERY_TOOLS = [
    # Always prefer playlist-based listing when there is NO text query.
    ListChannelUploadsTool(),
    EnrichPlaylistVideosTool(),
    # Only use search when there is a non-empty query string.
    SearchChannelVideosTool(),
    GetLatestVideosTool(),
    ManageChannelRegistryTool(),
    RefreshChannelMetadataTool(),
    GetVideoDetailsTool(),
    GetChannelDetailsTool(),
]

ANALYST_TOOLS = [
    AnalyzeVideoTool(),
    GetVideoCommentsTool(),
    FileAnalysisTool(),
    UploadTranscriptToGeminiFileTool(),
    UploadFileSearchDocumentTool(), # Analyst needs to save results
    SubmitBatchJobTool(),
    GetBatchResultsTool(),
]

MEMORY_TOOLS = [
    QueryFileSearchStoreTool(),
    CreateFileSearchStoreTool(),
]
