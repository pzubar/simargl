"""Gemini API-based video understanding tool for YouTube videos."""

from __future__ import annotations

import asyncio
import json
import logging
import math
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types
from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

from config.settings import (
    BASE_DIR,
    DEFAULT_GEMINI_MODEL,
    GEMINI_MODEL_PREMIUM,
)
from memory import get_file_search_service

logger = logging.getLogger(__name__)

# Max video duration (in seconds) to process in a single API call.
# The 1M token context (e.g., gemini-2.5-flash) supports ~1 hour (3600s).
# We set a safer limit to account for prompts and response tokens.
MAX_CHUNK_DURATION_SECONDS = 3500

# Local storage directory for video artifacts
ARTIFACTS_BASE_DIR = BASE_DIR / "data" / "video_artifacts"


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

    video_url: str = Field(description="The full YouTube video URL.")
    video_duration_seconds: int = Field(
        description="Total video duration in seconds (from GetVideoDetailsTool)."
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
    analysis_model: str = Field(
        default=GEMINI_MODEL_PREMIUM,
        description="The Gemini model to use for detailed analysis (premium model).",
    )


class AnalyzeVideoTool(BaseTool):
    """
    Analyzes YouTube videos using Gemini API's Video Understanding feature.
    
    This tool performs two separate operations:
    1. Transcript generation: Uses a cheap model with YouTube URL only (no video data)
    2. Detailed analysis: Uses a premium model with video data for visual/emotional analysis
    
    Automatically handles chunking for long videos and stores results locally.
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
            self._client = genai.Client()
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

    def _get_artifacts_dir(self, video_id: str) -> Path:
        """Get the artifacts directory for a video."""
        artifacts_dir = ARTIFACTS_BASE_DIR / video_id
        artifacts_dir.mkdir(parents=True, exist_ok=True)
        return artifacts_dir

    def _save_chunk_result(
        self, video_id: str, chunk_index: int, start_time: int, end_time: int, data: Dict[str, Any]
    ) -> Path:
        """Save chunk result to local storage."""
        artifacts_dir = self._get_artifacts_dir(video_id)
        chunks_dir = artifacts_dir / "chunks"
        chunks_dir.mkdir(exist_ok=True)
        chunk_file = chunks_dir / f"chunk_{chunk_index}.json"
        chunk_data = {
            "chunk_index": chunk_index,
            "start_time": start_time,
            "end_time": end_time,
            **data,
        }
        with chunk_file.open("w", encoding="utf-8") as f:
            json.dump(chunk_data, f, ensure_ascii=False, indent=2)
        return chunk_file

    def _save_artifact(self, video_id: str, artifact_type: str, data: Dict[str, Any]) -> Path:
        """Save artifact to local storage."""
        artifacts_dir = self._get_artifacts_dir(video_id)
        artifact_file = artifacts_dir / f"{artifact_type}.json"
        with artifact_file.open("w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return artifact_file

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
                model=f"models/{model_name}",
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
                model=f"models/{model_name}",
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

    async def _process_chunk(
        self,
        video_url: str,
        video_id: str,
        chunk_index: int,
        start_time: int,
        end_time: int,
        transcript_model: str,
        analysis_model: str,
    ) -> Dict[str, Any]:
        """Process a single chunk of the video."""
        logger.info(
            f"Processing chunk {chunk_index} for video {video_id}: {start_time}s-{end_time}s"
        )

        try:
            # Generate transcript for this chunk (without video data)
            transcript = await self._generate_transcript(video_url, transcript_model)
            
            # Generate analysis for this chunk (with video data)
            analysis = await self._generate_analysis(
                video_url, analysis_model, start_time, end_time
            )

            chunk_result = {
                "transcript": transcript.model_dump(),
                "analysis": analysis.model_dump(),
            }

            # Save chunk result locally
            self._save_chunk_result(video_id, chunk_index, start_time, end_time, chunk_result)

            return chunk_result
        except Exception as e:
            logger.error(f"Failed to process chunk {chunk_index}: {e}")
            return {
                "error": str(e),
                "chunk_index": chunk_index,
                "start_time": start_time,
                "end_time": end_time,
            }

    async def run_async(
        self, *, args: dict[str, Any], tool_context
    ) -> Dict[str, Any]:
        return await self(
            video_url=args["video_url"],
            video_duration_seconds=args["video_duration_seconds"],
            video_id=args.get("video_id"),
            channel_id=args.get("channel_id"),
            video_title=args.get("video_title"),
            file_search_store_name=args.get("file_search_store_name"),
            transcript_model=args.get("transcript_model", DEFAULT_GEMINI_MODEL),
            analysis_model=args.get("analysis_model", GEMINI_MODEL_PREMIUM),
        )

    async def __call__(
        self,
        video_url: str,
        video_duration_seconds: int,
        video_id: Optional[str] = None,
        channel_id: Optional[str] = None,
        video_title: Optional[str] = None,
        file_search_store_name: Optional[str] = None,
        transcript_model: str = DEFAULT_GEMINI_MODEL,
        analysis_model: str = GEMINI_MODEL_PREMIUM,
    ) -> Dict[str, Any]:
        """Analyze video and return transcript and analysis."""
        try:
            # Extract video ID if not provided
            if not video_id:
                video_id = self._extract_video_id(video_url)
                if not video_id:
                    return {
                        "error": "Could not extract video ID from URL",
                        "video_url": video_url,
                    }

            # Determine if chunking is needed
            needs_chunking = video_duration_seconds > MAX_CHUNK_DURATION_SECONDS

            if not needs_chunking:
                # Process entire video in one go
                logger.info(f"Processing video {video_id} as single request (duration: {video_duration_seconds}s)")

                # Generate transcript (without video data)
                transcript = await self._generate_transcript(video_url, transcript_model)
                
                # Generate analysis (with video data)
                analysis = await self._generate_analysis(video_url, analysis_model)

                # Save artifacts locally
                self._save_artifact(video_id, "transcript", transcript.model_dump())
                self._save_artifact(video_id, "analysis", analysis.model_dump())

                result = {
                    "video_id": video_id,
                    "video_url": video_url,
                    "transcript": transcript.model_dump(),
                    "analysis": analysis.model_dump(),
                    "chunks_processed": 1,
                    "status": "success",
                }

            else:
                # Process video in chunks
                logger.info(
                    f"Video {video_id} is long ({video_duration_seconds}s). Initiating chunking."
                )

                num_chunks = math.ceil(video_duration_seconds / MAX_CHUNK_DURATION_SECONDS)
                tasks = []

                for i in range(num_chunks):
                    start_time = i * MAX_CHUNK_DURATION_SECONDS
                    end_time = min((i + 1) * MAX_CHUNK_DURATION_SECONDS, video_duration_seconds)
                    tasks.append(
                        self._process_chunk(
                            video_url,
                            video_id,
                            i,
                            start_time,
                            end_time,
                            transcript_model,
                            analysis_model,
                        )
                    )

                # Process all chunks concurrently
                chunk_results = await asyncio.gather(*tasks)

                # Combine results
                all_transcript_segments = []
                all_visual_descriptions = []
                all_emotions = []
                all_key_moments = []
                all_summaries = []

                for chunk_result in chunk_results:
                    if "error" not in chunk_result:
                        chunk_transcript = chunk_result.get("transcript", {})
                        chunk_analysis = chunk_result.get("analysis", {})

                        # Collect transcript segments
                        if "segments" in chunk_transcript:
                            all_transcript_segments.extend(chunk_transcript["segments"])
                        if "full_text" in chunk_transcript:
                            all_summaries.append(f"Chunk transcript: {chunk_transcript['full_text']}")

                        # Collect analysis components
                        if "visual_descriptions" in chunk_analysis:
                            all_visual_descriptions.extend(chunk_analysis["visual_descriptions"])
                        if "emotions" in chunk_analysis:
                            all_emotions.extend(chunk_analysis["emotions"])
                        if "key_moments" in chunk_analysis:
                            all_key_moments.extend(chunk_analysis["key_moments"])
                        if "summary" in chunk_analysis:
                            all_summaries.append(f"Chunk analysis: {chunk_analysis['summary']}")

                # Create combined results
                combined_transcript = VideoTranscript(
                    full_text="\n\n".join(all_summaries),
                    segments=all_transcript_segments,
                )

                # Determine overall sentiment (most common from chunks)
                sentiments = [
                    chunk_result.get("analysis", {}).get("sentiment", "neutral")
                    for chunk_result in chunk_results
                    if "error" not in chunk_result
                ]
                overall_sentiment = max(set(sentiments), key=sentiments.count) if sentiments else "neutral"

                combined_analysis = VideoAnalysis(
                    summary="\n\n".join(all_summaries),
                    visual_descriptions=all_visual_descriptions,
                    emotions=all_emotions,
                    sentiment=overall_sentiment,
                    key_moments=all_key_moments,
                )

                # Save combined artifacts locally
                self._save_artifact(video_id, "transcript", combined_transcript.model_dump())
                self._save_artifact(video_id, "analysis", combined_analysis.model_dump())

                result = {
                    "video_id": video_id,
                    "video_url": video_url,
                    "transcript": combined_transcript.model_dump(),
                    "analysis": combined_analysis.model_dump(),
                    "chunks_processed": num_chunks,
                    "chunk_results": chunk_results,
                    "status": "success_chunked",
                }

            # Optionally upload to File Search
            if file_search_store_name:
                ingestion_results = self._ingest_into_file_search(
                    store_name=file_search_store_name,
                    video_id=video_id,
                    channel_id=channel_id,
                    video_title=video_title,
                    transcript=result.get("transcript", {}),
                    analysis=result.get("analysis", {}),
                )
                if ingestion_results:
                    result["file_search_documents"] = ingestion_results

            return result

        except Exception as exc:  # noqa: BLE001
            logger.exception(f"Error analyzing video {video_url}")
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
