"""Lightweight wrapper for Gemini File Search store management."""

from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from typing import Dict, List, Optional

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)


class FileSearchDisabledError(RuntimeError):
    """Raised when file search is invoked but not configured."""


class FileSearchService:
    """Convenience layer over Gemini File Search APIs."""

    def __init__(
        self,
        *,
        enabled: bool,
        default_model: str,
        poll_seconds: float = 2.0,
        poll_timeout_seconds: float = 120.0,
    ):
        self._enabled = enabled
        self._default_model = default_model
        self._poll_seconds = poll_seconds
        self._poll_timeout = poll_timeout_seconds
        self._client = genai.Client() if enabled else None

    def ensure_enabled(self):
        if not self._enabled or self._client is None:
            raise FileSearchDisabledError(
                "Gemini File Search is disabled. Set FILE_SEARCH_ENABLED=true and configure API credentials."
            )

    def create_store(self, display_name: str) -> Dict[str, str]:
        """Create a new store and return its resource name."""
        self.ensure_enabled()
        store = self._client.file_search_stores.create(config={"display_name": display_name})
        logger.info("Created File Search store %s (%s)", store.name, store.display_name)
        return {
            "name": store.name,
            "display_name": store.display_name,
        }

    def upload_text(
        self,
        *,
        store_name: str,
        content: str,
        display_name: str,
        mime_type: str = "text/plain",
        metadata: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Optional[str]]:
        """Upload raw text as a new document inside the store."""
        self.ensure_enabled()
        if not content.strip():
            raise ValueError("Cannot ingest empty content into File Search.")

        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile("w", encoding="utf-8", suffix=".txt", delete=False) as tmp_file:
                tmp_file.write(content)
                tmp_path = tmp_file.name

            config = {
                "display_name": display_name,
                "mime_type": mime_type,
            }
            if metadata:
                config["custom_metadata"] = [{"key": k, "value": v} for k, v in metadata.items()]

            operation = self._client.file_search_stores.upload_to_file_search_store(
                file_search_store_name=store_name,
                file=tmp_path,
                config=config,
            )
            completed_op = self._wait_for_operation(operation)
            document_name = None
            if completed_op.response:
                document_name = completed_op.response.document_name
            logger.info(
                "Uploaded document %s to store %s (display=%s)",
                document_name,
                store_name,
                display_name,
            )
            return {
                "store_name": store_name,
                "document_name": document_name,
            }
        finally:
            if tmp_path and os.path.exists(tmp_path):
                try:
                    os.remove(tmp_path)
                except OSError:
                    logger.warning("Failed to clean up temp file %s", tmp_path)

    def query(
        self,
        *,
        store_name: str,
        query: str,
        top_k: int = 5,
        model_override: Optional[str] = None,
        instructions: Optional[str] = None,
    ) -> Dict[str, object]:
        """Ask Gemini to ground its answer in a given File Search store."""
        self.ensure_enabled()
        model_name = model_override or self._default_model
        tool = types.Tool(
            file_search=types.FileSearch(
                file_search_store_names=[store_name],
                top_k=top_k,
            )
        )
        user_prompt = instructions or (
            "Use only the passages retrieved via File Search to answer. "
            "Respond with a concise summary plus cite the supporting snippets."
        )
        response = self._client.models.generate_content(
            model=model_name,
            contents=[
                types.Content(
                    role="user",
                    parts=[
                        types.Part(
                            text=f"{user_prompt}\n\nQuestion: {query}"
                        )
                    ],
                )
            ],
            config=types.GenerateContentConfig(
                tools=[tool],
            ),
        )

        answer = getattr(response, "text", None) or ""
        grounding = self._extract_grounding_chunks(response)
        return {
            "model": model_name,
            "answer": answer,
            "grounding": grounding,
        }

    def _extract_grounding_chunks(self, response) -> List[Dict[str, Optional[str]]]:
        chunks: List[Dict[str, Optional[str]]] = []
        for candidate in getattr(response, "candidates", []) or []:
            metadata = getattr(candidate, "grounding_metadata", None)
            if not metadata or not getattr(metadata, "grounding_chunks", None):
                continue
            for chunk in metadata.grounding_chunks:
                context = getattr(chunk, "retrieved_context", None)
                if not context:
                    continue
                chunks.append(
                    {
                        "document_name": getattr(context, "document_name", None),
                        "title": getattr(context, "title", None),
                        "uri": getattr(context, "uri", None),
                        "text": getattr(context, "text", None),
                    }
                )
        return chunks

    def _wait_for_operation(self, operation):
        """Poll Gemini operations until the upload completes."""
        start = time.time()
        current = operation
        while not current.done:
            if time.time() - start > self._poll_timeout:
                raise TimeoutError(
                    f"File Search upload did not complete within {self._poll_timeout} seconds."
                )
            time.sleep(self._poll_seconds)
            current = self._client.operations.get(current)

        if current.error:
            raise RuntimeError(
                f"File Search upload failed: {json.dumps(current.error)}"
            )
        return current


__all__ = ["FileSearchService", "FileSearchDisabledError"]


