#!/usr/bin/env python3
"""Test script to verify transcript functionality works correctly."""

import asyncio
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).resolve().parent
sys.path.insert(0, str(project_root))

from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types
from agents.simargl_agent.agent import root_agent


async def get_transcript(video_url: str):
    """Get transcript for a video URL."""
    session_service = InMemorySessionService()
    session = await session_service.create_session(
        app_name="simargl_agent",
        user_id="test_user",
        session_id="test_session"
    )
    
    runner = Runner(
        app_name="simargl_agent",
        agent=root_agent,
        session_service=session_service,
    )
    
    message = types.Content(
        role="user",
        parts=[types.Part(text=f"Get transcript for {video_url}")]
    )
    
    print(f"Requesting transcript for: {video_url}")
    print("="*60)
    
    async for event in runner.run_async(
        user_id="test_user",
        session_id="test_session",
        new_message=message
    ):
        if event.content and event.content.parts:
            for part in event.content.parts:
                if part.text:
                    print(part.text)


if __name__ == "__main__":
    video_url = sys.argv[1] if len(sys.argv) > 1 else "https://youtu.be/1gkYDf8cXzY"
    asyncio.run(get_transcript(video_url))

