"""ADK tool for refreshing channel metadata and registry entries."""

from __future__ import annotations

from typing import Any, Dict

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

from channel_registry.refresh_service import ChannelRefreshService


class RefreshChannelInput(BaseModel):
    identifier: str = Field(
        ...,
        description="Channel ID, @handle, YouTube URL, or owner name to refresh metadata for.",
    )
    force: bool = Field(
        default=False,
        description="Force refresh even if cached data is still fresh.",
    )


class RefreshChannelMetadataTool(BaseTool):
    """Fetch channel snippet/statistics and update the registry + memory."""

    NAME = "refresh_channel_metadata"
    DESCRIPTION = (
        "Refreshes YouTube channel metadata (subscribers, description, aliases) and persists it in the registry."
    )

    def __init__(self):
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )
        self._service = ChannelRefreshService()

    @property
    def args_schema(self) -> type[RefreshChannelInput]:
        return RefreshChannelInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(identifier=args["identifier"], force=args.get("force", False))

    def __call__(self, identifier: str, force: bool = False) -> Dict[str, Any]:  # type: ignore[override]
        record = self._service.refresh(identifier, force=force)
        return record.model_dump(mode="json")


__all__ = ["RefreshChannelMetadataTool"]


