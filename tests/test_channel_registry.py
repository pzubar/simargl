from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

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
        record = ChannelRecord(channel_id="UC123", handle="testhandle", title="Test Channel")
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


if __name__ == "__main__":
    unittest.main()


