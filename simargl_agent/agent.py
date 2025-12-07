"""ADK app definition for the Simargl YouTube research assistant."""

from __future__ import annotations

from datetime import datetime, timezone
import sys
from pathlib import Path

from google.adk.agents.llm_agent import LlmAgent
from google.adk.apps.app import App
from google.adk.planners import BuiltInPlanner
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai.types import ThinkingConfig

# Ensure we can import from the project root
project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from config.settings import ADK_APP_NAME, DEFAULT_GEMINI_MODEL
from agents.tools_config import ANALYST_TOOLS, DISCOVERY_TOOLS, MEMORY_TOOLS

MODEL_NAME = DEFAULT_GEMINI_MODEL

current_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")

RESEARCHER_INSTRUCTION = f"""
Current Date: {current_date}

You are an Expert Media Researcher.

Standard operating procedure:
1) Identify required videos using youtube_tool options (search, latest, details).
2) Acquire transcripts using transcript_tool. This tool returns Gemini file references instead of raw text.
3) Analyze the content by passing those file references to analysis_tool (file_uris + query).
4) Synthesize the final answer based on the analysis output. Cite which files or videos informed the conclusions.

Constraints:
- Do not request transcript text in chat; always work with file_uri references.
- Prefer gemini-flash-latest for all reasoning steps.
- Keep plans quota-aware and reuse existing file references when available.
"""

planner = BuiltInPlanner(
    thinking_config=ThinkingConfig(
        include_thoughts=True,
    ),
)

root_agent = LlmAgent(
    name="simargl_research_agent",
    model=MODEL_NAME,
    instruction=RESEARCHER_INSTRUCTION,
    tools=DISCOVERY_TOOLS + ANALYST_TOOLS + MEMORY_TOOLS,
    planner=planner,
)

session_service = InMemorySessionService()
runner = Runner(agent=root_agent, session_service=session_service, app_name=ADK_APP_NAME)

app = App(
    name=ADK_APP_NAME,
    root_agent=root_agent,
)

__all__ = ["app", "root_agent", "runner", "session_service"]
