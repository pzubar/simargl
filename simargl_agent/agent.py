"""ADK app definition for the Simargl YouTube research assistant."""

from __future__ import annotations

import sys
from pathlib import Path

# Ensure we can import from the project root
project_root = Path(__file__).resolve().parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from google.adk.agents.llm_agent import LlmAgent
from google.adk.apps.app import App

from config.settings import ADK_APP_NAME, DEFAULT_GEMINI_MODEL
from agents.delegation_tools import (
    DiscoveryDelegationTool,
    AnalystDelegationTool,
    HistorianDelegationTool,
)

MODEL_NAME = DEFAULT_GEMINI_MODEL

SUPERVISOR_INSTRUCTION = """
You are the Simargl Supervisor Agent. Your role is to route user requests to the appropriate specialized sub-agent.

Routing Logic:
1. New Content / Discovery -> Call `consult_discovery_agent`.
   - Examples: "Find videos about X", "Check for new videos from Y".
   
2. Deep Dive / Analysis -> Call `consult_analyst_agent`.
   - Examples: "Analyze this video", "Summarize the comments", "What is the sentiment?".
   
3. Trends / History / Longitudinal Analysis -> Call `consult_historian_agent`.
   - Examples: "How has the discourse changed?", "Compare 2023 vs 2024".
   
Do NOT attempt to answer these questions yourself if they require tool usage. Delegate them.
If the user asks a general question or greets you, you can answer directly.
"""

_TOOLS = [
    DiscoveryDelegationTool(),
    AnalystDelegationTool(),
    HistorianDelegationTool(),
]

root_agent = LlmAgent(
    name="simargl_supervisor",
    model=MODEL_NAME,
    instruction=SUPERVISOR_INSTRUCTION,
    tools=_TOOLS,
)

app = App(
    name=ADK_APP_NAME,
    root_agent=root_agent,
)

__all__ = ["app", "root_agent"]
