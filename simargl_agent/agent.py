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
from agents.tools_config import MEMORY_TOOLS


MODEL_NAME = DEFAULT_GEMINI_MODEL

SUPERVISOR_INSTRUCTION = """
You are the Simargl Supervisor Agent. Your role is to route user requests to the appropriate specialized sub-agent.

Routing Logic:
1. New Content / Discovery -> Call `consult_discovery_agent`.
   - Examples: "Find videos about X", "Check for new videos from Y".
   
2. Deep Dive / Analysis -> Call `consult_analyst_agent`.
   - Examples: "Analyze this video", "Summarize the comments", "What is the sentiment?".
   - **CONTEXT RULE**: If the user says "this video", "last video", or "4th video", use your conversation history to find the most recent or Nth Video ID. PASS THIS ID explicitly to the Analyst Agent.
   - **MANDATORY FETCHING**: Do NOT answer "What is this video about?" by just reading the title. You MUST delegate to `consult_discovery_agent` (for quick metadata/description) or `consult_analyst_agent` (for deep dive).
   - **URL HELP**: When using `consult_analyst_agent`, if you have the ID, try to construct and pass the URL `https://www.youtube.com/watch?v=<ID>` in the query to help the sub-agent.
   - **MEMORY FIRST**: Before delegating to the Analyst, use `query_file_search_store` to check if analysis already exists. If yes, return that.
   - **PROACTIVE PROPOSAL**: If the user asks "What is this video about?" and you have no info, delegate to `discovery_agent` to get details, then PROACTIVELY ask the user if they want a deep-dive analysis using the Analyst Agent.

   
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
    tools=_TOOLS + MEMORY_TOOLS,
)

app = App(
    name=ADK_APP_NAME,
    root_agent=root_agent,
)

__all__ = ["app", "root_agent"]
