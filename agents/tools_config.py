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
from tools.video_memory_tools import (
    IngestVideoTool,
    MaintainVideoMetadataTool,
    QueryChannelVideosTool,
    RefreshVideoStatsTool,
    RetrieveVideosTool,
)
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
from agents.delegation_tools import (
    DiscoveryDelegationTool,
    AnalystDelegationTool,
    HistorianDelegationTool,
)

DISCOVERY_TOOLS = [
    # FIRESTORE-FIRST: Primary tools for querying local database
    QueryChannelVideosTool(),  # Query videos by channel with sorting (Firestore)
    RefreshVideoStatsTool(),   # Batch-refresh stats from YouTube API
    ManageChannelRegistryTool(),
    RefreshChannelMetadataTool(),
    # YouTube API tools - only use when explicitly requested or for fallback
    ListChannelUploadsTool(),
    EnrichPlaylistVideosTool(),
    SearchChannelVideosTool(),  # Only use with explicit "search YouTube" request
    GetLatestVideosTool(),
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
    IngestVideoTool(),
    MaintainVideoMetadataTool(),
    RetrieveVideosTool(),
]

MEMORY_TOOLS = [
    QueryFileSearchStoreTool(),
    CreateFileSearchStoreTool(),
]

# The orchestrator should only be able to delegate to sub-agents.
ORCHESTRATOR_TOOLS = [
    DiscoveryDelegationTool(),
    AnalystDelegationTool(),
    HistorianDelegationTool(),
]
