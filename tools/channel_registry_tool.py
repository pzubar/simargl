"""ADK tool for refreshing channel metadata and registry entries."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

from channel_registry.manager import ChannelRegistryManager
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

    def __init__(self) -> None:
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


class ManageChannelInput(BaseModel):
    action: Literal["view", "add", "update", "refresh"] = Field(
        ...,
        description="Action to perform on the channel registry: view all, add a channel, update manual fields, or refresh metadata.",
    )
    identifier: Optional[str] = Field(
        default=None,
        description="Channel handle (e.g., @handle), ID, URL, or alias. Required for add/update/refresh.",
    )
    owner: Optional[str] = Field(default=None, description="Owner / persona to set (manual field).")
    notes: Optional[str] = Field(default=None, description="Analyst notes to set (manual field).")
    aliases: List[str] = Field(
        default=[],
        description="Aliases to merge (manual field). Provide an empty list to skip.",
    )
    force: bool = Field(default=False, description="Force refresh when action is refresh.")


class ManageChannelRegistryTool(BaseTool):
    """Menu-friendly tool for viewing and editing the channel registry."""

    NAME = "manage_channel_registry"
    DESCRIPTION = (
        "View, add, update, or refresh channels in the registry. Only owner/notes/aliases are editable manually; "
        "metadata is always fetched from YouTube."
    )

    def __init__(self) -> None:
        super().__init__(name=self.NAME, description=self.DESCRIPTION)
        self._manager = ChannelRegistryManager()

    @property
    def args_schema(self) -> type[ManageChannelInput]:
        return ManageChannelInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(**args)

    def __call__(  # type: ignore[override]
        self,
        action: Literal["view", "add", "update", "refresh"],
        identifier: Optional[str] = None,
        owner: Optional[str] = None,
        notes: Optional[str] = None,
        aliases: Optional[List[str]] = None,
        force: bool = False,
    ) -> Dict[str, Any]:
        if action in {"add", "update", "refresh"} and not identifier:
            raise ValueError("identifier is required for add/update/refresh actions")

        # Normalize aliases to a list for downstream logic and schema simplicity.
        aliases = aliases or []

        if action == "view":
            summary = self._manager.view_summary()
            return {
                "action": action,
                "summary": summary,
                "choices": [
                    "add a channel by @handle",
                    "update owner/notes/aliases",
                    "refresh a specific channel",
                ],
                "message": f"{len(summary)} channels in registry",
            }

        if action == "add":
            record = self._manager.add_channel(identifier, owner=owner, notes=notes, aliases=aliases)
            return {
                "action": action,
                "message": f"Added or refreshed channel {record.title or record.channel_id}",
                "record": record.model_dump(mode="json"),
            }

        if action == "update":
            record = self._manager.update_manual_fields(identifier, owner=owner, notes=notes, aliases=aliases)
            if not record:
                return {"action": action, "error": f"No channel found for '{identifier}'"}
            return {
                "action": action,
                "message": f"Updated manual fields for {record.title or record.channel_id}",
                "record": record.model_dump(mode="json"),
            }

        if action == "refresh":
            record = self._manager.refresh(identifier, force=force)
            return {
                "action": action,
                "message": f"Refreshed metadata for {record.title or record.channel_id}",
                "record": record.model_dump(mode="json"),
            }

        raise ValueError(f"Unsupported action: {action}")


__all__ = ["RefreshChannelMetadataTool", "ManageChannelRegistryTool"]
