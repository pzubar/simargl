"""Time and timestamp helpers for YouTube API interactions."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Optional


def format_rfc3339(dt: datetime) -> str:
    """Format datetimes as RFC3339 strings for the YouTube API."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    return dt.isoformat().replace("+00:00", "Z")


def maybe_normalize_timestamp(value: Optional[str]) -> Optional[str]:
    """Attempt to coerce user-provided timestamps into RFC3339 strings."""
    if not value:
        return None
    try:
        cleaned = value.strip()
        # Allow simple date-only strings by appending midnight UTC
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", cleaned):
            cleaned = f"{cleaned}T00:00:00Z"
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        dt = datetime.fromisoformat(cleaned)
        return format_rfc3339(dt)
    except ValueError:
        return value


def parse_iso8601_duration(duration_iso: str) -> int:
    """Parse ISO 8601 duration string (e.g., 'PT1H5M10S') to total seconds."""
    if not duration_iso.startswith("PT"):
        raise ValueError(f"Invalid ISO 8601 duration format: {duration_iso}")

    pattern = r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"
    match = re.match(pattern, duration_iso)

    if not match:
        raise ValueError(f"Invalid ISO 8601 duration format: {duration_iso}")

    hours = int(match.group(1) or 0)
    minutes = int(match.group(2) or 0)
    seconds = int(match.group(3) or 0)

    return hours * 3600 + minutes * 60 + seconds


__all__ = ["format_rfc3339", "maybe_normalize_timestamp", "parse_iso8601_duration"]
