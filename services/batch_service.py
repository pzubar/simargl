import json
import logging
import time
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from google import genai
from google.genai import types
from pydantic import BaseModel

from config.settings import BASE_DIR

# Configure logging
logger = logging.getLogger(__name__)

class BatchJobStatus(BaseModel):
    job_id: str
    state: str  # "ACTIVE", "COMPLETED", "FAILED", "CANCELLED"
    created_at: str
    video_ids: List[str]
    output_file_uri: Optional[str] = None
    error_message: Optional[str] = None

class BatchModeUnavailableError(Exception):
    """Raised when Batch API is not available (e.g., Free Tier restrictions)."""
    pass

class BatchJobService:
    def __init__(self, jobs_db_path: str = "data/jobs.json"):
        self.client = genai.Client()
        self.jobs_db_path = BASE_DIR / jobs_db_path
        self._ensure_db()

    def _ensure_db(self):
        if not self.jobs_db_path.parent.exists():
            self.jobs_db_path.parent.mkdir(parents=True, exist_ok=True)
        if not self.jobs_db_path.exists():
            self.jobs_db_path.write_text("{}")

    def _load_jobs(self) -> Dict[str, dict]:
        try:
            return json.loads(self.jobs_db_path.read_text())
        except json.JSONDecodeError:
            return {}

    def _save_job_record(self, job: BatchJobStatus):
        jobs = self._load_jobs()
        jobs[job.job_id] = job.model_dump()
        self.jobs_db_path.write_text(json.dumps(jobs, indent=2))

    def create_analysis_job(
        self, 
        video_data_list: List[Dict[str, Any]], 
        model_name: str = "gemini-1.5-flash-001"
    ) -> str:
        """
        Creates a Batch Job for multiple videos.
        
        Args:
            video_data_list: List of dicts, each containing 'video_id' and the prompt/transcript.
            model_name: Gemini model to use.
            
        Returns:
            batch_job_id (str)
            
        Raises:
            BatchModeUnavailableError: If API call fails (likely due to tier limits).
        """
        
        # 1. Prepare JSONL file for Batch API
        # Each line must be a valid JSON request for model.generate_content
        batch_input_filename = f"batch_input_{uuid.uuid4().hex}.jsonl"
        batch_input_path = Path(f"/tmp/{batch_input_filename}") # Use temp dir suitable for your OS
        
        requests = []
        video_ids_map = []
        
        for item in video_data_list:
            video_id = item["video_id"]
            # Assuming item["prompt"] contains the full context (transcript + instructions)
            prompt_text = item.get("prompt", "")
            
            # Construct the request object compliant with Google GenAI Batch format
            # Note: The structure depends on the specific SDK version capabilities, 
            # here we emulate the standard GenerateContentRequest structure.
            request_entry = {
                "request": {
                    "contents": [
                        {"role": "user", "parts": [{"text": prompt_text}]}
                    ],
                    "generationConfig": {
                        "temperature": 0.2,
                        "maxOutputTokens": 2000, # Adjust as needed
                    }
                }
            }
            requests.append(json.dumps(request_entry))
            video_ids_map.append(video_id)

        batch_input_path.write_text("\n".join(requests))

        try:
            # 2. Upload file to Gemini File API
            logger.info(f"Uploading batch file: {batch_input_filename}")
            batch_file = self.client.files.upload(
                file=batch_input_path,
                config={'display_name': batch_input_filename}
            )
            
            # Wait for file to be processed (ACTIVE state)
            while batch_file.state.name == "PROCESSING":
                time.sleep(2)
                batch_file = self.client.files.get(name=batch_file.name)
                
            if batch_file.state.name != "ACTIVE":
                 raise Exception(f"File upload failed with state: {batch_file.state.name}")

            # 3. Submit Batch Job
            logger.info(f"Submitting batch job with file: {batch_file.name}")
            
            # This is the critical call that might fail on Free Tier
            batch_job = self.client.batches.create(
                model=model_name,
                src=batch_file.name,
                config=types.CreateBatchJobConfig(
                    display_name=f"simargl_analysis_{datetime.now().strftime('%Y%m%d_%H%M')}"
                )
            )
            
            # 4. Save local record
            job_record = BatchJobStatus(
                job_id=batch_job.name, # Usually resource name like "projects/.../locations/.../batches/..."
                state="PENDING", # Initial state
                created_at=datetime.now().isoformat(),
                video_ids=video_ids_map
            )
            self._save_job_record(job_record)
            
            # Cleanup local file
            if batch_input_path.exists():
                batch_input_path.unlink()
                
            return batch_job.name

        except Exception as e:
            logger.error(f"Batch creation failed: {e}")
            # Check for typical error codes for tier limits (403, 429, or Quota Exceeded)
            error_str = str(e).lower()
            if "403" in error_str or "permission denied" in error_str or "quota" in error_str:
                raise BatchModeUnavailableError(
                    "Batch API unavailable. This is likely due to Free Tier limitations or disabled billing."
                ) from e
            raise e

    def check_job_status(self, job_id: str) -> BatchJobStatus:
        """Checks remote status and updates local DB."""
        try:
            remote_job = self.client.batches.get(name=job_id)
            
            # Update local record
            jobs = self._load_jobs()
            if job_id in jobs:
                current_record = BatchJobStatus(**jobs[job_id])
                current_record.state = remote_job.state.name
                
                if remote_job.state.name == "COMPLETED" and hasattr(remote_job, "output_file"):
                     current_record.output_file_uri = remote_job.output_file
                
                if hasattr(remote_job, "error") and remote_job.error:
                    current_record.error_message = str(remote_job.error)
                    
                self._save_job_record(current_record)
                return current_record
            else:
                # Handle case where job exists remotely but not locally (optional)
                return BatchJobStatus(
                    job_id=job_id,
                    state=remote_job.state.name,
                    created_at=datetime.now().isoformat(),
                    video_ids=[]
                )
        except Exception as e:
            logger.error(f"Failed to check job status: {e}")
            raise

    def retrieve_results(self, job_id: str) -> List[Dict[str, Any]]:
        """
        Downloads results for a COMPLETED job.
        Returns a list of results paired with original video_ids.
        """
        status = self.check_job_status(job_id)
        if status.state != "COMPLETED":
            raise ValueError(f"Job {job_id} is not completed. Current state: {status.state}")
            
        if not status.output_file_uri:
            raise ValueError("Job is completed but has no output file URI.")

        # Download the output file content
        # Gemini SDK might retrieve content via files.get_content logic or direct HTTP
        # For SDK v1:
        output_content = self.client.files.get_content(name=status.output_file_uri)
        # output_content is usually bytes or string of JSONL
        
        results = []
        lines = output_content.decode('utf-8').strip().split('\n')
        
        # We need to map results back to video_ids.
        # WARNING: Batch API usually preserves order, but it's safer if we had included
        # a custom ID in the request metadata. Since standard GenerateContent doesn't 
        # easily support pass-through IDs in the response body, we rely on order here
        # assuming 1:1 mapping with the stored video_ids list.
        
        for i, line in enumerate(lines):
            try:
                response_dict = json.loads(line)
                # Parse the standard Gemini response structure
                # Note: The response structure in file might differ slightly (e.g. wrapped in "response")
                
                analysis_text = "No content"
                if "response" in response_dict and "candidates" in response_dict["response"]:
                     candidates = response_dict["response"]["candidates"]
                     if candidates and "content" in candidates[0]:
                         parts = candidates[0]["content"]["parts"]
                         analysis_text = "".join([p.get("text", "") for p in parts])
                
                video_id = status.video_ids[i] if i < len(status.video_ids) else "unknown"
                
                results.append({
                    "video_id": video_id,
                    "analysis": analysis_text
                })
            except Exception as e:
                logger.error(f"Error parsing result line {i}: {e}")
                
        return results
