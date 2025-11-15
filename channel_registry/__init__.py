"""Factory helpers for the channel registry."""

from __future__ import annotations

from typing import Optional

from config.settings import CHANNEL_REGISTRY_PATH

from .registry import ChannelRegistry

_registry: Optional[ChannelRegistry] = None


def get_channel_registry() -> ChannelRegistry:
    global _registry  # noqa: PLW0603
    if _registry is None:
        _registry = ChannelRegistry(CHANNEL_REGISTRY_PATH)
    return _registry


__all__ = ["ChannelRegistry", "get_channel_registry"]


