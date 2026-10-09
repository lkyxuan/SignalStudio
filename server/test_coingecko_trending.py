import tempfile
import unittest
from pathlib import Path

from coingecko_trending import CATALOG, MARKER, ensure_coingecko_trending
from graph_service import GraphService
from source_contract_store import SourceContractStore


class CoinGeckoTrendingTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.directory.name) / "test.db")
        self.service.ensure_system_tables()
        self.service.group_node_references_once()

    def tearDown(self):
        self.service.db.close()
        self.directory.cleanup()

    def dependencies(self):
        self.service.ensure_source_contract_sources(SourceContractStore().contract["operations"])
        self.service.create_node({"name": "提交评分事件", "type": "Score"})

    def test_install_is_atomic_additive_and_preserves_user_edits_and_deletions(self):
        ensure_coingecko_trending(self.service)
        self.assertIsNone(self.service.find_name("CoinGecko · 热榜上榜加分"))
        self.assertIsNone(self.service.db.execute("SELECT 1 FROM schema_meta WHERE key=?", (MARKER,)).fetchone())
        self.dependencies()
        original = self.service.create_node({"name": "CoinGecko · 热榜上榜加分", "type": "Score", "formula": "user formula"})
        ensure_coingecko_trending(self.service)
        graph = self.service.graph()
        self.assertEqual(self.service.get_node(original["id"])["formula"], "user formula")
        self.assertEqual(len(graph["edges"]), 4)
        self.assertEqual(len(self.service.get_fields(original["id"])), 7)
        self.assertEqual(len(graph["field_usages"]), 17)
        self.assertNotIn("event_key", {field["name"] for field in self.service.get_fields(original["id"])})
        ensure_coingecko_trending(self.service)
        self.assertEqual(graph, self.service.graph())
        self.service.delete_node(original["id"])
        ensure_coingecko_trending(self.service)
        self.assertIsNone(self.service.find_name(original["name"]))

    def test_failure_rolls_back_partial_install(self):
        self.dependencies()
        graph = self.service.graph()
        original_create = self.service.create_edge
        def fail(*args, **kwargs):
            raise RuntimeError("injected failure")
        self.service.create_edge = fail
        with self.assertRaisesRegex(RuntimeError, "injected"):
            ensure_coingecko_trending(self.service)
        self.assertEqual(graph, self.service.graph())
        self.service.create_edge = original_create
        ensure_coingecko_trending(self.service)
        self.assertIsNotNone(self.service.find_name("CoinGecko · 热榜上榜加分"))

    def test_portable_source_has_no_fabricated_observation(self):
        operation = SourceContractStore().get_operation("coingecko.search_trending")["operation"]
        self.assertEqual(operation["endpoint"], "/api/v3/search/trending")
        self.assertEqual(operation["collection_plan"]["interval_minutes"], 30)
        self.assertEqual(operation["inputs"], [])
        self.assertFalse(operation.get("call_examples"))
        self.assertTrue(all(field["evidence"] == "official_documentation" for field in operation["fields"]))
        self.assertTrue(all(field["example_value"] is None for field in operation["fields"]))


if __name__ == "__main__":
    unittest.main()
