"""Entry point for running the Google ADK FastAPI server for Simargl."""

from __future__ import annotations

import logging
from pathlib import Path

import uvicorn
from google.adk.cli.fast_api import get_fast_api_app

from config.settings import STREAMLIT_BASE_URL

logger = logging.getLogger(__name__)

AGENTS_DIR = Path(__file__).resolve().parent / "agents"


def build_app():
    """Construct the FastAPI app backed by the ADK agent definition."""
    return get_fast_api_app(
        agents_dir=str(AGENTS_DIR),
        allow_origins=[STREAMLIT_BASE_URL],
        web=False,
        host="0.0.0.0",
        port=8000,
    )


def main() -> None:
    """Main entry point used by `python3 adk_server.py`."""
    logger.info("Starting ADK FastAPI server for Simargl MVP...")
    app = build_app()
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    main()


