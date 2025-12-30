"""Schedule and run playlist-based ingestion + enrichment for channel uploads."""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from typing import Any, Callable, Dict, Iterable, List, Optional, Tuple, Union

from config.settings import BASE_DIR
from memory import (
    get_channel_registry_service,
    get_video_metadata_service,
)
from tools.youtube.client import (
    get_youtube_service,
    redact_request_uri,
    resolve_channel_identifier,
    resolve_uploads_playlist_id,
    execute_request,
)
from tools.youtube.enrich_playlist_videos_tool import EnrichPlaylistVideosTool

logger = logging.getLogger(__name__)

# Type alias for dependency injection in tests.
PlaylistFetchResult = Union[List[Dict[str, Any]], Tuple[List[Dict[str, Any]], Optional[str]]]
PlaylistFetcher = Callable[
    [Any, str, int, str, Optional[str], Optional[Callable[[Optional[str]], None]]],
    PlaylistFetchResult,
]


def _default_playlist_fetcher(
    service,
    playlist_id: str,
    max_items: int,
    label: str,
    start_page_token: Optional[str] = None,
    on_page: Optional[Callable[[Optional[str]], None]] = None,
) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    """Paginate uploads playlist while exposing the next page token."""
    collected: List[Dict[str, Any]] = []
    page_token = start_page_token

    while len(collected) < max_items:
        page_size = min(50, max_items - len(collected))
        request = service.playlistItems().list(
            part="snippet,contentDetails",
            playlistId=playlist_id,
            maxResults=page_size,
            pageToken=page_token,
        )
        sanitized_uri = redact_request_uri(request)
        if sanitized_uri:
            logger.info("YouTube API request (%s): %s", label, sanitized_uri)
        response = execute_request(request, retries=2, label=label)
        items = response.get("items", [])
        collected.extend(items)

        page_token = response.get("nextPageToken")
        if on_page:
            on_page(page_token)
        if not page_token:
            break

    return collected[:max_items], page_token


def _chunked(seq: Iterable[str], size: int) -> Iterable[List[str]]:
    chunk: List[str] = []
    for item in seq:
        chunk.append(item)
        if len(chunk) >= size:
            yield chunk
            chunk = []
    if chunk:
        yield chunk


