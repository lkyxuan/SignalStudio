import json
import tempfile
import unittest
from pathlib import Path

from graph_service import GraphError
from source_contract_store import DEFAULT_CONTRACT, SourceContractStore
from graph_service import GraphService


class SourceContractStoreTest(unittest.TestCase):
    def test_upstream_contract_is_independent_of_few_understand_v2(self):
        contract = SourceContractStore()
        self.assertEqual(contract.meta()["owner"], "SignalStudio")
        self.assertEqual(contract.meta()["source_count"], 8)
        self.assertEqual(contract.meta()["operation_count"], 36)
        self.assertEqual(contract.meta()["resource_count"], 2)
        self.assertEqual(contract.get_resource("kaito.resource.tokens")["resource"]["uri"], "kaito://tokens")
        self.assertEqual(contract.get_resource("kaito.resource.narratives")["resource"]["uri"], "kaito://narratives")
        self.assertNotIn("legacy_v2_entity_id", contract.get_operation(
            "kaito.mcp.kaito_search")["operation"])
        self.assertEqual(contract.get_operation("dexscreener.token_pairs_by_address")
                         ["operation"]["endpoint"], "/token-pairs/v1/{chainId}/{tokenAddress}")
        self.assertEqual(contract.get_operation("taoli.funding_page")
                         ["operation"]["response_coverage"], "awaiting_first_party_schema")
        self.assertTrue(any(field["path"] == "mindshare" for field in contract.get_operation(
            "kaito.mcp.kaito_mindshare_entity_by_account")["operation"]["fields"]))

    def test_modified_contract_cannot_keep_old_revision(self):
        payload = json.loads(DEFAULT_CONTRACT.read_text())
        payload["operations"][0]["endpoint"] = "/wrong"
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "contract.json"
            path.write_text(json.dumps(payload))
            with self.assertRaisesRegex(GraphError, "revision"):
                SourceContractStore(path)

    def test_every_source_shows_input_status_and_narratives_has_two_optional_inputs(self):
        contract = SourceContractStore()
        for item in contract.contract["operations"] + contract.contract["resources"]:
            self.assertIn("input_coverage", item, item["id"])
            self.assertIn("inputs", item, item["id"])
        narratives = contract.get_operation("kaito.mcp.kaito_narratives")["operation"]
        self.assertEqual([(field["name"], field["required"]) for field in narratives["inputs"]],
                         [("query", False), ("limit", False)])
        self.assertEqual(len(narratives["fields"]), 3)
        feeds = contract.get_operation("kaito.mcp.kaito_feeds")["operation"]
        self.assertEqual(feeds["input_coverage"], "unverified")
        self.assertEqual(feeds["inputs"], [])

    def test_planned_field_can_be_added_to_a_new_operation_source(self):
        contract = SourceContractStore()
        identifier = "source-contracts.v1::dexscreener.token_pairs_by_address::priceUsd"
        entity, field = contract.get_field_definition(identifier)
        self.assertEqual(entity["id"], "dexscreener.token_pairs_by_address")
        self.assertEqual(field["path"], "priceUsd")
        with tempfile.TemporaryDirectory() as directory:
            graph = GraphService(str(Path(directory) / "graph.db"))
            result = graph.use_catalog_field(entity, field)
            self.assertTrue(result["source_created"])
            self.assertEqual(graph.find_name(entity["id"])["type"], "Source")
            self.assertEqual(next(item for item in graph.graph()["fields"]
                                  if item["catalog_field_id"] == identifier)["name"], "priceUsd")

    def test_upstream_operations_have_independent_source_nodes(self):
        contract = SourceContractStore()
        with tempfile.TemporaryDirectory() as directory:
            graph = GraphService(str(Path(directory) / "graph.db"))
            result = graph.ensure_source_contract_sources(contract.contract["operations"])
            self.assertEqual(result, {"created": 36, "total": 36})
            search_ref = graph.find_name("kaito.mcp.kaito_search")["reference_number"]
            entries = contract.contract["operations"] + contract.contract["resources"]
            self.assertEqual(graph.ensure_source_contract_sources(entries), {"created": 2, "total": 38})
            self.assertEqual(graph.ensure_source_contract_sources(entries)["created"], 0)
            self.assertEqual(graph.find_name("kaito.mcp.kaito_search")["reference_number"], search_ref)
            self.assertEqual(graph.find_name("kaito.mcp.kaito_search")["type"], "Source")
            self.assertEqual(graph.find_name("kaito.mcp.kaito_advanced_search")["type"], "Source")
            self.assertEqual(graph.find_name("kaito.resource.tokens")["type"], "Source")
            self.assertEqual(graph.find_name("kaito.resource.narratives")["type"], "Source")


if __name__ == "__main__":
    unittest.main()
