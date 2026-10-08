import tempfile
import unittest
from pathlib import Path

from graph_service import GraphService
from coingecko_reference_cards import ensure_coingecko_reference_cards


class CoinGeckoReferenceCardsTest(unittest.TestCase):
    def test_import_preserves_design_and_does_not_restore_deleted_cards(self):
        with tempfile.TemporaryDirectory() as directory:
            service = GraphService(Path(directory) / "test.db")
            service.ensure_system_tables()
            service.group_node_references_once()
            service.create_node({"name": "coingecko.coins_markets", "type": "Source"})
            original = service.create_node({"name": "市场交易活跃候选", "formula": "user formula"})
            ensure_coingecko_reference_cards(service)
            graph = service.graph()
            self.assertEqual(len(graph["edges"]), 13)
            self.assertEqual(service.get_node(original["id"])["formula"], "user formula")
            ensure_coingecko_reference_cards(service)
            self.assertEqual(graph, service.graph())
            card = service.find_name("CoinGecko · 24 小时大涨")
            service.delete_node(card["id"])
            ensure_coingecko_reference_cards(service)
            self.assertIsNone(service.find_name(card["name"]))
            service.db.close()


if __name__ == "__main__":
    unittest.main()