class PlaylistIngestService:
    """Enqueue and run uploads playlist ingestion, then enrich with video details."""

    def __init__(
        self,
        jobs_db_path: str = "data/playlist_ingest_jobs.json",
        *,
        video_service=None,
        channel_service=None,
        youtube_service=None,
        playlist_fetcher: Optional[PlaylistFetcher] = None,
        enrich_tool: Optional[EnrichPlaylistVideosTool] = None,
    ):
        self.jobs_db_path = BASE_DIR / jobs_db_path
        self.jobs_db_path.parent.mkdir(parents=True, exist_ok=True)

        # Allow dependency injection for tests.
        self._video_service = video_service or get_video_metadata_service()
        self._channel_service = channel_service or get_channel_registry_service()
        self._youtube_service = youtube_service
        self._playlist_fetcher = playlist_fetcher or _default_playlist_fetcher
        self._enrich_tool = enrich_tool or EnrichPlaylistVideosTool()

        self._ensure_db()

    # ---------- Public API ----------
    def enqueue(self, channel_identifier: str, *, max_items: int = 300) -> Dict[str, Any]:
        channel_id = self._resolve_channel_id(channel_identifier)
        playlist_id = self._resolve_playlist_id(channel_id)

        job_id = f"playlist_ingest_{uuid.uuid4().hex}"
        logger.info(
            "Playlist ingest enqueue: channel=%s playlist=%s max_items=%s job_id=%s",
            channel_id,
            playlist_id,
            max_items,
            job_id,
        )
        job = {
            "job_id": job_id,
            "channel_id": channel_id,
            "playlist_id": playlist_id,
            "state": "PENDING",
            "created_at": datetime.utcnow().isoformat(),
            "max_items": max_items,
            "start_page_token": None,
            "next_page_token": None,
            "video_count": 0,
            "enriched_count": 0,
            "error_message": None,
        }
        self._save_job_record(job)
        return job

    def run_job(self, job_id: str) -> Dict[str, Any]:
        jobs = self._load_jobs()
        job = jobs.get(job_id)
        if not job:
            raise ValueError(f"Job {job_id} not found")

        job["state"] = "PROCESSING"
        logger.info(
            "Playlist ingest run: job_id=%s channel=%s playlist=%s max_items=%s",
            job_id,
            job.get("channel_id"),
            job.get("playlist_id"),
            job.get("max_items"),
        )
        self._save_job_record(job)

        try:
            start_token = self._get_channel_next_page_token(job["channel_id"])
            job["start_page_token"] = start_token
            playlist_items, next_page_token = self._fetch_playlist_items(
                job["playlist_id"],
                max_items=job.get("max_items", 1000),
                channel_id=job["channel_id"],
                start_token=start_token,
            )
            job["next_page_token"] = next_page_token
            video_ids = self._upsert_playlist_items(
                playlist_items,
                channel_id=job["channel_id"],
            )
            logger.info(
                "Playlist ingest fetched items: job_id=%s count=%s",
                job_id,
                len(video_ids),
            )
            enriched = self._enrich_and_update(video_ids)

            job["state"] = "COMPLETED"
            job["video_count"] = len(video_ids)
            job["enriched_count"] = enriched
            job["updated_at"] = datetime.utcnow().isoformat()
            logger.info(
                "Playlist ingest completed: job_id=%s videos=%s enriched=%s",
                job_id,
                job["video_count"],
                job["enriched_count"],
            )
        except Exception as exc:  # noqa: BLE001
            logger.exception("Playlist ingest job %s failed", job_id)
            job["state"] = "FAILED"
            job["error_message"] = str(exc)
            job["updated_at"] = datetime.utcnow().isoformat()

        self._save_job_record(job)
        return job

    def enqueue_and_run(self, channel_identifier: str, *, max_items: int = 1000) -> Dict[str, Any]:
        job = self.enqueue(channel_identifier, max_items=max_items)
        return self.run_job(job["job_id"])

    def list_jobs(self) -> List[Dict[str, Any]]:
        jobs = self._load_jobs().values()
        return sorted(jobs, key=lambda j: j.get("created_at", ""), reverse=True)

    # ---------- Internals ----------
    def _resolve_channel_id(self, identifier: str) -> str:
        resolved = resolve_channel_identifier(identifier)
        if resolved:
            return resolved
        if identifier and identifier.startswith("UC"):
            return identifier
        raise ValueError("Unable to resolve channel identifier")

    def _resolve_playlist_id(self, channel_id: str) -> str:
        service = self._youtube_service or get_youtube_service()
        playlist_id = resolve_uploads_playlist_id(channel_id, service=service)
        if not playlist_id:
            raise ValueError(f"Could not resolve uploads playlist for {channel_id}")
        logger.info(
            "Resolved uploads playlist: channel=%s playlist=%s",
            channel_id,
            playlist_id,
        )
        return playlist_id

    def _fetch_playlist_items(
        self,
        playlist_id: str,
        *,
        max_items: int,
        channel_id: str,
        start_token: Optional[str] = None,
    ) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        service = self._youtube_service or get_youtube_service()
        start_token = start_token if start_token is not None else self._get_channel_next_page_token(channel_id)
        logger.info(
            "Fetching playlist items: playlist=%s max_items=%s start_token=%s",
            playlist_id,
            max_items,
            start_token,
        )

        def _on_page(next_token: Optional[str]) -> None:
            self._update_channel_ingest_state(channel_id, next_token)

        try:
            result = self._playlist_fetcher(
                service,
                playlist_id,
                max_items,
                "uploads ingest",
                start_token,
                _on_page,
            )
        except TypeError:
            result = self._playlist_fetcher(
                service,
                playlist_id,
                max_items,
                "uploads ingest",
            )

        items, next_token = self._normalize_fetch_result(result)
        self._update_channel_ingest_state(channel_id, next_token)
        return items, next_token

    def _upsert_playlist_items(self, items: List[Dict[str, Any]], *, channel_id: str) -> List[str]:
        video_ids: List[str] = []
        for item in items:
            snippet = item.get("snippet") or {}
            content_details = item.get("contentDetails") or {}
            video_id = content_details.get("videoId")
            if not video_id:
                continue
            video_ids.append(video_id)

            payload: Dict[str, Any] = {
                "title": snippet.get("title"),
                "published_at": snippet.get("publishedAt"),
                "channel_id": snippet.get("channelId") or channel_id,
                "channel_title": snippet.get("channelTitle"),
                "tags": snippet.get("tags") or [],
            }
            try:
                self._video_service.upsert_metadata(
                    video_id,
                    payload,
                    merge_custom_tags=True,
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to upsert video %s metadata: %s", video_id, exc)

        # Update registry index timestamp if possible.
        if hasattr(self._channel_service, "upsert"):
            try:
                self._channel_service.upsert(
                    channel_id=channel_id,
                    channel_title=items[0].get("snippet", {}).get("channelTitle", "") if items else channel_id,
                    last_indexed_at=datetime.utcnow(),
                )
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to update channel registry after ingest: %s", exc)

        return video_ids

    def _enrich_and_update(self, video_ids: List[str]) -> int:
        enriched_total = 0
        for chunk in _chunked(video_ids, 50):
            try:
                result = self._enrich_tool(video_ids=chunk, order="viewCount")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to enrich chunk %s: %s", chunk, exc)
                continue

            videos = result.get("videos") or []
            logger.info(
                "Enrichment chunk complete: size=%s returned=%s",
                len(chunk),
                len(videos),
            )
            for item in videos:
                video_id = item.get("video_id")
                if not video_id:
                    continue

                updates: Dict[str, Any] = {}
                if item.get("view_count") is not None:
                    updates["view_count"] = item.get("view_count")
                if isinstance(item.get("statistics"), dict) and item["statistics"].get("likeCount") is not None:
                    try:
                        updates["like_count"] = int(item["statistics"]["likeCount"])
                    except (TypeError, ValueError):
                        pass
                if item.get("duration_seconds") is not None:
                    updates["duration_sec"] = item.get("duration_seconds")
                publish_date = item.get("publish_date") or item.get("snippet", {}).get("publishedAt")
                if publish_date:
                    updates["published_at"] = publish_date
                tags = item.get("tags")
                if tags is not None:
                    updates["tags"] = tags

                if updates:
                    try:
                        self._video_service.upsert_metadata(
                            video_id,
                            updates,
                            merge_custom_tags=True,
                        )
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("Failed to update enriched metadata for %s: %s", video_id, exc)
                enriched_total += 1

        return enriched_total

    def _normalize_fetch_result(self, result: PlaylistFetchResult) -> Tuple[List[Dict[str, Any]], Optional[str]]:
        if isinstance(result, tuple) and len(result) == 2 and isinstance(result[0], list):
            return result[0], result[1]
        if isinstance(result, dict):
            return result.get("items", []), result.get("next_page_token")
        return list(result or []), None

    def _get_channel_next_page_token(self, channel_id: str) -> Optional[str]:
        if hasattr(self._channel_service, "get_ingest_state"):
            state = self._channel_service.get_ingest_state(channel_id)
            if state:
                return state.get("uploads_next_page_token")
        if hasattr(self._channel_service, "get"):
            state = self._channel_service.get(channel_id) or {}
            return state.get("uploads_next_page_token")
        return None

    def _update_channel_ingest_state(self, channel_id: str, next_page_token: Optional[str]) -> None:
        timestamp = datetime.utcnow()
        if hasattr(self._channel_service, "update_ingest_state"):
            self._channel_service.update_ingest_state(
                channel_id,
                uploads_next_page_token=next_page_token,
                last_ingested_at=timestamp,
            )
            return
        if hasattr(self._channel_service, "upsert"):
            try:
                self._channel_service.upsert(
                    channel_id=channel_id,
                    channel_title=channel_id,
                    last_indexed_at=timestamp,
                    uploads_next_page_token=next_page_token,
                    uploads_last_ingested_at=timestamp,
                )
            except TypeError:
                self._channel_service.upsert(
                    channel_id=channel_id,
                    channel_title=channel_id,
                    last_indexed_at=timestamp,
                )

    # ---------- Storage helpers ----------
    def _ensure_db(self) -> None:
        if not self.jobs_db_path.exists():
            self.jobs_db_path.write_text("{}", encoding="utf-8")

    def _load_jobs(self) -> Dict[str, Dict[str, Any]]:
        try:
            return json.loads(self.jobs_db_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            logger.warning("Jobs DB %s is malformed; resetting.", self.jobs_db_path)
            return {}

    def _save_job_record(self, job: Dict[str, Any]) -> None:
        jobs = self._load_jobs()
        jobs[job["job_id"]] = job
        self.jobs_db_path.write_text(json.dumps(jobs, indent=2), encoding="utf-8")


__all__ = ["PlaylistIngestService"]
