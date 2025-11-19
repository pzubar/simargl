"""Streamlit UI for interacting with the Simargl multi-agent research assistant."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import List

import requests
import streamlit as st

from channel_registry import get_channel_registry
from channel_registry.refresh_service import ChannelRefreshService
from config.settings import ADK_SERVER_HOST, CHANNEL_DB_PATH

logger = logging.getLogger(__name__)
CHANNEL_DB = Path(CHANNEL_DB_PATH)


def load_channels() -> List[str]:
    """Load the stored channel identifiers from the JSON file."""
    if not CHANNEL_DB.exists():
        return []

    try:
        return json.loads(CHANNEL_DB.read_text())
    except json.JSONDecodeError:
        logger.warning("channels.json is malformed. Recreating it.")
        return []


def save_channels(channels: List[str]) -> None:
    """Persist the channel identifiers to disk."""
    CHANNEL_DB.write_text(json.dumps(sorted(set(channels))))


def sidebar_channel_manager() -> List[str]:
    """Render the sidebar controls for managing target channels."""
    registry = get_channel_registry()
    refresher = ChannelRefreshService()

    st.sidebar.header("Channel Intelligence")
    channels = load_channels()

    with st.sidebar.form("add-channel-form"):
        new_channel = st.text_input("Add channel ID / @handle / URL")
        owner = st.text_input("Owner / Persona (optional)")
        submitted = st.form_submit_button("Save Channel")

    if submitted:
        if new_channel:
            record = registry.find_or_create_by_identifier(new_channel.strip())
            if owner:
                registry.update_partial(record.channel_id, owner=owner.strip())
            channels.append(new_channel.strip())
            save_channels(channels)
            st.sidebar.success(f"Channel '{record.title or record.channel_id}' saved.")
        else:
            st.sidebar.warning("Please enter a valid channel identifier.")

    records = registry.list_channels()
    if not records:
        st.sidebar.info("No channels saved yet.")
        return channels

    for record in records:
        label = record.title or record.handle or record.channel_id
        with st.sidebar.expander(label, expanded=False):
            handle = f"@{record.handle}" if record.handle else "—"
            st.markdown(f"**Handle:** {handle}")
            st.markdown(f"**Owner:** {record.owner or '—'}")
            st.markdown(
                f"**Subscribers:** {record.metadata.subscriber_count:,}"
                if record.metadata.subscriber_count is not None
                else "**Subscribers:** unknown"
            )
            refreshed = record.metadata.last_refreshed_at.isoformat() if record.metadata.last_refreshed_at else "never"
            st.caption(f"Last refreshed: {refreshed}")

            if st.button("Refresh metadata", key=f"refresh-{record.channel_id}"):
                refresher.refresh(record.channel_id, force=True)
                st.sidebar.success("Metadata updated.")
                st.experimental_rerun()

            notes_value = st.text_area(
                "Analyst notes",
                value=record.notes or "",
                key=f"notes-{record.channel_id}",
                height=90,
            )
            if st.button("Save notes", key=f"save-notes-{record.channel_id}"):
                registry.update_partial(record.channel_id, notes=notes_value.strip())
                st.sidebar.success("Notes saved.")
                st.experimental_rerun()

    return channels


def sidebar_batch_manager() -> None:
    """Render the sidebar controls for managing batch jobs."""
    from services.batch_service import BatchJobService
    
    st.sidebar.header("Batch Jobs")
    service = BatchJobService()
    jobs = service._load_jobs()
    
    if not jobs:
        st.sidebar.info("No batch jobs found.")
        return

    # Sort by creation time descending
    sorted_jobs = sorted(jobs.values(), key=lambda x: x["created_at"], reverse=True)
    
    for job in sorted_jobs:
        job_id = job["job_id"]
        short_id = job_id.split("/")[-1] if "/" in job_id else job_id
        state = job["state"]
        
        with st.sidebar.expander(f"{state}: ...{short_id[-6:]}", expanded=False):
            st.caption(f"ID: {short_id}")
            st.caption(f"Created: {job['created_at']}")
            st.caption(f"Videos: {len(job['video_ids'])}")
            
            if state == "COMPLETED":
                if st.button("Sync Results", key=f"sync-{short_id}"):
                    with st.spinner("Syncing results..."):
                        try:
                            # We call the agent to run the tool so it's recorded in the conversation
                            # But for UI convenience, we could also call service directly.
                            # Let's call the tool via agent to ensure RAG ingestion happens properly via the tool logic
                            # Actually, calling the tool directly here is cleaner for "admin" tasks, 
                            # but the tool logic handles RAG ingestion. 
                            # Let's instantiate the tool directly to reuse logic without agent overhead
                            from tools.batch_tool import GetBatchResultsTool
                            import asyncio
                            
                            tool = GetBatchResultsTool()
                            # Run async tool in sync context
                            result = asyncio.run(tool(job_id=job_id, file_search_store_name="default_store")) # TODO: Make store configurable
                            
                            st.success(f"Synced! {result.get('message')}")
                            st.experimental_rerun()
                        except Exception as e:
                            st.error(f"Sync failed: {e}")
            
            elif state in ["PENDING", "PROCESSING"]:
                if st.button("Check Status", key=f"check-{short_id}"):
                    service.check_job_status(job_id)
                    st.experimental_rerun()


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


def main() -> None:
    """Main Streamlit app entry point."""
    st.set_page_config(page_title="Simargl Research Assistant", layout="wide")
    st.title("Simargl YouTube Research Assistant")
    st.caption("Ask research questions about your tracked YouTube channels.")

    sidebar_channel_manager()
    sidebar_batch_manager()
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


if __name__ == "__main__":
    main()


