"""Streamlit entry point for the multipage Simargl assistant."""
from __future__ import annotations

import logging
import sys

import streamlit as st

from ui.chat import render_chat_page
from ui.sidebar import render_sidebar


def _configure_logging() -> None:
    """Ensure Streamlit runs emit our app logs to stdout."""
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
            stream=sys.stdout,
        )
    root.setLevel(logging.INFO)


def main() -> None:
    """Main Streamlit app entry point (Chat page)."""
    _configure_logging()
    st.set_page_config(page_title="Simargl Research Assistant", layout="wide")
    st.title("Simargl YouTube Research Assistant")
    st.caption("Ask research questions about your tracked YouTube channels.")

    render_sidebar()
    render_chat_page()


if __name__ == "__main__":
    main()
