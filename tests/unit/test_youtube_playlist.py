from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import TestCase
from unittest.mock import MagicMock, patch

from channel_registry.registry import ChannelRegistry
from tools.youtube.client import resolve_uploads_playlist_id
from services.playlist_ingest_service import PlaylistIngestService
from tools.youtube.search_tool import _collect_playlist_items, _parse_rfc3339


class _Request:
    def __init__(self, response):
        self._response = response
        self.uri = "http://example.test"

    def execute(self, num_retries: int = 0):
        return self._response


class _FakePlaylistItemsService:
    def __init__(self, responses):
        self._responses = responses

    def list(self, **kwargs):
        page_token = kwargs.get("pageToken")
        if page_token is None:
            return _Request(self._responses[0])
        return _Request(self._responses[1])


class _FakeVideosService:
    def list(self, **kwargs):
        return _Request({})


class _FakeYouTubeService:
    def __init__(self, playlist_responses):
        self._playlist_items = _FakePlaylistItemsService(playlist_responses)
        self._channels = MagicMock()
        self._videos = _FakeVideosService()

    def playlistItems(self):
        return self._playlist_items

    def channels(self):
        return self._channels

    def videos(self):
        return self._videos


class ResolveUploadsPlaylistIdTest(TestCase):
    def test_resolves_and_caches_playlist_id(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            registry = ChannelRegistry(str(Path(tmp_dir) / "registry.json"))
            mock_service = MagicMock()
            mock_request = MagicMock()
            mock_request.execute.return_value = {
                "items": [
                    {"contentDetails": {"relatedPlaylists": {"uploads": "UU123"}}},
                ]
            }
            mock_request.uri = "http://example.test/channels"
            mock_channels = MagicMock()
            mock_channels.list.return_value = mock_request
            mock_service.channels.return_value = mock_channels

            with patch("tools.youtube.client.get_channel_registry", return_value=registry), patch(
                "tools.youtube.client.redact_request_uri", return_value=None
            ):
                playlist_id = resolve_uploads_playlist_id("UC123", service=mock_service)
                self.assertEqual("UU123", playlist_id)
                self.assertEqual("UU123", registry.get("UC123").uploads_playlist_id)

                # Second call should hit the cache and skip the API.
                mock_channels.list.reset_mock()
                cached = resolve_uploads_playlist_id("UC123", service=mock_service)
                self.assertEqual("UU123", cached)
                mock_channels.list.assert_not_called()


class CollectPlaylistItemsTest(TestCase):
    def test_stops_when_past_start_bound(self):
        responses = [
            {
                "items": [
                    {"snippet": {"publishedAt": "2025-02-01T00:00:00Z"}, "contentDetails": {"videoId": "v1"}},
                    {"snippet": {"publishedAt": "2025-01-15T00:00:00Z"}, "contentDetails": {"videoId": "v2"}},
                ],
                "nextPageToken": "t1",
            },
            {
                "items": [
                    {"snippet": {"publishedAt": "2024-12-31T00:00:00Z"}, "contentDetails": {"videoId": "v3"}},
                ],
            },
        ]
        service = _FakeYouTubeService(responses)
        start_dt = _parse_rfc3339("2025-01-01T00:00:00Z")
        with patch("tools.youtube.search_tool.redact_request_uri", return_value=None):
            items = _collect_playlist_items(
                service,
                "UU123",
                max_results=5,
                label="test",
                start_dt=start_dt,
                end_dt=None,
            )
        self.assertEqual(2, len(items))
        self.assertEqual({"v1", "v2"}, {item["contentDetails"]["videoId"] for item in items})


class _StubVideoMetadataService:
    def __init__(self):
        self.records = {}

    def upsert_metadata(self, video_id, payload, merge_custom_tags: bool = True):
        existing = self.records.get(video_id, {})
        sanitized = {k: v for k, v in payload.items() if k not in {"tags", "channel_title"}}
        incoming_custom = payload.get("custom_tags") or []
        existing_custom = existing.get("custom_tags") or []
        merged_custom = (
            sorted(set(existing_custom + incoming_custom)) if merge_custom_tags else incoming_custom
        )
        merged = {**existing, **sanitized, "custom_tags": merged_custom}
        merged.pop("tags", None)
        merged.pop("channel_title", None)
        self.records[video_id] = merged
        return merged


class _StubChannelRegistryService:
    def __init__(self):
        self.last_upsert = None
        self.ingest_state = {"uploads_next_page_token": None, "uploads_last_ingested_at": None}

    def upsert(self, **kwargs):
        self.last_upsert = kwargs
        if "uploads_next_page_token" in kwargs:
            self.ingest_state["uploads_next_page_token"] = kwargs["uploads_next_page_token"]
        if "uploads_last_ingested_at" in kwargs:
            self.ingest_state["uploads_last_ingested_at"] = kwargs["uploads_last_ingested_at"]
        return kwargs

    def get_ingest_state(self, channel_id):
        return dict(self.ingest_state)

    def update_ingest_state(self, channel_id, *, uploads_next_page_token, last_ingested_at=None):
        self.ingest_state["uploads_next_page_token"] = uploads_next_page_token
        self.ingest_state["uploads_last_ingested_at"] = last_ingested_at
        return dict(self.ingest_state)


class _StubEnrichTool:
    def __call__(self, video_ids, order="viewCount", max_results=None):
        # Return predictable enrichment for provided IDs.
        videos = []
        for vid in video_ids:
            videos.append(
                {
                    "video_id": vid,
                    "view_count": 10 if vid == "v1" else 5,
                    "statistics": {"likeCount": "2"},
                    "duration_seconds": 120,
                    "publish_date": "2025-01-01T00:00:00Z",
                    "tags": ["a", "b"],
                }
            )
        return {"videos": videos}


class PlaylistIngestServiceTest(TestCase):
    def test_enqueue_defaults_to_1000_items(self):
        channel_service = _StubChannelRegistryService()
        with tempfile.TemporaryDirectory() as tmp_dir, patch(
            "services.playlist_ingest_service.resolve_channel_identifier", side_effect=lambda x: x
        ), patch(
            "services.playlist_ingest_service.resolve_uploads_playlist_id", return_value="UU123"
        ):
            service = PlaylistIngestService(
                jobs_db_path=str(Path(tmp_dir) / "jobs.json"),
                video_service=_StubVideoMetadataService(),
                channel_service=channel_service,
                youtube_service=None,
                playlist_fetcher=lambda *args, **kwargs: ([], None),
                enrich_tool=_StubEnrichTool(),
            )
            job = service.enqueue("UC123")

        self.assertEqual(300, job["max_items"])

    def test_ingest_updates_next_page_token(self):
        playlist_items = [
            {"snippet": {"title": "Video 1"}, "contentDetails": {"videoId": "v1"}},
            {"snippet": {"title": "Video 2"}, "contentDetails": {"videoId": "v2"}},
        ]

        def playlist_fetcher(service, playlist_id, max_items, label, start_token=None, on_page=None):
            # Simulate one page with a follow-on token.
            if on_page:
                on_page("t1")
            return playlist_items[:max_items], "t1"

        channel_service = _StubChannelRegistryService()
        video_service = _StubVideoMetadataService()

        with tempfile.TemporaryDirectory() as tmp_dir, patch(
            "services.playlist_ingest_service.resolve_channel_identifier", side_effect=lambda x: x
        ), patch(
            "services.playlist_ingest_service.resolve_uploads_playlist_id", return_value="UU123"
        ):
            service = PlaylistIngestService(
                jobs_db_path=str(Path(tmp_dir) / "jobs.json"),
                video_service=video_service,
                channel_service=channel_service,
                youtube_service=None,
                playlist_fetcher=playlist_fetcher,
                enrich_tool=_StubEnrichTool(),
            )

            job = service.enqueue("UC123", max_items=2)
            result = service.run_job(job["job_id"])

        self.assertEqual("t1", result.get("next_page_token"))
        self.assertEqual("t1", channel_service.ingest_state["uploads_next_page_token"])

    def test_ingest_and_enrich_updates_metadata_and_preserves_custom_tags(self):
        playlist_items = [
            {
                "snippet": {
                    "title": "Video 1",
                    "publishedAt": "2025-01-01T00:00:00Z",
                    "channelId": "UC123",
                    "channelTitle": "Channel",
                    "tags": ["a"],
                },
                "contentDetails": {"videoId": "v1"},
            },
            {
                "snippet": {
                    "title": "Video 2",
                    "publishedAt": "2025-01-02T00:00:00Z",
                    "channelId": "UC123",
                    "channelTitle": "Channel",
                    "tags": ["b"],
                },
                "contentDetails": {"videoId": "v2"},
            },
        ]

        playlist_fetcher = lambda service, playlist_id, max_items, label: playlist_items[:max_items]  # noqa: E731
        video_service = _StubVideoMetadataService()
        # Seed custom tag to ensure enrichment doesn't clobber it.
        video_service.records["v1"] = {"custom_tags": ["keep"]}
        channel_service = _StubChannelRegistryService()
        enrich_tool = _StubEnrichTool()

        with tempfile.TemporaryDirectory() as tmp_dir, patch(
            "services.playlist_ingest_service.resolve_channel_identifier", side_effect=lambda x: x
        ), patch(
            "services.playlist_ingest_service.resolve_uploads_playlist_id", return_value="UU123"
        ):
            service = PlaylistIngestService(
                jobs_db_path=str(Path(tmp_dir) / "jobs.json"),
                video_service=video_service,
                channel_service=channel_service,
                youtube_service=None,
                playlist_fetcher=playlist_fetcher,
                enrich_tool=enrich_tool,
            )

            job = service.enqueue("UC123", max_items=10)
            result = service.run_job(job["job_id"])

        self.assertEqual("COMPLETED", result["state"])
        self.assertEqual(2, result["video_count"])
        # Enrichment called for both videos.
        self.assertEqual(2, result["enriched_count"])

        v1 = video_service.records["v1"]
        self.assertEqual(10, v1.get("view_count"))
        self.assertEqual(120, v1.get("duration_sec"))
        self.assertIn("keep", v1.get("custom_tags"))
        self.assertNotIn("tags", v1)

        self.assertEqual("UC123", channel_service.last_upsert.get("channel_id"))
