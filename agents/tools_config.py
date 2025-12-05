"""Tool configuration for Simargl agents."""

from tools.analysis_tool import SentimentAnalysisTool, SummarizeTool
from tools.channel_registry_tool import RefreshChannelMetadataTool
from tools.file_search_tool import (
    CreateFileSearchStoreTool,
    QueryFileSearchStoreTool,
    UploadFileSearchDocumentTool,
)
from tools.transcript_tool import AnalyzeVideoTool
from tools.batch_tool import SubmitBatchJobTool, GetBatchResultsTool
from tools.youtube_tool import (
    GetLatestVideosTool,
    GetVideoCommentsTool,
    SearchChannelVideosTool,
    GetVideoDetailsTool,
    GetChannelDetailsTool,
)

DISCOVERY_TOOLS = [
    SearchChannelVideosTool(),
    GetLatestVideosTool(),
    RefreshChannelMetadataTool(),
    GetVideoDetailsTool(),
    GetChannelDetailsTool(),
]

ANALYST_TOOLS = [
    AnalyzeVideoTool(),
    GetVideoDetailsTool(),
    GetVideoCommentsTool(),

    SummarizeTool(),
    SentimentAnalysisTool(),
    UploadFileSearchDocumentTool(), # Analyst needs to save results
    SubmitBatchJobTool(),
    GetBatchResultsTool(),
]

MEMORY_TOOLS = [
    QueryFileSearchStoreTool(),
    CreateFileSearchStoreTool(),
]
