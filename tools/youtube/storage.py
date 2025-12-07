"""Gemini file upload helpers shared across YouTube tools."""

from __future__ import annotations

import logging
import os
import tempfile
import time
from typing import Optional

from google import genai

logger = logging.getLogger(__name__)

_genai_client = None

FILE_POLL_INTERVAL_SECONDS = 1.0
FILE_POLL_TIMEOUT_SECONDS = 120.0


def get_genai_client():
    """Create or reuse a Gemini client that targets AI Studio (not Vertex)."""
    global _genai_client  # noqa: PLW0603
    if _genai_client is None:
        _genai_client = genai.Client(vertexai=False)
    return _genai_client


def wait_for_file_active(client: genai.Client, *, name: str) -> str:
    """Poll a Gemini file until it becomes ACTIVE or times out."""
    deadline = time.time() + FILE_POLL_TIMEOUT_SECONDS
    current = client.files.get(name=name)
    while current.state not in {"ACTIVE", "FAILED"} and time.time() < deadline:
        time.sleep(FILE_POLL_INTERVAL_SECONDS)
        current = client.files.get(name=name)
    if current.state != "ACTIVE":
        raise RuntimeError(f"File upload did not become ACTIVE (state={current.state})")
    return current.uri


def upload_text_to_gemini_file(*, text: str, display_name: str) -> str:
    """Upload text to Gemini Files and return the file URI."""
    client = get_genai_client()
    temp_path: Optional[str] = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="w",
            suffix=".txt",
            delete=False,
            encoding="utf-8",
        ) as tmp:
            tmp.write(text)
            tmp.flush()
            temp_path = tmp.name
        upload = client.files.upload(file=temp_path)
        return wait_for_file_active(client, name=upload.name)
    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                logger.debug("Temporary transcript file already cleaned up: %s", temp_path)


__all__ = [
    "get_genai_client",
    "upload_text_to_gemini_file",
    "wait_for_file_active",
    "FILE_POLL_INTERVAL_SECONDS",
    "FILE_POLL_TIMEOUT_SECONDS",
]
