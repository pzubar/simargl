"""Memory library page."""

from __future__ import annotations

import streamlit as st

from ui.memory import render_memory_page
from ui.sidebar import render_sidebar


def main() -> None:
    st.set_page_config(page_title="Simargl Memory Library", layout="wide")
    st.title("Memory Library")
    st.caption("Browse and manage ingested videos.")

    render_sidebar()
    render_memory_page()


if __name__ == "__main__":
    main()

