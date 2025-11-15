"""ADK app definition for the Simargl YouTube research assistant."""

from __future__ import annotations

from google.adk.agents.llm_agent import LlmAgent
from google.adk.apps.app import App

from agents.orchestrator import ORCHESTRATOR_SYSTEM_PROMPT
from config.settings import ADK_APP_NAME, DEFAULT_GEMINI_MODEL
from tools.analysis_tool import SentimentAnalysisTool, SummarizeTool
from tools.channel_registry_tool import RefreshChannelMetadataTool
from tools.file_search_tool import (
    CreateFileSearchStoreTool,
    QueryFileSearchStoreTool,
    UploadFileSearchDocumentTool,
)
from tools.transcript_tool import TranscriptTool
from tools.youtube_tool import (
    GetLatestVideosTool,
    GetVideoCommentsTool,
    SearchChannelVideosTool,
    GetVideoDetailsTool
)

MODEL_NAME = DEFAULT_GEMINI_MODEL

_TOOLS = [
    TranscriptTool(),
    GetVideoCommentsTool(),
    SearchChannelVideosTool(),
    GetLatestVideosTool(),
    SummarizeTool(),
    SentimentAnalysisTool(),
    CreateFileSearchStoreTool(),
    UploadFileSearchDocumentTool(),
    QueryFileSearchStoreTool(),
    RefreshChannelMetadataTool(),
    GetVideoDetailsTool()
]

root_agent = LlmAgent(
    name="simargl_orchestrator",
    model=MODEL_NAME,
    instruction=ORCHESTRATOR_SYSTEM_PROMPT,
    tools=_TOOLS,
    global_instruction=(
        "Always respect YouTube Data API quota limits. "
        "Prefer transcripts and comments over video discovery."
    ),
)

app = App(
    name=ADK_APP_NAME,
    root_agent=root_agent,
)

__all__ = ["app", "root_agent"]


