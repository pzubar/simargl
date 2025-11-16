"""ADK tool wrappers for Gemini File Search operations."""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

from memory import get_file_search_service

logger = logging.getLogger(__name__)


class CreateStoreInput(BaseModel):
    display_name: str = Field(..., description="Human-readable name for the File Search store.")


class UploadDocumentInput(BaseModel):
    store_name: str = Field(..., description="Resource name of the target File Search store.")
    text_content: str = Field(..., description="Full text content to ingest.")
    document_display_name: str = Field(..., description="Display name for the File Search document.")
    mime_type: Optional[str] = Field("text/plain", description="MIME type for the uploaded document.")
    metadata: str = Field(
        default="",
        description="Optional key/value metadata attached to the File Search document as a JSON string.",
    )


class QueryStoreInput(BaseModel):
    store_name: str = Field(..., description="Resource name of the File Search store.")
    query: str = Field(..., description="Natural language question to ground against the store.")
    top_k: int = Field(5, description="How many chunks the File Search tool should fetch.")
    instructions: Optional[str] = Field(
        default=None,
        description="Optional system instruction; defaults to a concise summary request.",
    )
    model: Optional[str] = Field(
        default=None,
        description="Override for the Gemini model used during retrieval.",
    )


class CreateFileSearchStoreTool(BaseTool):
    """Provision a new Gemini File Search store."""

    NAME = "create_file_search_store"
    DESCRIPTION = "Creates a Gemini File Search store for persisting transcripts or notes."

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[CreateStoreInput]:
        return CreateStoreInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: Dict[str, Any], tool_context) -> Dict[str, str]:
        return self(display_name=args["display_name"])

    def __call__(self, display_name: str) -> Dict[str, str]:  # type: ignore[override]
        service = get_file_search_service()
        return service.create_store(display_name=display_name)


class UploadFileSearchDocumentTool(BaseTool):
    """Upload text content into an existing File Search store."""



    NAME = "upload_file_search_document"
    DESCRIPTION = "Uploads raw text (transcripts, comments, notes) into a File Search store."

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[UploadDocumentInput]:
        return UploadDocumentInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: Dict[str, Any], tool_context) -> Dict[str, Optional[str]]:
        metadata_str = args.get("metadata", "")
        metadata = json.loads(metadata_str) if metadata_str else None
        return self(
            store_name=args["store_name"],
            text_content=args["text_content"],
            document_display_name=args["document_display_name"],
            mime_type=args.get("mime_type", "text/plain"),
            metadata=metadata,
        )

    def __call__(  # type: ignore[override]
        self,
        store_name: str,
        text_content: str,
        document_display_name: str,
        mime_type: str = "text/plain",
        metadata: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Optional[str]]:
        service = get_file_search_service()
        return service.upload_text(
            store_name=store_name,
            content=text_content,
            display_name=document_display_name,
            mime_type=mime_type,
            metadata=metadata,
        )


class QueryFileSearchStoreTool(BaseTool):
    """Query a File Search store and return grounded snippets."""

    NAME = "query_file_search_store"
    DESCRIPTION = (
        "Retrieves grounded snippets from a Gemini File Search store to answer a research question."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )

    @property
    def args_schema(self) -> type[QueryStoreInput]:
        return QueryStoreInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: Dict[str, Any], tool_context) -> Dict[str, object]:
        return self(
            store_name=args["store_name"],
            query=args["query"],
            top_k=args.get("top_k", 5),
            instructions=args.get("instructions"),
            model=args.get("model"),
        )

    def __call__(  # type: ignore[override]
        self,
        store_name: str,
        query: str,
        top_k: int = 5,
        instructions: Optional[str] = None,
        model: Optional[str] = None,
    ) -> Dict[str, object]:
        top_k = max(1, min(20, top_k))
        service = get_file_search_service()
        return service.query(
            store_name=store_name,
            query=query,
            top_k=top_k,
            model_override=model,
            instructions=instructions,
        )


__all__ = [
    "CreateFileSearchStoreTool",
    "UploadFileSearchDocumentTool",
    "QueryFileSearchStoreTool",
]