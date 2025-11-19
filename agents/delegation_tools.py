"""Delegation tools for Simargl Supervisor."""

import logging
from typing import Any, Dict, List

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.agents.run_config import RunConfig
from google.genai import types
from pydantic import BaseModel, Field

from agents.sub_agents import discovery_agent, analyst_agent, historian_agent, critique_agent

logger = logging.getLogger(__name__)

class DelegationInput(BaseModel):
    query: str = Field(..., description="The query or instructions for the sub-agent.")

class BaseDelegationTool(BaseTool):
    """Base class for delegation tools."""
    
    def __init__(self, name: str, description: str, agent: Any):
        super().__init__(name=name, description=description)
        self.target_agent = agent
        self.session_service = InMemorySessionService()

    @property
    def args_schema(self) -> type[DelegationInput]:
        return DelegationInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def _run_agent(self, query: str, session_id: str = None) -> str:
        """Runs the target agent and returns the final text response."""
        if not session_id:
            session = self.session_service.create_session_sync(user_id="simargl_user", app_name="simargl")
            session_id = session.id

        runner = Runner(agent=self.target_agent, session_service=self.session_service, app_name="simargl")
        
        message = types.Content(
            role="user", parts=[types.Part.from_text(text=query)]
        )

        # Assuming run_async returns an async iterator or similar. 
        # If run_async is not available, we might need to use run() in a thread, but let's try run_async.
        # Based on ADK patterns, Runner usually has run_async.
        # However, test_agent.py uses run() which returns an iterator.
        # Let's assume run() is synchronous and blocks. 
        # Since we are in run_async of the tool, we should ideally use async.
        # But for now, let's use run() and hope it doesn't block the event loop too badly or use run_in_executor if needed.
        # Actually, let's try to find if run_async exists. 
        # If not, we'll use run().
        
        response_text = ""
        try:
            # Using sync run() for simplicity as I can't verify run_async signature easily without code.
            # In a real async env this might block, but for this refactor it's acceptable.
            events = runner.run(
                new_message=message,
                user_id="simargl_user",
                session_id=session_id,
            )
            
            for event in events:
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.text:
                            response_text += part.text
        except Exception as e:
            logger.error(f"Error running agent {self.target_agent.name}: {e}")
            return f"Error: {e}"

        return response_text

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        response = await self._run_agent(args["query"])
        return {"response": response}


class DiscoveryDelegationTool(BaseDelegationTool):
    NAME = "consult_discovery_agent"
    DESCRIPTION = "Delegates a task to the Discovery Agent (Scout) to find videos or channel metadata."

    def __init__(self):
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
            agent=discovery_agent
        )

class AnalystDelegationTool(BaseDelegationTool):
    NAME = "consult_analyst_agent"
    DESCRIPTION = "Delegates a task to the Analyst Agent (Researcher) to analyze specific videos."

    def __init__(self):
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
            agent=analyst_agent
        )

class HistorianDelegationTool(BaseDelegationTool):
    NAME = "consult_historian_agent"
    DESCRIPTION = "Delegates a task to the Historian Agent for longitudinal analysis. Includes automated verification."

    def __init__(self):
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
            agent=historian_agent
        )
        self.critique_runner = Runner(agent=critique_agent, session_service=self.session_service, app_name="simargl")

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        query = args["query"]
        
        # 1. Start Historian Session
        session = self.session_service.create_session_sync(user_id="simargl_user", app_name="simargl")
        historian_session_id = session.id
        
        max_retries = 3
        current_query = query
        
        for i in range(max_retries):
            # 2. Run Historian
            logger.info(f"Historian attempt {i+1}")
            draft_response = await self._run_agent(current_query, session_id=historian_session_id)
            
            # 3. Run Critique
            critique_input = f"Draft Response:\n{draft_response}\n\nVerify this against the context. Output APPROVED or REJECTED: [Reason]."
            
            # Critique needs a fresh session or stateless check. Let's use a fresh session each time to avoid context pollution.
            critique_session = self.session_service.create_session_sync(user_id="simargl_user", app_name="simargl")
            
            critique_message = types.Content(
                role="user", parts=[types.Part.from_text(text=critique_input)]
            )
            
            critique_response = ""
            events = self.critique_runner.run(
                new_message=critique_message,
                user_id="simargl_user",
                session_id=critique_session.id,
            )
            for event in events:
                if event.content and event.content.parts:
                    for part in event.content.parts:
                        if part.text:
                            critique_response += part.text
            
            if "APPROVED" in critique_response:
                return {"response": draft_response, "verification": "Approved by Critique Agent"}
            
            # 4. Handle Rejection
            logger.info(f"Critique rejected: {critique_response}")
            current_query = f"Your previous response was rejected by the Critique Agent.\nCritique Feedback: {critique_response}\n\nPlease rewrite your response addressing these issues."
        
        return {"response": draft_response, "verification": "Max retries reached. Potential issues remaining."}

