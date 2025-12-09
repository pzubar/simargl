"""YouTube Data API client utilities."""

from __future__ import annotations

import errno
import logging
import time
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

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
    """
    Execute a Google API request with basic retries.

    The API client occasionally surfaces `OSError: [Errno 49] Can't assign requested address`
    when the local socket pool is momentarily exhausted. We treat that as a transient error
    and retry with a short backoff so the caller gets a graceful response instead of
    bubbling the exception.
    """
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
        except OSError as exc:
            last_exc = exc
            is_addr_unavailable = getattr(exc, "errno", None) == errno.EADDRNOTAVAIL
            if is_addr_unavailable and attempt < attempts:
                backoff = 0.5 * attempt
                logger.warning(
                    "YouTube API %s socket error (%s) attempt %s/%s, retrying in %.1fs",
                    label,
                    exc,
                    attempt,
                    attempts,
                    backoff,
                )
                time.sleep(backoff)
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


def _derive_uploads_playlist_id(channel_id: str) -> Optional[str]:
    """Best-effort derivation: UCxxxx -> UUxxxx."""
    if not channel_id or not channel_id.startswith("UC") or len(channel_id) < 3:
        return None
    return f"UU{channel_id[2:]}"


def resolve_uploads_playlist_id(
    channel_id: str,
    *,
    service=None,
    retries: int = 2,
) -> Optional[str]:
    """
    Resolve and cache the uploads playlist ID for a channel.

    The helper first checks the local channel registry, then confirms via
    channels.list (contentDetails). If the API call fails, it falls back to
    deriving the UU-prefixed ID. Successful resolutions are cached to
    data/channel_registry.json.
    """
    if not channel_id or not channel_id.startswith("UC"):
        return None

    registry = get_channel_registry()
    try:
        record = registry.resolve(channel_id) or registry.get(channel_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to read channel registry for %s: %s", channel_id, exc)
        record = None

    if record and record.uploads_playlist_id:
        return record.uploads_playlist_id

    playlist_id: Optional[str] = None
    service = service or get_youtube_service()
    try:
        request = service.channels().list(
            part="contentDetails",
            id=channel_id,
            maxResults=1,
        )
        sanitized_uri = redact_request_uri(request)
        if sanitized_uri:
            logger.info("YouTube API request (uploads playlist lookup): %s", sanitized_uri)
        response = execute_request(request, retries=retries, label="uploads playlist lookup")
        items = response.get("items", [])
        if items:
            playlist_id = (
                items[0]
                .get("contentDetails", {})
                .get("relatedPlaylists", {})
                .get("uploads")
            )
    except HttpError as http_err:
        logger.warning(
            "YouTube API error resolving uploads playlist for %s: %s", channel_id, http_err
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Unexpected error resolving uploads playlist for %s: %s", channel_id, exc)

    if not playlist_id:
        playlist_id = _derive_uploads_playlist_id(channel_id)

    if playlist_id:
        try:
            record = record or registry.find_or_create_by_identifier(channel_id)
            if record.uploads_playlist_id != playlist_id:
                record.uploads_playlist_id = playlist_id
                registry.upsert(record)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Failed to persist uploads playlist %s for channel %s: %s",
                playlist_id,
                channel_id,
                exc,
            )

    return playlist_id


__all__ = [
    "get_youtube_service",
    "execute_request",
    "redact_request_uri",
    "resolve_channel_identifier",
    "resolve_uploads_playlist_id",
]
