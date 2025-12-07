"""Gemini API-based video understanding tool for YouTube videos."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types
from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

from config.settings import (
    BASE_DIR,
    DEFAULT_GEMINI_MODEL,
    YOUTUBE_API_KEY, # Import API Key
)
from googleapiclient.discovery import build # Import build
from memory import get_file_search_service


logger = logging.getLogger(__name__)

# Local storage directory for video artifacts
ARTIFACTS_BASE_DIR = BASE_DIR / "data" / "video_artifacts"

FILE_POLL_INTERVAL_SECONDS = 1.0
FILE_POLL_TIMEOUT_SECONDS = 120.0


class TranscriptSegment(BaseModel):
    """A single segment of the transcript with timestamp."""

    text: str = Field(description="The transcript text for this segment.")
    start_time: float = Field(description="Start time in seconds.")
    end_time: Optional[float] = Field(
        default=None, description="End time in seconds (if available)."
    )


class VideoTranscript(BaseModel):
    """Structured transcript output from Gemini API."""

    full_text: str = Field(description="The complete transcript text.")
    segments: List[TranscriptSegment] = Field(
        default_factory=list,
        description="List of transcript segments with timestamps.",
    )
    language: Optional[str] = Field(
        default=None, description="Detected language of the transcript."
    )


class EmotionAnalysis(BaseModel):
    """Emotion detected at a specific moment."""

    emotion: str = Field(description="The emotion detected (e.g., 'joy', 'sadness', 'anger').")
    timestamp: float = Field(description="Timestamp in seconds where this emotion occurs.")
    confidence: Optional[float] = Field(
        default=None, description="Confidence score if available."
    )


class KeyMoment(BaseModel):
    """A key moment or event in the video."""

    timestamp: float = Field(description="Timestamp in seconds.")
    description: str = Field(description="Description of what happens at this moment.")
    importance: Optional[str] = Field(
        default=None, description="Importance level (e.g., 'high', 'medium', 'low')."
    )


class VisualDescription(BaseModel):
    """Visual description at a specific timestamp."""

    timestamp: float = Field(description="Timestamp in seconds.")
    description: str = Field(description="Description of what is visible at this moment.")
    objects: Optional[List[str]] = Field(
        default=None, description="List of objects detected in the scene."
    )


class VideoAnalysis(BaseModel):
    """Structured analysis output from Gemini API."""

    summary: str = Field(description="Comprehensive summary of the video content.")
    visual_descriptions: List[VisualDescription] = Field(
        default_factory=list,
        description="Visual descriptions at key timestamps.",
    )
    emotions: List[EmotionAnalysis] = Field(
        default_factory=list, description="Emotions detected throughout the video."
    )
    sentiment: str = Field(
        description="Overall sentiment of the video (e.g., 'positive', 'negative', 'neutral')."
    )
    key_moments: List[KeyMoment] = Field(
        default_factory=list, description="Key moments or events in the video."
    )
    topics: Optional[List[str]] = Field(
        default=None, description="Main topics or themes discussed."
    )


class AnalyzeVideoInput(BaseModel):
    """Input schema for AnalyzeVideoTool."""

    video_url: Optional[str] = Field(
        default=None, description="The full YouTube video URL (optional if video_id provided)."
    )
    video_duration_seconds: Optional[int] = Field(
        default=None,
        description="Total video duration in seconds. Optional; tool will fetch if missing.",
    )
    video_id: Optional[str] = Field(
        default=None, description="YouTube video ID (extracted from URL if not provided)."
    )
    channel_id: Optional[str] = Field(
        default=None,
        description="Optional channel ID for storing metadata in downstream services.",
    )
    video_title: Optional[str] = Field(
        default=None,
        description="Optional friendly name for the video. Used when storing in File Search.",
    )
    file_search_store_name: Optional[str] = Field(
        default=None,
        description="Optional Gemini File Search store name to ingest the artifacts automatically.",
    )
    transcript_model: str = Field(
        default=DEFAULT_GEMINI_MODEL,
        description="The Gemini model to use for transcript generation (cheap model).",
    )


class AnalyzeVideoTool(BaseTool):
    """
    Generates a YouTube transcript with Gemini, uploads it to Gemini Files,
    and returns a file_uri reference instead of raw text to avoid context bloat.
    """

    NAME = "analyze_video"
    DESCRIPTION = (
        "Analyzes a YouTube video (audio+visual) by its URL. "
        "Generates transcript and detailed summary with visual descriptions, emotions, and sentiment. "
        "Automatically chunks long videos. Stores artifacts locally and optionally in File Search."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )
        self._client = None

    def _get_client(self):
        """Get or create Gemini client."""
        if self._client is None:
            self._client = genai.Client(vertexai=False)
        return self._client

    @property
    def args_schema(self) -> type[AnalyzeVideoInput]:
        return AnalyzeVideoInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    def _extract_video_id(self, video_url: str) -> Optional[str]:
        """Extract video ID from YouTube URL."""
        try:
            if "youtube.com/watch?v=" in video_url:
                return video_url.split("youtube.com/watch?v=")[1].split("&")[0]
            elif "youtu.be/" in video_url:
                return video_url.split("youtu.be/")[1].split("?")[0]
        except Exception:
            pass
        return None

    def _get_video_details_from_api(self, video_id: str) -> int:
        """Fetch video duration from YouTube API."""
        try:
            service = build("youtube", "v3", developerKey=YOUTUBE_API_KEY, cache_discovery=False)
            request = service.videos().list(part="contentDetails", id=video_id)
            response = request.execute()
            items = response.get("items", [])
            if not items:
                return 0
            
            duration_iso = items[0]["contentDetails"]["duration"]
            # Minimal parser for PT#H#M#S
            import re
            pattern = r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?"
            match = re.match(pattern, duration_iso)
            if not match:
                return 0
            hours = int(match.group(1) or 0)
            minutes = int(match.group(2) or 0)
            seconds = int(match.group(3) or 0)
            return hours * 3600 + minutes * 60 + seconds
        except Exception as e:
            logger.error(f"Failed to fetch video details for {video_id}: {e}")
            return 0

    def _get_artifacts_dir(self, video_id: str) -> Path:
        """Get the artifacts directory for a video."""
        artifacts_dir = ARTIFACTS_BASE_DIR / video_id
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        return artifacts_dir


    def _save_artifact(self, video_id: str, artifact_type: str, data: Dict[str, Any]) -> Path:
        """Save artifact to local storage."""
        artifacts_dir = self._get_artifacts_dir(video_id)
        artifact_file = artifacts_dir / f"{artifact_type}.json"
        with artifact_file.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return artifact_file

    def _wait_for_file_active(self, file_name: str) -> str:
        """Poll Gemini Files until the upload is ACTIVE or times out."""
        client = self._get_client()
        deadline = time.time() + FILE_POLL_TIMEOUT_SECONDS
        current = client.files.get(name=file_name)
        while current.state not in {"ACTIVE", "FAILED"} and time.time() < deadline:
            time.sleep(FILE_POLL_INTERVAL_SECONDS)
            current = client.files.get(name=file_name)
        if current.state != "ACTIVE":
            raise RuntimeError(f"Transcript upload did not become ACTIVE (state={current.state})")
        return current.uri

    def _upload_transcript_text(
        self,
        *,
        transcript_text: str,
        video_id: str,
        video_title: Optional[str],
    ) -> str:
        """Persist transcript text to Gemini Files and return a file_uri."""
        client = self._get_client()
        temp_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w",
                suffix=".txt",
                delete=False,
                encoding="utf-8",
            ) as tmp:
                tmp.write(transcript_text)
                tmp.flush()
                temp_path = tmp.name
            display_name = video_title or f"Transcript {video_id}"
            # Gemini API backend does not support display_name; upload with file only.
            upload = client.files.upload(file=temp_path)
            return self._wait_for_file_active(upload.name)
        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    logger.debug("Temporary transcript file already removed: %s", temp_path)

    async def _generate_transcript(
        self, video_url: str, model_name: str
    ) -> VideoTranscript:
        """
        Generate transcript using cheap model without video data.
        Only sends YouTube URL + text prompt to save tokens.
        """
        client = self._get_client()
        prompt = (
            "Transcribe the audio from this YouTube video. "
            "Provide a complete transcript with timestamps for each segment. "
            "Return the transcript in a structured format with segments containing text, start_time, and end_time."
        )

        try:
            # For transcript, we only send the URL (no video data) to save tokens
            # Use asyncio.to_thread to run synchronous generate_content in async context
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model_name,
                contents=[
                    types.Content(
                        parts=[
                            types.Part(
                                file_data=types.FileData(file_uri=video_url)
                            ),
                            types.Part(text=prompt),
                        ]
                    )
                ],
                config=types.GenerateContentConfig(
                    response_mime_type="text/plain",
                    response_schema=VideoTranscript.model_json_schema(),
                ),
            )

            # Parse structured response
            if hasattr(response, "text"):
                # Try to parse JSON from text response
                try:
                    parsed = json.loads(response.text)
                    return VideoTranscript(**parsed)
                except (json.JSONDecodeError, ValueError):
                    # Fallback: create transcript from text
                    return VideoTranscript(
                        full_text=response.text,
                        segments=[],
                    )
            else:
                raise ValueError("No text in response")

        except Exception as e:
            logger.error(f"Error generating transcript: {e}")
            raise

    async def _generate_analysis(
        self, video_url: str, model_name: str, start_time: Optional[int] = None, end_time: Optional[int] = None
    ) -> VideoAnalysis:
        """
        Generate detailed analysis using premium model with video data.
        Includes visual descriptions, emotions, sentiment, and key moments.
        """
        client = self._get_client()
        prompt = (
            "Analyze this YouTube video comprehensively. Provide:\n"
            "1. A detailed summary of the content\n"
            "2. Visual descriptions at key timestamps (what is visible on screen)\n"
            "3. Emotions detected throughout the video with timestamps\n"
            "4. Overall sentiment (positive, negative, or neutral)\n"
            "5. Key moments or events with timestamps\n"
            "6. Main topics or themes discussed\n\n"
            "Be thorough and include specific timestamps for visual descriptions, emotions, and key moments."
        )

        try:
            # Build video part with optional metadata for chunking
            video_part = types.Part(
                file_data=types.FileData(file_uri=video_url),
            )
            
            # Add video metadata for chunking if specified
            if start_time is not None and end_time is not None:
                video_part.video_metadata = types.VideoMetadata(
                    start_offset=f"{start_time}s",
                    end_offset=f"{end_time}s",
                )
                prompt = f"This is a segment from {start_time}s to {end_time}s of a longer video.\n\n{prompt}"

            # Use asyncio.to_thread to run synchronous generate_content in async context
            response = await asyncio.to_thread(
                client.models.generate_content,
                model=model_name,
                contents=[
                    types.Content(
                        parts=[
                            video_part,
                            types.Part(text=prompt),
                        ]
                    )
                ],
                config=types.GenerateContentConfig(
                    response_schema=VideoAnalysis.model_json_schema(),
                ),
            )

            # Parse structured response
            if hasattr(response, "text"):
                try:
                    parsed = json.loads(response.text)
                    return VideoAnalysis(**parsed)
                except (json.JSONDecodeError, ValueError) as e:
                    logger.warning(f"Failed to parse structured response: {e}")
                    # Fallback: create basic analysis from text
                    return VideoAnalysis(
                        summary=response.text,
                        sentiment="neutral",
                        visual_descriptions=[],
                        emotions=[],
                        key_moments=[],
                    )
            else:
                raise ValueError("No text in response")

        except Exception as e:
            logger.error(f"Error generating analysis: {e}")
            raise

    async def run_async(
        self, *, args: dict[str, Any], tool_context
    ) -> Dict[str, Any]:
        return await self(
            video_url=args.get("video_url"),
            video_duration_seconds=args.get("video_duration_seconds"),
            video_id=args.get("video_id"),
            channel_id=args.get("channel_id"),
            video_title=args.get("video_title"),
            file_search_store_name=args.get("file_search_store_name"),
            transcript_model=args.get("transcript_model", DEFAULT_GEMINI_MODEL),
        )

    async def __call__(
        self,
        video_url: Optional[str] = None,
        video_duration_seconds: Optional[int] = None,  # Kept for signature compatibility
        video_id: Optional[str] = None,
        channel_id: Optional[str] = None,
        video_title: Optional[str] = None,
        file_search_store_name: Optional[str] = None,
        transcript_model: str = DEFAULT_GEMINI_MODEL,
    ) -> Dict[str, Any]:
        """Fetch a video transcript, upload it to Gemini Files, and return a file reference."""
        try:
            if not video_id:
                if video_url:
                    video_id = self._extract_video_id(video_url)
                if not video_id:
                    return {
                        "error": "Video ID is required. Provide either video_id or a valid video_url.",
                        "status": "error",
                    }

            if not video_url:
                video_url = f"https://www.youtube.com/watch?v={video_id}"

            logger.info("Generating transcript for %s using model %s", video_id, transcript_model)
            transcript = await self._generate_transcript(video_url, transcript_model)

            transcript_payload = transcript.model_dump()
            transcript_text = transcript_payload.get("full_text") or ""
            if not transcript_text and transcript_payload.get("segments"):
                transcript_text = "\n".join(
                    segment.get("text", "") for segment in transcript_payload.get("segments", [])
                )

            if not transcript_text:
                return {
                    "status": "error",
                    "video_id": video_id,
                    "error": "Transcript text was empty after generation.",
                }

            # Persist transcript locally for debugging/auditing.
            self._save_artifact(video_id, "transcript", transcript_payload)

            file_uri = self._upload_transcript_text(
                transcript_text=transcript_text,
                video_id=video_id,
                video_title=video_title,
            )

            result: Dict[str, Any] = {
                "status": "success",
                "video_id": video_id,
                "video_url": video_url,
                "file_uri": file_uri,
                "usage_instruction": "Pass this file_uri to the analysis_tool.",
            }

            if file_search_store_name:
                ingestion_results = self._ingest_into_file_search(
                    store_name=file_search_store_name,
                    video_id=video_id,
                    channel_id=channel_id,
                    video_title=video_title,
                    transcript={"full_text": transcript_text},
                    analysis={},
                )
                if ingestion_results:
                    result["file_search_documents"] = ingestion_results

            return result

        except Exception as exc:  # noqa: BLE001
            logger.exception("Error fetching transcript for %s", video_url)
            return {
                "error": str(exc),
                "video_url": video_url,
                "status": "error",
            }

    def _ingest_into_file_search(
        self,
        *,
        store_name: str,
        video_id: str,
        channel_id: Optional[str],
        video_title: Optional[str],
        transcript: Dict[str, Any],
        analysis: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        """Upload transcript and analysis to File Search store."""
        try:
            service = get_file_search_service()
            results = {}

            # Upload transcript
            transcript_text = transcript.get("full_text", "")
            if transcript_text:
                metadata = {
                    "video_id": video_id,
                    "artifact_type": "transcript",
                }
                if channel_id:
                    metadata["channel_id"] = channel_id
                display_name = (video_title or f"Transcript {video_id}") + " - Transcript"
                doc_result = service.upload_text(
                    store_name=store_name,
                    content=transcript_text,
                    display_name=display_name,
                    metadata=metadata,
                )
                if doc_result:
                    results["transcript"] = doc_result

            # Upload analysis
            analysis_text = analysis.get("summary", "")
            if analysis_text:
                # Include visual descriptions, emotions, and key moments in the text
                analysis_parts = [analysis_text]
                if analysis.get("visual_descriptions"):
                    analysis_parts.append("\n\nVisual Descriptions:")
                    for vd in analysis["visual_descriptions"]:
                        analysis_parts.append(f"  [{vd.get('timestamp', 0)}s] {vd.get('description', '')}")
                if analysis.get("emotions"):
                    analysis_parts.append("\n\nEmotions:")
                    for em in analysis["emotions"]:
                        analysis_parts.append(f"  [{em.get('timestamp', 0)}s] {em.get('emotion', '')}")
                if analysis.get("key_moments"):
                    analysis_parts.append("\n\nKey Moments:")
                    for km in analysis["key_moments"]:
                        analysis_parts.append(f"  [{km.get('timestamp', 0)}s] {km.get('description', '')}")

                metadata = {
                    "video_id": video_id,
                    "artifact_type": "analysis",
                }
                if channel_id:
                    metadata["channel_id"] = channel_id
                display_name = (video_title or f"Analysis {video_id}") + " - Analysis"
                doc_result = service.upload_text(
                    store_name=store_name,
                    content="\n\n".join(analysis_parts),
                    display_name=display_name,
                    metadata=metadata,
                )
                if doc_result:
                    results["analysis"] = doc_result

            return results if results else None

        except Exception as exc:  # noqa: BLE001
            logger.warning(
                f"Failed to ingest artifacts for {video_id} into File Search store {store_name}: {exc}"
            )
            return None


__all__ = ("AnalyzeVideoTool",)
