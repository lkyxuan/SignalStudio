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
                         ["operation"]["response_coverage"], "page_observation_lower_bound")
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

    def test_user_defined_collection_plan_is_portable_and_not_runtime_evidence(self):
        contract = SourceContractStore()
        plan = contract.get_operation("kaito.mcp.kaito_smart_following_market")["operation"]["collection_plan"]
        self.assertEqual(plan, {
            "mode": "scheduled", "interval_minutes": 720,
            "status": "user_defined_plan",
            "evidence_status": "design_only_no_runtime_verification",
        })
        self.assertNotIn("collection_plan", contract.get_operation("kaito.mcp.kaito_search")["operation"])

    def test_every_source_shows_input_status_and_kaito_uses_live_schema(self):
        contract = SourceContractStore()
        for item in contract.contract["operations"] + contract.contract["resources"]:
            self.assertIn("input_coverage", item, item["id"])
            self.assertIn("inputs", item, item["id"])
        narratives = contract.get_operation("kaito.mcp.kaito_narratives")["operation"]
        self.assertEqual([(field["name"], field["required"]) for field in narratives["inputs"]],
                         [("query", False), ("limit", False)])
        self.assertEqual(narratives["input_coverage"], "live_mcp_input_schema")
        self.assertEqual(len(narratives["fields"]), 3)
        feeds = contract.get_operation("kaito.mcp.kaito_feeds")["operation"]
        self.assertEqual(feeds["input_coverage"], "live_mcp_input_schema")
        self.assertEqual([field["name"] for field in feeds["inputs"]],
                         ["token", "min_created_at", "max_created_at", "size"])
        search = contract.get_operation("kaito.mcp.kaito_search")["operation"]
        self.assertEqual([(field["name"], field["required"]) for field in search["inputs"]],
                         [("query", True), ("size", False)])
        entities = contract.get_operation("kaito.mcp.kaito_entities")["operation"]
        self.assertEqual(len(entities["call_examples"]), 3)
        example = entities["call_examples"][0]
        self.assertEqual(example["evidence"], "live_mcp_call")
        self.assertEqual(example["request"], {"query": "Bitcoin", "limit": 1})
        self.assertEqual(example["response_path"], "matches[0]")
        self.assertEqual(example["response"]["token"], "BTC")
        self.assertEqual(entities["call_examples"][1]["request"], {"query": "Ethereum", "limit": 1})
        self.assertEqual(entities["call_examples"][1]["response"]["token"], "ETH")
        self.assertEqual(entities["call_examples"][2]["request"], {"query": "Solana", "limit": 2})
        self.assertEqual(entities["call_examples"][2]["result_count"], 2)
        engagement_examples = contract.get_operation("kaito.mcp.kaito_engagement")["operation"]["call_examples"]
        self.assertEqual(len(engagement_examples), 5)
        engagement = engagement_examples[0]
        self.assertEqual(engagement["response_path"], "root")
        self.assertEqual([item["date"] for item in engagement["daily_series"]],
                         [f"2026-09-{day:02d}" for day in range(1, 7)])
        self.assertEqual(engagement["response"]["total_engagement"]["2026-09-01"], 132672)
        self.assertEqual(sum(item["total_engagement"] for item in engagement["daily_series"]), 792529)
        self.assertEqual([item["request"]["token"] for item in engagement_examples[:3]], ["BTC", "ETH", "SOL"])
        self.assertEqual(engagement_examples[3]["request"]["keyword"], "Bitcoin")
        self.assertTrue(all(item["evidence"] == "live_mcp_call" for item in engagement_examples))
        advanced = contract.get_operation("kaito.mcp.kaito_advanced_search")["operation"]["call_examples"]
        self.assertEqual(len(advanced), 4)
        self.assertEqual({item["request"].get("sources") for item in advanced}, {None, "Twitter", "News"})
        self.assertEqual(advanced[0]["result_count"], 50)
        taoli = contract.get_operation("taoli.funding_page")["operation"]
        self.assertEqual(taoli["input_coverage"], "live_page_controls")
        self.assertEqual(len(taoli["fields"]), 8)
        self.assertEqual(len(taoli["call_examples"]), 2)
        self.assertTrue(all(item["evidence"] == "live_page_observation" for item in taoli["call_examples"]))
        self.assertEqual(taoli["call_examples"][1]["request"]["exchange_filter"], "Binance")
        self.assertEqual(taoli["call_examples"][1]["response"]["market"], "BTC/USDT")
        observed = [item for item in contract.contract["operations"] if item.get("call_examples")]
        self.assertEqual(len(observed), 34)
        self.assertTrue(all(item["explanation_zh"] for operation in observed
                            for item in operation["call_examples"]))

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
