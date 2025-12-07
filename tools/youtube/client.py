"""YouTube Data API client utilities."""

from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from googleapiclient.discovery import build

from config.settings import YOUTUBE_API_KEY
from channel_registry import get_channel_registry

logger = logging.getLogger(__name__)

_youtube_service = None


def get_youtube_service():
    """Create or reuse a YouTube Data API service client."""
    global _youtube_service  # noqa: PLW0603
    if _youtube_service is None:
        _youtube_service = build(
            "youtube",
            "v3",
            developerKey=YOUTUBE_API_KEY,
            cache_discovery=False,
        )
    return _youtube_service


def execute_request(request, *, retries: int = 1, label: str = "request"):
    """Execute a Google API request with basic timeout retries."""
    last_exc: Optional[Exception] = None
    attempts = max(0, retries) + 1
    for attempt in range(1, attempts + 1):
        try:
            return request.execute(num_retries=0)
        except TimeoutError as exc:
            last_exc = exc
            if attempt < attempts:
                logger.warning(
                    "YouTube API %s timeout (attempt %s/%s), retrying...",
                    label,
                    attempt,
                    attempts,
                )
                continue
            raise
    if last_exc:
        raise last_exc
    raise RuntimeError("Failed to execute request for unknown reasons.")


def redact_request_uri(request) -> Optional[str]:
    """Return a sanitized request URI without the API key."""
    try:
        uri = getattr(request, "uri", None)
        if not uri:
            return None
        parts = urlsplit(uri)
        filtered_query = [
            (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if k != "key"
        ]
        sanitized = urlunsplit(
            (
                parts.scheme,
                parts.netloc,
                parts.path,
                urlencode(filtered_query),
                parts.fragment,
            )
        )
        return sanitized
    except Exception as exc:  # noqa: BLE001
        logger.debug("Failed to redact request URI: %s", exc)
        return None


def resolve_channel_identifier(identifier: str) -> Optional[str]:
    """
    Resolve a user-friendly identifier (handle/title/custom URL) to a canonical channel ID.
    Returns None if it cannot be resolved.
    """
    if not identifier:
        return None
    cleaned = identifier.strip()
    if cleaned.startswith("UC"):
        return cleaned

    try:
        registry = get_channel_registry()
        record = registry.resolve(cleaned)
        if record and record.channel_id:
            return record.channel_id
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to resolve channel identifier %s via registry: %s", identifier, exc)
    return None


__all__ = ["get_youtube_service", "execute_request", "redact_request_uri", "resolve_channel_identifier"]
