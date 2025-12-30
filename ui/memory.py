"""Memory library page components with Firestore pagination."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import streamlit as st

from memory import (
    get_channel_registry_service,
    get_file_search_service,
    get_video_metadata_service,
)
from tools.video_memory_tools import IngestVideoTool, MaintainVideoMetadataTool

PAGE_SIZE = 50


def _extract_video_id(url_or_id: str) -> str:
    if "youtube.com/watch" in url_or_id and "v=" in url_or_id:
        return url_or_id.split("v=")[1].split("&")[0]
    if "youtu.be/" in url_or_id:
        return url_or_id.split("youtu.be/")[1].split("?")[0]
    return url_or_id.strip()


def _init_pagination_state() -> None:
    """Initialize pagination tokens (start_after published_at)."""
    if "memory_page_tokens" not in st.session_state:
        st.session_state["memory_page_tokens"] = [None]


def _current_token() -> Optional[Any]:
    tokens = st.session_state.get("memory_page_tokens") or [None]
    return tokens[-1]


def _pop_prev_token() -> None:
    tokens = st.session_state.get("memory_page_tokens") or [None]
    if len(tokens) > 1:
        tokens.pop()
        st.session_state["memory_page_tokens"] = tokens


def _push_token(token: Any) -> None:
    tokens = st.session_state.get("memory_page_tokens") or [None]
    tokens.append(token)
    st.session_state["memory_page_tokens"] = tokens


def _enrich_channel_titles(videos: List[Dict[str, Any]]) -> None:
    channel_service = get_channel_registry_service()
    for video in videos:
        cid = video.get("channel_id")
        channel = channel_service.get(cid) if cid else None
        video["channel_title"] = channel.get("channel_title") if channel else None
        video["tags"] = video.get("tags") or []
        video["custom_tags"] = video.get("custom_tags") or []
        video["has_transcript"] = bool(video.get("rag_resource_name"))


def render_memory_page() -> None:
    """Render the hybrid memory library with paging."""
    st.subheader("Hybrid Memory Library")
    _init_pagination_state()

    video_service = get_video_metadata_service()

    start_after = _current_token()
    raw_videos = video_service.list_page(
        limit=PAGE_SIZE + 1,
        start_after_published_at=start_after,
    )
    has_next = len(raw_videos) > PAGE_SIZE
    page_videos = raw_videos[:PAGE_SIZE]

    _enrich_channel_titles(page_videos)

    if page_videos:
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
                for v in page_videos
            ],
            width="stretch",
        )
    else:
        st.info("No videos ingested yet.")

    col_prev, col_next = st.columns(2)
    with col_prev:
        if st.button("Previous page", disabled=len(st.session_state["memory_page_tokens"]) <= 1):
            _pop_prev_token()
            st.rerun()
    with col_next:
        next_token = page_videos[-1].get("published_at") if page_videos else None
        if st.button("Next page", disabled=not (has_next and next_token)):
            _push_token(next_token)
            st.rerun()

    st.markdown("---")
    col_ingest, col_edit, col_delete = st.columns(3)

    with col_ingest:
        st.markdown("**Manual ingest**")
        url_input = st.text_input("YouTube URL or ID", key="ingest-url")
        store_name = st.text_input(
            "File Search store",
            value="simargl-file-search",
            key="ingest-store",
        )
        if st.button("Add video", key="ingest-btn"):
            vid = _extract_video_id(url_input)
            with st.spinner("Ingesting..."):
                result = IngestVideoTool()(video_id=vid, file_search_store_name=store_name)
            if result.get("status") == "success":
                st.success("Ingested successfully.")
                st.rerun()
            else:
                st.error(result.get("message", "Failed to ingest"))

    with col_edit:
        st.markdown("**Edit metadata**")
        all_ids = [v.get("video_id") for v in page_videos]
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
                st.rerun()
            else:
                st.error(result.get("message", "Failed to update metadata"))

    with col_delete:
        st.markdown("**Delete video (cascade)**")
        delete_id = st.selectbox("Select video to delete", options=[v.get("video_id") for v in page_videos] or ["—"], key="delete-video")
        confirm = st.checkbox("Confirm delete", key="confirm-delete")
        if st.button("Delete", key="delete-btn") and confirm:
            fs_service = get_file_search_service()
            rag_resource = video_service.delete(delete_id)
            if rag_resource:
                fs_service.delete_document(document_name=rag_resource)
            st.success("Deleted video and associated RAG document (if present).")
            st.rerun()

