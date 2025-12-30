"""Channel overview page."""

from __future__ import annotations

import streamlit as st

from ui.channel import render_channel_page
from ui.sidebar import render_sidebar


def main() -> None:
    st.set_page_config(page_title="Channels", layout="wide")
    st.title("Channel Overview")
    st.caption("View per-channel stats, notes, and videos.")

    render_sidebar()
    render_channel_page()


if __name__ == "__main__":
    main()

