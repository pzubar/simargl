"""Chat page components."""

from __future__ import annotations

import json
import logging

import requests
import streamlit as st

from config.settings import ADK_SERVER_HOST

logger = logging.getLogger(__name__)


def ensure_session_state() -> None:
    """Initialize session state for chat messages."""
    if "messages" not in st.session_state:
        st.session_state["messages"] = []


def render_chat_history() -> None:
    """Display past chat interactions."""
    for message in st.session_state["messages"]:
        with st.chat_message(message["role"]):
            st.markdown(message["content"])


def call_agent(query: str) -> dict:
    """Invoke the ADK backend and return the JSON response."""
    payload = {"query": query}
    response = requests.post(f"{ADK_SERVER_HOST}/invoke", json=payload, timeout=60)
    response.raise_for_status()
    return response.json()


def render_chat_page() -> None:
    """Render chat interface."""
    ensure_session_state()
    render_chat_history()

    if prompt := st.chat_input("What would you like to research?"):
        st.session_state["messages"].append({"role": "user", "content": prompt})
        with st.chat_message("user"):
            st.markdown(prompt)

        with st.spinner("Agent is thinking..."):
            try:
                agent_response = call_agent(prompt)
                formatted_response = f"```json\n{json.dumps(agent_response, indent=2)}\n```"
            except requests.RequestException as exc:
                logger.exception("Error calling ADK backend")
                formatted_response = f"⚠️ Failed to reach agent backend:\n\n```\n{exc}\n```"

        st.session_state["messages"].append({"role": "assistant", "content": formatted_response})
        with st.chat_message("assistant"):
            st.markdown(formatted_response)

