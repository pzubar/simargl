"""Streamlit page to trigger the Stenographer agent for a YouTube video."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict

import requests
import streamlit as st

from config.settings import ADK_SERVER_HOST, STENOGRAPHER_STORE_NAME
from ui.sidebar import render_sidebar

logger = logging.getLogger(__name__)


def _call_agent(query: str) -> Dict[str, Any]:
    payload = {"query": query}
    response = requests.post(f"{ADK_SERVER_HOST}/invoke", json=payload, timeout=120)
    response.raise_for_status()
    return response.json()


def main() -> None:
    st.set_page_config(page_title="Stenographer", layout="wide")
    st.title("Stenographer")
    st.caption("Run Gemini 2.5 Flash stenography and store results in File Search.")

    render_sidebar()

    video_url = st.text_input("YouTube video URL", placeholder="https://www.youtube.com/watch?v=...")
    use_store = STENOGRAPHER_STORE_NAME or "stenographer-store"

    col1, col2 = st.columns(2)
    with col1:
        st.text_input("Target File Search store", value=use_store, disabled=True, help="Configured stenographer store.")
    with col2:
        st.write("")  # spacing

    if st.button("Run Stenographer", type="primary", disabled=not video_url.strip()):
        query = (
            f"Run the Stenographer on {video_url.strip()}. "
            f"Use the global File Search store {use_store} for output."
        )
        with st.spinner("Running Stenographer..."):
            try:
                result = _call_agent(query)
                st.success("Stenographer completed.")
                st.markdown(f"**Agent response:**\n\n```json\n{json.dumps(result, indent=2)}\n```")
            except requests.RequestException as exc:
                logger.exception("Error calling Stenographer")
                st.error(f"Failed to invoke agent: {exc}")


if __name__ == "__main__":
    main()

