"""Gemini-powered analysis tool that works on uploaded files."""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from google import genai
from google.genai import types
from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

MODEL_NAME = "gemini-flash-latest"
client = genai.Client(vertexai=False)


class FileAnalysisInput(BaseModel):
    file_uris: List[str] = Field(
        ...,
        description="List of Gemini file URIs to analyze.",
    )
    query: str = Field(
        ...,
        description="The research question or instructions for synthesis.",
    )


class FileAnalysisTool(BaseTool):
    """Make a fresh Gemini call that reads uploaded files and answers a query."""

    NAME = "analysis_tool"
    DESCRIPTION = (
        "Analyzes one or more Gemini file URIs with gemini-flash-latest and returns a synthesis."
    )

    def __init__(self) -> None:
        super().__init__(name=self.NAME, description=self.DESCRIPTION)

    @property
    def args_schema(self) -> type[FileAnalysisInput]:
        return FileAnalysisInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return self(
            file_uris=args["file_uris"],
            query=args["query"],
        )

    def __call__(self, *, file_uris: List[str], query: str) -> Dict[str, Any]:
        try:
            file_parts = [
                types.Part(file_data=types.FileData(file_uri=file_uri))
                for file_uri in file_uris
            ]
            instruction = types.Part(
                text=(
                    "Use the provided files as the only context. "
                    "Answer the query succinctly, citing which file URIs informed key points. "
                    f"Query: {query}"
                )
            )
            contents = [
                types.Content(
                    parts=file_parts + [instruction],
                )
            ]
            response = client.models.generate_content(
                model=MODEL_NAME,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="text/plain",
                ),
            )
            analysis_text = response.text.strip() if hasattr(response, "text") else str(response).strip()
            return {"analysis": analysis_text, "file_uris": file_uris}
        except Exception as exc:  # noqa: BLE001
            logger.exception("Error analyzing files via Gemini")
            return {"error": f"Error analyzing files: {exc}"}


__all__ = ("FileAnalysisTool",)
