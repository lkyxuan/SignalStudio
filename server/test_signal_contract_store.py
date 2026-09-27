import tempfile
import unittest
from pathlib import Path

from graph_service import GraphError, GraphService
from signal_contract_store import SignalContractStore
from source_contract_store import SourceContractStore
from scripts.seed_example_signal import seed


class SignalContractStoreTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.graph = GraphService(Path(self.temp.name) / "graph.db")
        self.sources = SourceContractStore()
        self.signals = SignalContractStore(self.sources)
        self.node = seed(self.graph, self.sources, self.signals)

    def tearDown(self):
        self.graph.db.close()
        self.temp.cleanup()

    def test_example_is_complete_for_implementation_and_idempotent(self):
        self.assertEqual(seed(self.graph, self.sources, self.signals)["id"], self.node["id"])
        package = self.signals.package(self.graph, self.node["signal_key"])
        self.assertEqual(package["implementation_readiness"], {"status": "ready", "issues": []})
        self.assertEqual(package["signal_version"], 2)
        self.assertEqual(package["definition"]["design_status"], "hypothesis")
        self.assertFalse(package["runtime_evidence"]["signal_validated"])
        self.assertFalse(package["runtime_evidence"]["crawler_records_verified"])
        self.assertEqual(package["source_contract"]["operation"]["id"], "coingecko.coins_markets")
        guidance = package["definition"]["implementation_guidance"]
        self.assertEqual(guidance["target_platform"], "Few Understand")
        self.assertEqual(next(item for item in guidance["stages"]
                              if item["stage"] == "calculation")["product"], "Polars")
        self.assertEqual(len(package["design_graph"]["field_usages"]), 4)
        self.assertEqual(len(package["design_graph"]["requirements"]), 4)
        line = package["connection_contracts"][0]
        self.assertEqual(line["reference"], "L001")
        self.assertEqual(line["payload"]["payload_policy"], "preserve_complete_upstream_record")
        self.assertEqual(line["transport"]["message_key"], "data.id")
        self.assertNotIn("consumed_fields", line)
        self.assertNotIn("consumer_output", line)
        self.assertEqual(len(line["declared_upstream_field_inventory"]), 34)
        self.assertEqual(line["declared_upstream_field_inventory"][0]["message_path"], "data.id")
        self.assertEqual(self.signals.connection(self.graph, line["edge_id"])["connection"], line)
        processor = package["processor_contract"]
        self.assertEqual(processor["input_line_reference"], "L001")
        self.assertEqual(len(processor["consumed_fields"]), 4)
        self.assertEqual(processor["consumed_fields"][2]["message_path"], "data.total_volume")
        self.assertEqual(processor["processing"]["calculation"]["output"], "turnover_ratio_24h")
        self.assertEqual(self.signals.processor(self.graph, self.node["id"])["processor"], processor)

    def test_graph_drift_is_reported_and_layout_does_not_change_revision(self):
        original = self.signals.package(self.graph, self.node["id"])
        self.graph.update_node(self.node["id"], {"position_x": 900})
        self.assertEqual(self.signals.package(self.graph, self.node["id"])["revision"],
                         original["revision"])
        self.graph.update_node(self.node["id"], {"trigger_rule": "edited"})
        changed = self.signals.package(self.graph, self.node["id"])
        self.assertEqual(changed["implementation_readiness"]["status"], "incomplete")
        self.assertIn("Graph text differs from the published contract: trigger_rule",
                      changed["implementation_readiness"]["issues"])

    def test_same_definition_has_same_revision_in_a_new_project_database(self):
        original = self.signals.package(self.graph, self.node["id"])
        other = GraphService(Path(self.temp.name) / "other.db")
        try:
            other_node = seed(other, self.sources, self.signals)
            exported = self.signals.package(other, other_node["id"])
            self.assertNotEqual(other_node["id"], self.node["id"])
            self.assertEqual(exported["revision"], original["revision"])
        finally:
            other.db.close()

    def test_missing_field_usage_blocks_ready_status(self):
        package = self.signals.package(self.graph, self.node["id"])
        usage = package["design_graph"]["field_usages"][0]
        self.graph.delete_field_usage(usage["id"])
        changed = self.signals.package(self.graph, self.node["id"])
        self.assertEqual(changed["implementation_readiness"]["status"], "incomplete")
        self.assertTrue(any("Input is not mapped" in issue
                            for issue in changed["implementation_readiness"]["issues"]))

    def test_line_transport_mismatch_blocks_ready_status(self):
        line = self.signals.package(self.graph, self.node["id"])["connection_contracts"][0]
        self.graph.update_edge(line["edge_id"], {"transport_key": "id"})
        changed = self.signals.package(self.graph, self.node["id"])
        self.assertIn("Input transport does not match the signal contract",
                      changed["implementation_readiness"]["issues"])

    def test_report_requires_matching_package_and_keeps_evidence_separate(self):
        package = self.signals.package(self.graph, self.node["id"])
        report = {
            "signal_key": package["signal_key"],
            "signal_version": package["signal_version"],
            "package_revision": package["revision"],
            "source_contract_revision": package["source_contract_revision"],
            "implementation_status": "in_progress",
            "coverage_state": "not_run",
            "errors": [],
        }
        with self.assertRaisesRegex(GraphError, "package_revision"):
            self.graph.create_signal_report(package, {**report, "package_revision": "sha256:wrong"})
        saved = self.graph.create_signal_report(package, report)
        self.assertEqual(saved["implementation_status"], "in_progress")
        self.assertEqual(saved["technology_decisions"], {})
        with self.assertRaisesRegex(GraphError, "compute engine"):
            self.graph.create_signal_report(package, {**report,
                                                      "implementation_status": "implemented"})
        implemented = self.graph.create_signal_report(package, {
            **report, "implementation_status": "implemented",
            "technology_decisions": {
                "compute_engine": "Polars", "runtime": "Python",
                "component": "consumer/polars_engine", "deviations": []},
        })
        self.assertEqual(implemented["technology_decisions"]["compute_engine"], "Polars")
        updated = self.signals.package(self.graph, self.node["id"])
        self.assertEqual(updated["revision"], package["revision"])
        self.assertEqual(updated["runtime_evidence"]["status"], "reported")
        self.assertFalse(updated["runtime_evidence"]["signal_validated"])


if __name__ == "__main__":
    unittest.main()
