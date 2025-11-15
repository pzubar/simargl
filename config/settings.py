"""Centralized configuration and environment loading for the Simargl MVP."""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

BASE_DIR = Path(__file__).resolve().parent.parent
ENV_PATH = BASE_DIR / ".env"

# Load environment variables from .env if present. This keeps compatibility with
# deployment environments that manage env vars externally.
try:
    if ENV_PATH.exists():
        load_dotenv(dotenv_path=ENV_PATH)
    else:
        load_dotenv()
except PermissionError:
    logger.warning(
        "Unable to read %s due to permissions. Using existing environment variables.",
        ENV_PATH,
    )

# --- GCP Configuration ---
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID")
if not GCP_PROJECT_ID:
    raise ValueError(
        "GCP_PROJECT_ID environment variable is required. "
        "Update the .env file or the hosting environment."
    )

GCP_REGION = os.getenv("GCP_REGION", "us-central1")

GOOGLE_APPLICATION_CREDENTIALS_PATH = str((BASE_DIR / "gcp-creds.json").resolve())
os.environ.setdefault("GOOGLE_APPLICATION_CREDENTIALS", GOOGLE_APPLICATION_CREDENTIALS_PATH)

# --- API Keys ---
YOUTUBE_API_KEY = os.getenv("YOUTUBE_API_KEY")
if not YOUTUBE_API_KEY:
    raise ValueError("YOUTUBE_API_KEY environment variable is required.")

# --- MVP Database ---
CHANNEL_DB_PATH = str((BASE_DIR / "channels.json").resolve())
CHANNEL_REGISTRY_PATH = str((BASE_DIR / "data" / "channel_registry.json").resolve())
CHANNEL_METADATA_TTL_HOURS = float(os.getenv("CHANNEL_METADATA_TTL_HOURS", "6"))

# --- Tool Defaults ---
YOUTUBE_DEFAULT_MAX_RESULTS = int(os.getenv("YOUTUBE_DEFAULT_MAX_RESULTS", "5"))
YOUTUBE_DEFAULT_COMMENT_MAX_RESULTS = int(os.getenv("YOUTUBE_DEFAULT_COMMENT_MAX_RESULTS", "100"))

# Streamlit / ADK integration
ADK_SERVER_HOST = os.getenv("ADK_SERVER_HOST", "http://localhost:8000")
STREAMLIT_BASE_URL = os.getenv("STREAMLIT_BASE_URL", "http://localhost:8501")
ADK_APP_NAME = os.getenv("ADK_APP_NAME", "simargl-youtube-assistant")

# --- Gemini model selection ---
GEMINI_MODEL_DEFAULT = os.getenv("GEMINI_MODEL_DEFAULT", "gemini-2.5-flash-preview-09-2025")
GEMINI_MODEL_PREMIUM = os.getenv("GEMINI_MODEL_PREMIUM", "gemini-2.5-flash")
DEFAULT_GEMINI_MODEL = GEMINI_MODEL_DEFAULT
# Backwards compatibility for older imports
PREMIUM_GEMINI_MODEL = GEMINI_MODEL_PREMIUM

# --- Vertex AI Memory Bank ---
VERTEX_MEMORY_AGENT_ENGINE_ID = os.getenv("VERTEX_MEMORY_AGENT_ENGINE_ID")
MEMORY_ENABLED = bool(VERTEX_MEMORY_AGENT_ENGINE_ID)

# --- Gemini File Search ---
FILE_SEARCH_ENABLED = os.getenv("FILE_SEARCH_ENABLED", "true").lower() not in {"0", "false", "no"}
FILE_SEARCH_MODEL = os.getenv("FILE_SEARCH_MODEL", GEMINI_MODEL_DEFAULT)
FILE_SEARCH_POLL_SECONDS = float(os.getenv("FILE_SEARCH_POLL_SECONDS", "2.0"))
FILE_SEARCH_POLL_TIMEOUT_SECONDS = float(os.getenv("FILE_SEARCH_POLL_TIMEOUT_SECONDS", "120.0"))



