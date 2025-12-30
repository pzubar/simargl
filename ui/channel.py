"""Channel detail page with per-channel videos and notes."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import streamlit as st

from memory import get_channel_registry_service, get_video_metadata_service

PAGE_SIZE = 25


def _init_channel_pagination(channel_id: str) -> None:
    tokens: Dict[str, List[Optional[Any]]] = st.session_state.setdefault("channel_page_tokens", {})
    tokens.setdefault(channel_id, [None])
    st.session_state["channel_page_tokens"] = tokens


def _current_token(channel_id: str) -> Optional[Any]:
    tokens: Dict[str, List[Optional[Any]]] = st.session_state.get("channel_page_tokens", {})
    return (tokens.get(channel_id) or [None])[-1]


def _push_token(channel_id: str, token: Optional[Any]) -> None:
    tokens: Dict[str, List[Optional[Any]]] = st.session_state.setdefault("channel_page_tokens", {})
    stack = tokens.get(channel_id) or [None]
    stack.append(token)
    tokens[channel_id] = stack
    st.session_state["channel_page_tokens"] = tokens


def _pop_token(channel_id: str) -> None:
    tokens: Dict[str, List[Optional[Any]]] = st.session_state.get("channel_page_tokens", {})
    stack = tokens.get(channel_id) or [None]
    if len(stack) > 1:
        stack.pop()
    tokens[channel_id] = stack
    st.session_state["channel_page_tokens"] = tokens


def _format_timestamp(value: Any) -> str:
    if value is None:
        return "—"
    try:
        # Firestore returns datetime-like objects
        return value.isoformat()
    except Exception:  # noqa: BLE001
        return str(value)


def _render_channel_header(channel: Dict[str, Any], video_count: int) -> None:
    title = channel.get("channel_title") or channel.get("handle") or channel.get("channel_id")
    handle = channel.get("handle")
    owner = channel.get("owner") or "—"
    notes = channel.get("notes") or ""
    last_indexed = _format_timestamp(channel.get("last_indexed_at"))
    last_ingested = _format_timestamp(channel.get("uploads_last_ingested_at"))

    st.subheader(title or "Channel")
    st.caption(f"Handle: {handle or '—'} | Owner: {owner}")

    col1, col2, col3 = st.columns(3)
    col1.metric("Videos", f"{video_count:,}")
    col2.metric("Last indexed", last_indexed)
    col3.metric("Last uploads ingest", last_ingested)

    with st.expander("Notes", expanded=bool(notes)):
        edited_notes = st.text_area(
            "Analyst notes",
            value=notes,
            placeholder="Add notes about this channel/channel...",
            height=120,
            key=f"notes-{channel.get('channel_id')}",
        )
        if st.button("Save notes", key=f"save-notes-{channel.get('channel_id')}"):
            channel_service = get_channel_registry_service()
            channel_service.update_partial(channel.get("channel_id"), notes=edited_notes.strip() or None)
            st.success("Notes saved.")
            st.rerun()


def _render_video_table(channel_id: str) -> None:
    _init_channel_pagination(channel_id)
    video_service = get_video_metadata_service()

    start_after = _current_token(channel_id)
    raw_videos = video_service.list_channel_page(
        channel_id=channel_id,
        limit=PAGE_SIZE + 1,
        start_after_published_at=start_after,
    )
    has_next = len(raw_videos) > PAGE_SIZE
    page_videos = raw_videos[:PAGE_SIZE]

    if not page_videos:
        st.info("No videos for this channel yet.")
        return

    st.dataframe(
        [
            {
                "title": v.get("title"),
                "video_id": v.get("video_id"),
                "published_at": v.get("published_at"),
                "views": v.get("view_count"),
                "duration_sec": v.get("duration_sec"),
                "tags": ", ".join(v.get("tags") or []),
                "custom_tags": ", ".join(v.get("custom_tags") or []),
                "has_transcript": v.get("has_transcript"),
            }
            for v in page_videos
        ],
        width="stretch",
        hide_index=True,
    )

    col_prev, col_next = st.columns(2)
    with col_prev:
        if st.button("Previous page", disabled=len(st.session_state.get("channel_page_tokens", {}).get(channel_id, [])) <= 1):
            _pop_token(channel_id)
            st.rerun()
    with col_next:
        next_token = page_videos[-1].get("published_at") if page_videos else None
        if st.button("Next page", disabled=not (has_next and next_token)):
            _push_token(channel_id, next_token)
            st.rerun()


def render_channel_page() -> None:
    """Main entry for the channel detail page."""
    channel_service = get_channel_registry_service()
    channels = channel_service.list_channels(limit=200)
    if not channels:
        st.info("No channels found. Add channels from the Chat page sidebar.")
        return

    options = [
        (
            channel.get("channel_title") or channel.get("handle") or channel.get("channel_id"),
            channel.get("channel_id"),
        )
        for channel in channels
    ]
    labels = [label or cid or "Channel" for label, cid in options]
    selected_label = st.selectbox("Choose channel", options=labels)
    selected_idx = labels.index(selected_label)
    selected_channel = channels[selected_idx]
    selected_channel_id = selected_channel.get("channel_id")

    video_service = get_video_metadata_service()
    video_count = video_service.count_by_channel(selected_channel_id)

    _render_channel_header(selected_channel, video_count)
    st.markdown("---")
    st.subheader("Videos")
    _render_video_table(selected_channel_id)

