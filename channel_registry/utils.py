"""Normalization helpers for channel registry data."""

from __future__ import annotations

from typing import Iterable, List, Optional


def normalize_handle(value: Optional[str]) -> Optional[str]:
    """Return handle with a single leading '@' or None if empty."""
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    cleaned = cleaned.lstrip("@")
    return f"@{cleaned}"


def dedupe_aliases(aliases: Iterable[Optional[str]]) -> List[str]:
    """Deduplicate aliases case-insensitively while preserving order."""
    seen = set()
    result: List[str] = []
    for alias in aliases:
        if not alias:
            continue
        cleaned = alias.strip()
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(cleaned)
    return result


__all__ = ["normalize_handle", "dedupe_aliases"]
