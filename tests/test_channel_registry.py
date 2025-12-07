from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from channel_registry.manager import ChannelRegistryManager
from channel_registry.models import ChannelRecord
from channel_registry.registry import ChannelRegistry


class ChannelRegistryTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp_dir = tempfile.TemporaryDirectory()
        registry_path = Path(self._tmp_dir.name) / "registry.json"
        self.registry = ChannelRegistry(str(registry_path))

    def tearDown(self) -> None:
        self._tmp_dir.cleanup()

    def test_resolve_handle_and_url(self) -> None:
        record = ChannelRecord(channel_id="UC123", handle="@testhandle", title="Test Channel")
        self.registry.upsert(record)

        handle_match = self.registry.resolve("@testhandle")
        url_match = self.registry.resolve("https://www.youtube.com/@testhandle")

        self.assertIsNotNone(handle_match)
        self.assertEqual(handle_match.channel_id, "UC123")
        self.assertIsNotNone(url_match)
        self.assertEqual(url_match.channel_id, "UC123")

    def test_find_or_create_builds_placeholder_id(self) -> None:
        record = self.registry.find_or_create_by_identifier("Serhii Sternenko")
        self.assertTrue(record.channel_id.startswith("synthetic::"))
        # Ensure record persisted
        reload_registry = ChannelRegistry(str(Path(self._tmp_dir.name) / "registry.json"))
        self.assertIsNotNone(reload_registry.resolve("Serhii Sternenko"))

    def test_update_partial_only_manual_fields(self) -> None:
        record = ChannelRecord(channel_id="UC789", handle="@example", title="Original")
        self.registry.upsert(record)

        updated = self.registry.update_partial(
            "UC789",
            title="Should Not Change",
            owner="Owner Name",
            notes="New note",
            aliases=["@example", "Example"],
        )

        self.assertIsNotNone(updated)
        self.assertEqual(updated.title, "Original")
        self.assertEqual(updated.owner, "Owner Name")
        self.assertEqual(updated.notes, "New note")
        self.assertIn("@example", updated.aliases)

    def test_alias_merge_dedupes_case_insensitive(self) -> None:
        record = ChannelRecord(channel_id="UC555", handle="@Example", title="Title")
        self.registry.upsert(record)

        updated = self.registry.update_partial(
            "UC555",
            aliases=["example", "@example", "Example "],
            base_identifier="https://youtube.com/@example",
        )

        self.assertIsNotNone(updated)
        # Should only keep unique alias values (case-insensitive), preserving order
        self.assertEqual(updated.aliases[0], "example")
        self.assertEqual(len(updated.aliases), len(set(alias.lower() for alias in updated.aliases)))

    def test_atomic_persist_creates_file(self) -> None:
        path = Path(self._tmp_dir.name) / "registry.json"
        record = ChannelRecord(channel_id="UC000", handle="@sample", title="Sample")
        self.registry.upsert(record)

        self.assertTrue(path.exists())


class _FakeRefresher:
    """Stub refresher that mirrors refresh behavior without API calls."""

    def __init__(self, registry: ChannelRegistry):
        self.registry = registry

    def refresh(self, identifier: str, force: bool = False) -> ChannelRecord:
        record = self.registry.resolve(identifier) or self.registry.find_or_create_by_identifier(identifier)
        # Simulate fetch-populated fields
        record.title = record.title or "Fetched Title"
        record.metadata.subscriber_count = 123
        self.registry.upsert(record)
        return record


class ChannelRegistryManagerTest(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp_dir = tempfile.TemporaryDirectory()
        registry_path = Path(self._tmp_dir.name) / "registry.json"
        self.registry = ChannelRegistry(str(registry_path))
        self.manager = ChannelRegistryManager(registry=self.registry, refresher=_FakeRefresher(self.registry))

    def tearDown(self) -> None:
        self._tmp_dir.cleanup()

    def test_add_channel_refreshes_and_sets_manual_fields(self) -> None:
        record = self.manager.add_channel("@newhandle", owner="Owner", notes="Note", aliases=["alias1", "@newhandle"])
        self.assertEqual(record.owner, "Owner")
        self.assertEqual(record.notes, "Note")
        self.assertGreaterEqual(len(record.aliases), 1)
        self.assertEqual(record.metadata.subscriber_count, 123)

    def test_update_manual_fields_only(self) -> None:
        record = self.manager.add_channel("@update_me")
        updated = self.manager.update_manual_fields("@update_me", owner="New Owner", notes="Updated")
        self.assertIsNotNone(updated)
        assert updated is not None
        self.assertEqual(updated.owner, "New Owner")
        self.assertEqual(updated.notes, "Updated")

    def test_view_summary_lists_channels(self) -> None:
        self.manager.add_channel("@summary_handle")
        summary = self.manager.view_summary()
        self.assertEqual(len(summary), 1)
        self.assertEqual(summary[0]["handle"], "@summary_handle")


if __name__ == "__main__":
    unittest.main()


