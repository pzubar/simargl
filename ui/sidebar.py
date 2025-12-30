"""Sidebar components for the multipage Streamlit app."""

from __future__ import annotations

import logging
from typing import List

import streamlit as st

from channel_registry.refresh_service import ChannelRefreshService
from memory import get_channel_registry_service
from services import PlaylistIngestService
from tools.youtube.client import resolve_channel_identifier

logger = logging.getLogger(__name__)


def _safe_resolve_channel_id(identifier: str) -> str:
    """Best effort resolution to a canonical channel ID."""
    try:
        resolved = resolve_channel_identifier(identifier)
        return resolved or identifier
    except Exception:  # noqa: BLE001
        logger.warning("Failed to resolve channel identifier; using raw input")
        return identifier


def render_channel_sidebar() -> List[str]:
    """Render sidebar controls for managing channels via Firestore-backed registry."""
    channel_service = get_channel_registry_service()
    playlist_ingest = PlaylistIngestService()
    refresher = ChannelRefreshService()

    st.sidebar.header("Channel Intelligence")
    with st.sidebar.form("add-channel-form"):
        new_channel = st.text_input("Add channel ID / @handle / URL")
        owner = st.text_input("Owner / Persona (optional)")
        submitted = st.form_submit_button("Save Channel")

    if submitted:
        if new_channel:
            channel_id = _safe_resolve_channel_id(new_channel.strip())
            try:
                channel_service.upsert(
                    channel_id=channel_id,
                    channel_title=channel_id,
                    owner=owner.strip() or None,
                )
                logger.info("UI: scheduling uploads ingest for channel=%s", channel_id)
                with st.spinner("Scheduling uploads ingestion..."):
                    job = playlist_ingest.enqueue_and_run(channel_id)
                st.sidebar.success(
                    f"Channel '{channel_id}' saved and queued uploads ingest "
                    f"({job.get('video_count', 0)} videos)."
                )
                logger.info(
                    "UI: ingest job finished job_id=%s state=%s videos=%s",
                    job.get("job_id"),
                    job.get("state"),
                    job.get("video_count"),
                )
                st.rerun()
            except Exception as exc:  # noqa: BLE001
                logger.exception("UI: ingest scheduling failed for channel=%s", channel_id)
                st.sidebar.warning(
                    f"Channel saved, but ingestion scheduling failed: {exc}"
                )
        else:
            st.sidebar.warning("Please enter a valid channel identifier.")

    channels = channel_service.list_channels(limit=100)
    if not channels:
        st.sidebar.info("No channels saved yet.")
        return []

    for channel in channels:
        channel_id = channel.get("channel_id")
        label = channel.get("channel_title") or channel.get("handle") or channel_id
        with st.sidebar.expander(label or "Channel", expanded=False):
            st.markdown(f"**Handle:** {channel.get('handle') or '—'}")
            st.markdown(f"**Owner:** {channel.get('owner') or '—'}")
            st.caption(f"Last indexed: {channel.get('last_indexed_at') or 'unknown'}")
            next_page_token = channel.get("uploads_next_page_token")
            if next_page_token:
                st.caption("More uploads available.")
            else:
                st.caption("Uploads up to date.")

            if st.button("Refresh metadata", key=f"refresh-metadata-{channel_id}"):
                refresher.refresh(channel_id, force=True)
                st.sidebar.success("Metadata updated.")
                st.rerun()

            if st.button("Refresh videos", key=f"refresh-videos-{channel_id}"):
                with st.spinner("Refreshing channel uploads..."):
                    job = playlist_ingest.enqueue_and_run(channel_id)
                st.sidebar.success(
                    f"Queued uploads refresh: {job.get('video_count', 0)} videos."
                )
                st.rerun()

            if next_page_token and st.button("Load 100 more uploads", key=f"load-more-{channel_id}"):
                with st.spinner("Loading next 100 uploads..."):
                    job = playlist_ingest.enqueue_and_run(channel_id, max_items=100)
                st.sidebar.success(
                    f"Loaded additional uploads: {job.get('video_count', 0)} videos."
                )
                st.rerun()

            notes_value = st.text_area(
                "Analyst notes",
                value=channel.get("notes") or "",
                key=f"notes-{channel_id}",
                height=90,
            )
            if st.button("Save notes", key=f"save-notes-{channel_id}"):
                channel_service.update_partial(channel_id, notes=notes_value.strip() or None)
                st.sidebar.success("Notes saved.")
                st.rerun()

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


def render_batch_sidebar() -> None:
    """Render sidebar controls for batch jobs (kept from original UI)."""
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
                            from tools.batch_tool import GetBatchResultsTool
                            import asyncio

                            tool = GetBatchResultsTool()
                            result = asyncio.run(
                                tool(
                                    job_id=job_id,
                                    file_search_store_name="default_store",
                                )
                            )
                            st.success(f"Synced! {result.get('message')}")
                            st.rerun()
                        except Exception as exc:  # noqa: BLE001
                            st.error(f"Sync failed: {exc}")

            elif state in ["PENDING", "PROCESSING"]:
                if st.button("Check Status", key=f"check-{short_id}"):
                    service.check_job_status(job_id)
                    st.rerun()


def render_sidebar() -> None:
    """Render all sidebar sections."""
    render_channel_sidebar()
    render_batch_sidebar()
