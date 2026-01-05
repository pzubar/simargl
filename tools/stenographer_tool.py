"""Stenographer tool: Gemini 2.5 Flash video understanding + File Search ingest."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, Optional

from google import genai
from google.genai import types
from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from googleapiclient.discovery import build
from pydantic import BaseModel, Field

from config.settings import (
    BASE_DIR,
    STENOGRAPHER_STORE_DISPLAY_NAME,
    STENOGRAPHER_STORE_NAME,
    YOUTUBE_API_KEY,
)
from memory import get_file_search_service

logger = logging.getLogger(__name__)

MODEL_NAME = "gemini-2.5-flash"
PROMPT_PATH = BASE_DIR / "prompts" / "Stenographer_v1.md"


class StenographerInput(BaseModel):
    video_url: Optional[str] = Field(
        default=None, description="YouTube video URL; either url or id is required."
    )
    video_id: Optional[str] = Field(
        default=None, description="YouTube video ID; either id or url is required."
    )


class StenographerTool(BaseTool):
    """Generate stenographic markdown for a YouTube video and save to File Search."""

    NAME = "run_stenographer"
    DESCRIPTION = (
        "Uses Gemini 2.5 Flash video understanding with the Stenographer prompt, "
        "then uploads the markdown to File Search with metadata (video_id, channel_id, publication_date)."
    )

    def __init__(self) -> None:
        super().__init__(name=self.NAME, description=self.DESCRIPTION)
        self._client = genai.Client()
        self._prompt = self._load_prompt()
        self._store_name_cache: Optional[str] = None

    @property
    def args_schema(self) -> type[StenographerInput]:
        return StenographerInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: Dict[str, Any], tool_context) -> Dict[str, Any]:
        return await self(
            video_url=args.get("video_url"),
            video_id=args.get("video_id"),
        )

    def _load_prompt(self) -> str:
        try:
            return PROMPT_PATH.read_text(encoding="utf-8").strip()
        except Exception as exc:  # pragma: no cover - filesystem errors
            logger.error("Failed to load stenographer prompt: %s", exc)
            return "Generate a detailed stenographic markdown transcript."

    def _extract_video_id(self, video_url: str) -> Optional[str]:
        try:
            if "youtube.com/watch?v=" in video_url:
                return video_url.split("youtube.com/watch?v=")[1].split("&")[0]
            if "youtu.be/" in video_url:
                return video_url.split("youtu.be/")[1].split("?")[0]
        except Exception:
            return None
        return None

    def _fetch_video_metadata(self, video_id: str) -> Dict[str, Optional[str]]:
        try:
            yt = build("youtube", "v3", developerKey=YOUTUBE_API_KEY)
            resp = yt.videos().list(part="snippet", id=video_id).execute()
            items = resp.get("items", [])
            if not items:
                return {}
            snippet = items[0].get("snippet", {}) or {}
            return {
                "title": snippet.get("title"),
                "channel_id": snippet.get("channelId"),
                "channel_title": snippet.get("channelTitle"),
                "published_at": snippet.get("publishedAt"),
            }
        except Exception as exc:
            logger.warning("Failed to fetch video metadata for %s: %s", video_id, exc)
            return {}

    def _ensure_store_name(self) -> str:
        if self._store_name_cache:
            return self._store_name_cache
        if STENOGRAPHER_STORE_NAME:
            self._store_name_cache = STENOGRAPHER_STORE_NAME
            return self._store_name_cache
        service = get_file_search_service()
        display = STENOGRAPHER_STORE_DISPLAY_NAME or "stenographer-store"
        try:
            created = service.create_store(display_name=display)
            self._store_name_cache = created.get("name") or display
        except Exception as exc:  # pragma: no cover - network/permissions
            logger.warning("Unable to create stenographer store; using display name: %s", exc)
            self._store_name_cache = display
        return self._store_name_cache

    def _run_model(self, video_url: str) -> str:
        response = self._client.models.generate_content(
            model=MODEL_NAME,
            contents=[
                types.Content(
                    parts=[
                        types.Part(file_data=types.FileData(file_uri=video_url)),
                        types.Part(text=self._prompt),
                    ]
                )
            ],
            config=types.GenerateContentConfig(
                response_mime_type="text/markdown",
            ),
        )
        text = getattr(response, "text", "") or ""
        if not text.strip():
            raise RuntimeError("Stenographer returned empty response.")
        return text.strip()

    async def __call__(
        self,
        video_url: Optional[str] = None,
        video_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        if not video_id:
            if not video_url:
                return {"status": "error", "error": "Provide either video_id or video_url."}
            video_id = self._extract_video_id(video_url)
        if not video_id:
            return {"status": "error", "error": "Unable to parse video_id from input."}
        if not video_url:
            video_url = f"https://www.youtube.com/watch?v={video_id}"

        video_meta = self._fetch_video_metadata(video_id)
        title = video_meta.get("title") or f"Video {video_id}"
        published_at = video_meta.get("published_at")
        channel_id = video_meta.get("channel_id")

        markdown = self._run_model(video_url)

        store_name = self._ensure_store_name()
        metadata = {
            "video_id": video_id,
            "channel_id": channel_id or "",
            "publication_date": published_at or "",
            "artifact_type": "stenographer",
        }

        fs_service = get_file_search_service()
        upload_result = fs_service.upload_text(
            store_name=store_name,
            content=markdown,
            display_name=title,
            mime_type="text/markdown",
            metadata=metadata,
        )

        return {
            "status": "success",
            "store_name": store_name,
            "document_name": upload_result.get("document_name"),
            "display_name": title,
            "metadata": metadata,
        }


__all__ = ("StenographerTool",)

