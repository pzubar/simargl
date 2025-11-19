"""Tools for interacting with Gemini Batch API."""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from google.adk.tools import BaseTool, _automatic_function_calling_util as tool_utils
from pydantic import BaseModel, Field

from services.batch_service import BatchJobService, BatchModeUnavailableError
from tools.transcript_tool import AnalyzeVideoTool
from memory import get_file_search_service

logger = logging.getLogger(__name__)


class SubmitBatchJobInput(BaseModel):
    """Input schema for SubmitBatchJobTool."""

    video_ids: List[str] = Field(description="List of YouTube video IDs to analyze.")
    instructions: str = Field(description="Instructions for the analysis (e.g., 'Analyze sentiment').")
    file_search_store_name: Optional[str] = Field(
        default=None,
        description="Optional File Search store name to ingest results into after completion.",
    )


class SubmitBatchJobTool(BaseTool):
    """Tool to submit a batch analysis job for multiple videos."""

    NAME = "submit_batch_job"
    DESCRIPTION = (
        "Submits a batch job to analyze multiple videos asynchronously. "
        "Use this for bulk requests or to save costs. "
        "Returns a batch_id that can be used to check status later."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )
        self._batch_service = BatchJobService()
        self._transcript_tool = AnalyzeVideoTool()

    @property
    def args_schema(self) -> type[SubmitBatchJobInput]:
        return SubmitBatchJobInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return await self(
            video_ids=args["video_ids"],
            instructions=args["instructions"],
            file_search_store_name=args.get("file_search_store_name"),
        )

    async def __call__(
        self,
        video_ids: List[str],
        instructions: str,
        file_search_store_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Submits a batch job."""
        try:
            video_data = []
            failed_videos = []

            # 1. Fetch transcripts for each video
            # We use AnalyzeVideoTool's internal method to get transcript
            # Note: This part is still synchronous/sequential and might take time for many videos.
            # In a production system, this should be parallelized or also handled via a queue.
            for vid in video_ids:
                try:
                    # Construct a dummy URL for the tool (it extracts ID from it, but we have ID)
                    # Actually AnalyzeVideoTool._generate_transcript takes video_url.
                    # We construct a standard URL.
                    video_url = f"https://www.youtube.com/watch?v={vid}"
                    
                    # We use the "cheap" transcript model defined in the tool
                    transcript_obj = await self._transcript_tool._generate_transcript(
                        video_url=video_url,
                        model_name="gemini-2.5-flash" # Use default cheap model
                    )
                    
                    transcript_text = transcript_obj.full_text
                    full_prompt = f"{instructions}\n\nCONTEXT:\n{transcript_text}"
                    
                    video_data.append({
                        "video_id": vid,
                        "prompt": full_prompt
                    })
                    
                except Exception as e:
                    logger.error(f"Failed to fetch transcript for {vid}: {e}")
                    failed_videos.append(vid)

            if not video_data:
                return {"error": "Failed to fetch transcripts for any of the provided videos."}

            # 2. Submit Batch Job
            batch_id = self._batch_service.create_analysis_job(video_data)
            
            result_msg = f"Batch Job submitted successfully. Batch ID: {batch_id}. "
            if failed_videos:
                result_msg += f"Failed to include videos: {failed_videos}. "
            
            result_msg += "You can check the status later using 'get_batch_results'."
            
            return {
                "batch_id": batch_id,
                "status": "submitted",
                "message": result_msg,
                "video_count": len(video_data),
                "store_name": file_search_store_name # Pass this through if needed for tracking
            }

        except BatchModeUnavailableError:
            return {
                "error": "BATCH_MODE_UNAVAILABLE",
                "message": "The Batch API returned an error (likely Free Tier limit). Please proceed with standard (synchronous) analysis for each video one by one."
            }
        except Exception as e:
            logger.exception("Error submitting batch job")
            return {"error": f"Error submitting batch job: {e}"}


class GetBatchResultsInput(BaseModel):
    """Input schema for GetBatchResultsTool."""
    job_id: str = Field(description="The Batch Job ID to check.")
    file_search_store_name: Optional[str] = Field(
        default=None,
        description="Optional File Search store name to ingest results into.",
    )


class GetBatchResultsTool(BaseTool):
    """Tool to check status and retrieve results of a batch job."""

    NAME = "get_batch_results"
    DESCRIPTION = (
        "Checks the status of a batch job. "
        "If completed, retrieves results and optionally ingests them into File Search."
    )

    def __init__(self) -> None:
        super().__init__(
            name=self.NAME,
            description=self.DESCRIPTION,
        )
        self._batch_service = BatchJobService()

    @property
    def args_schema(self) -> type[GetBatchResultsInput]:
        return GetBatchResultsInput

    def _get_declaration(self):
        declaration = tool_utils.build_function_declaration(
            func=self.args_schema,
            variant=self._api_variant,
        )
        declaration.name = self.NAME
        return declaration

    async def run_async(self, *, args: dict[str, Any], tool_context) -> Dict[str, Any]:
        return await self(
            job_id=args["job_id"],
            file_search_store_name=args.get("file_search_store_name"),
        )

    async def __call__(
        self,
        job_id: str,
        file_search_store_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Checks status and retrieves results."""
        try:
            status = self._batch_service.check_job_status(job_id)
            
            if status.state != "COMPLETED":
                return {
                    "job_id": job_id,
                    "status": status.state,
                    "message": f"Job is currently {status.state}. Please check back later."
                }
            
            # Job is completed, retrieve results
            results = self._batch_service.retrieve_results(job_id)
            
            # Ingest into File Search if requested
            ingestion_count = 0
            if file_search_store_name:
                fs_service = get_file_search_service()
                for res in results:
                    video_id = res["video_id"]
                    analysis_text = res["analysis"]
                    
                    if analysis_text and analysis_text != "No content":
                        display_name = f"Batch Analysis {video_id}"
                        fs_service.upload_text(
                            store_name=file_search_store_name,
                            content=analysis_text,
                            display_name=display_name,
                            metadata={"video_id": video_id, "artifact_type": "batch_analysis"}
                        )
                        ingestion_count += 1

            return {
                "job_id": job_id,
                "status": "COMPLETED",
                "results_count": len(results),
                "ingested_count": ingestion_count,
                "results_preview": results[:2], # Show first 2 results as preview
                "message": "Job completed and results processed."
            }

        except Exception as e:
            logger.exception(f"Error getting batch results for {job_id}")
            return {"error": f"Error getting batch results: {e}"}
