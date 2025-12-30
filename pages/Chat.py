"""Chat page for the multipage Streamlit app."""

from __future__ import annotations

import streamlit as st

from ui.chat import render_chat_page
from ui.sidebar import render_sidebar


def main() -> None:
    st.set_page_config(page_title="Simargl Research Assistant", layout="wide")
    st.title("Simargl YouTube Research Assistant")
    st.caption("Ask research questions about your tracked YouTube channels.")

    render_sidebar()
    render_chat_page()


if __name__ == "__main__":
    main()

