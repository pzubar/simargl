"""ADK app definition for the Simargl YouTube research assistant."""

from __future__ import annotations

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
from agents.tools_config import ORCHESTRATOR_TOOLS
from agents.orchestrator import ORCHESTRATOR_SYSTEM_PROMPT

MODEL_NAME = DEFAULT_GEMINI_MODEL

planner = BuiltInPlanner(
    thinking_config=ThinkingConfig(
        include_thoughts=True,
    ),
)

root_agent = LlmAgent(
    name="simargl_orchestrator",
    model=MODEL_NAME,
    instruction=ORCHESTRATOR_SYSTEM_PROMPT,
    tools=ORCHESTRATOR_TOOLS,
    planner=planner,
)

session_service = InMemorySessionService()
runner = Runner(agent=root_agent, session_service=session_service, app_name=ADK_APP_NAME)

app = App(
    name=ADK_APP_NAME,
    root_agent=root_agent,
)

__all__ = ["app", "root_agent", "runner", "session_service"]
