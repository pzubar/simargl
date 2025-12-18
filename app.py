"""Streamlit UI for interacting with the Simargl multi-agent research assistant."""

from __future__ import annotations

import json
import logging
from typing import List

import requests
import streamlit as st

from channel_registry import get_channel_registry
from config.settings import ADK_SERVER_HOST
from memory import (
    get_channel_registry_service,
    get_file_search_service,
    get_video_metadata_service,
)
from services import PlaylistIngestService
from tools.video_memory_tools import IngestVideoTool, MaintainVideoMetadataTool

logger = logging.getLogger(__name__)
def sidebar_channel_manager() -> List[str]:
    """Render the sidebar controls for managing target channels."""
    from channel_registry.refresh_service import ChannelRefreshService
    registry = get_channel_registry()
    refresher = ChannelRefreshService()
    playlist_ingest = PlaylistIngestService()

    st.sidebar.header("Channel Intelligence")
    with st.sidebar.form("add-channel-form"):
        new_channel = st.text_input("Add channel ID / @handle / URL")
        owner = st.text_input("Owner / Persona (optional)")
        submitted = st.form_submit_button("Save Channel")

    if submitted:
        if new_channel:
            record = registry.find_or_create_by_identifier(new_channel.strip())
            if owner:
                registry.update_partial(record.channel_id, owner=owner.strip())
            logger.info("UI: scheduling uploads ingest for channel=%s", record.channel_id)
            with st.spinner("Scheduling uploads ingestion..."):
                try:
                    job = playlist_ingest.enqueue_and_run(record.channel_id)
                    st.sidebar.success(
                        f"Channel '{record.title or record.channel_id}' saved and queued "
                        f"uploads ingest ({job.get('video_count', 0)} videos)."
                    )
                    logger.info(
                        "UI: ingest job finished job_id=%s state=%s videos=%s",
                        job.get("job_id"),
                        job.get("state"),
                        job.get("video_count"),
                    )
                except Exception as exc:  # noqa: BLE001
                    logger.exception("UI: ingest scheduling failed for channel=%s", record.channel_id)
                    st.sidebar.warning(
                        f"Channel saved, but ingestion scheduling failed: {exc}"
                    )
        else:
            st.sidebar.warning("Please enter a valid channel identifier.")

    records = registry.list_channels()
    if not records:
        st.sidebar.info("No channels saved yet.")
        return []

    for record in records:
        label = record.title or record.handle or record.channel_id
        with st.sidebar.expander(label, expanded=False):
            st.markdown(f"**Handle:** {record.handle or '—'}")
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

    st.sidebar.markdown("---")
    st.sidebar.caption("Uploads ingest jobs")
    jobs = playlist_ingest.list_jobs()[:5]
    if not jobs:
        st.sidebar.caption("No ingest jobs yet.")
    else:
        for job in jobs:
            st.sidebar.caption(
                f"{job.get('state')}: {job.get('channel_id')} "
                f"({job.get('video_count', 0)} videos)"
            )

    return []


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


def _extract_video_id(url_or_id: str) -> str:
    if "youtube.com/watch" in url_or_id and "v=" in url_or_id:
        return url_or_id.split("v=")[1].split("&")[0]
    if "youtu.be/" in url_or_id:
        return url_or_id.split("youtu.be/")[1].split("?")[0]
    return url_or_id.strip()


def render_memory_control_plane() -> None:
    """Shared library view backed by Firestore + File Search."""
    st.subheader("Hybrid Memory Library")
    video_service = get_video_metadata_service()
    channel_service = get_channel_registry_service()

    videos = video_service.list()
    filtered_videos = videos
    # Enrich channel titles
    for v in filtered_videos:
        cid = v.get("channel_id")
        channel = channel_service.get(cid) if cid else None
        v["channel_title"] = channel.get("channel_title") if channel else None
        v["tags"] = v.get("tags") or []
        v["custom_tags"] = v.get("custom_tags") or []
        v["has_transcript"] = bool(v.get("rag_resource_name"))

    if filtered_videos:
        st.dataframe(
            [
                {
                    "title": v.get("title"),
                    "channel": v.get("channel_title") or v.get("channel_id"),
                    "published_at": v.get("published_at"),
                    "views": v.get("view_count"),
                    "tags": ", ".join(v.get("tags", [])),
                    "custom_tags": ", ".join(v.get("custom_tags", [])),
                    "has_transcript": v.get("has_transcript"),
                }
                for v in filtered_videos
            ],
            use_container_width=True,
        )
    else:
        st.info("No videos ingested yet.")

    st.markdown("---")
    col_ingest, col_edit, col_delete = st.columns(3)

    with col_ingest:
        st.markdown("**Manual ingest**")
        url_input = st.text_input("YouTube URL or ID", key="ingest-url")
        store_name = st.text_input("File Search store", value="simargl-file-search", key="ingest-store")
        if st.button("Add video", key="ingest-btn"):
            vid = _extract_video_id(url_input)
            with st.spinner("Ingesting..."):
                result = IngestVideoTool()(video_id=vid, file_search_store_name=store_name)
            if result.get("status") == "success":
                st.success("Ingested successfully.")
                st.experimental_rerun()
            else:
                st.error(result.get("message", "Failed to ingest"))

    with col_edit:
        st.markdown("**Edit metadata**")
        all_ids = [v.get("video_id") for v in videos]
        selected_id = st.selectbox("Select video", options=all_ids or ["—"], key="edit-video")
        new_tags = st.text_input("Add custom tags (comma separated)", key="edit-tags")
        summary = st.text_area("Agent summary", key="edit-summary")
        if st.button("Save metadata", key="save-metadata"):
            payload = {
                "video_id": selected_id,
                "add_custom_tags": [t.strip() for t in new_tags.split(",") if t.strip()],
                "agent_summary": summary.strip() or None,
            }
            result = MaintainVideoMetadataTool()(**payload)
            if result.get("status") == "success":
                st.success("Metadata updated.")
                st.experimental_rerun()
            else:
                st.error(result.get("message", "Failed to update metadata"))

    with col_delete:
        st.markdown("**Delete video (cascade)**")
        delete_id = st.selectbox("Select video to delete", options=all_ids or ["—"], key="delete-video")
        confirm = st.checkbox("Confirm delete", key="confirm-delete")
        if st.button("Delete", key="delete-btn") and confirm:
            fs_service = get_file_search_service()
            rag_resource = video_service.delete(delete_id)
            if rag_resource:
                fs_service.delete_document(document_name=rag_resource)
            st.success("Deleted video and associated RAG document (if present).")
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
    render_memory_control_plane()
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


