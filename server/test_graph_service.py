import io
import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from graph_service import GraphError, GraphService
from catalog_store import CatalogStore


class GraphServiceTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "graph.db"
        self.service = GraphService(self.path)

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def _flow(self):
        source = self.service.create_node({"name": "Input", "type": "Source"})
        target = self.service.create_node({"name": "Count", "type": "Raw Field"})
        other = self.service.create_node({"name": "Other Input", "type": "Source"})
        source_field = self.service.create_field(source["id"], {"name": "author_id"})
        second_field = self.service.create_field(source["id"], {"name": "posted_at"})
        output = self.service.create_field(target["id"], {"name": "mention_count"})
        wrong = self.service.create_field(other["id"], {"name": "unrelated"})
        edge = self.service.create_edge({"upstream_id": source["id"], "downstream_id": target["id"],
                                         "transformation": "按账号去重后统计提及"})
        usage = self.service.create_field_usage(edge["id"], {"source_field_id": second_field["id"],
                                                           "target_field_id": output["id"]})
        return source, target, other, source_field, output, wrong, edge, usage

    def test_new_database_has_no_demo_graph(self):
        graph = self.service.graph()
        self.assertEqual((len(graph["nodes"]), len(graph["edges"]), len(graph["fields"])), (0, 0, 0))

    def test_retire_unused_legacy_record_types_preserves_references(self):
        old = self.service.create_node({"name": "old.record", "type": "Source"})
        self.service.db.execute("UPDATE nodes SET is_catalog_source=1 WHERE id=?", (old["id"],))
        self.service.create_field(old["id"], {"name": "legacy_value"}, actor="catalog")
        current = self.service.create_node({"name": "current.operation", "type": "Source"})
        self.assertEqual(self.service.retire_legacy_record_types(), {"retired": 1})
        self.assertEqual(self.service.retire_legacy_record_types(), {"retired": 0})
        self.assertEqual({node["name"] for node in self.service.graph()["nodes"]},
                         {"current.operation"})
        next_node = self.service.create_node({"name": "Next", "type": "Metric"})
        self.assertGreater(next_node["reference_number"], current["reference_number"])

    def test_retire_legacy_record_types_refuses_connected_design(self):
        old = self.service.create_node({"name": "old.record", "type": "Source"})
        self.service.db.execute("UPDATE nodes SET is_catalog_source=1 WHERE id=?", (old["id"],))
        target = self.service.create_node({"name": "Signal", "type": "Metric"})
        self.service.create_edge({"upstream_id": old["id"], "downstream_id": target["id"]})
        with self.assertRaisesRegex(GraphError, "design connection"):
            self.service.retire_legacy_record_types()
        self.assertIsNotNone(self.service.find_name("old.record"))

    def test_legacy_reference_compaction_preserves_graph_and_runs_only_once(self):
        retired = self.service.create_node({"name": "old.record", "type": "Source"})
        self.service.db.execute("UPDATE nodes SET is_catalog_source=1 WHERE id=?", (retired["id"],))
        source = self.service.create_node({"name": "current.source", "type": "Source"})
        target = self.service.create_node({"name": "Signal", "type": "Metric"})
        field = self.service.create_field(source["id"], {"name": "value"})
        edge = self.service.create_edge({"upstream_id": source["id"],
                                         "downstream_id": target["id"]})
        self.assertEqual(self.service.retire_legacy_record_types(), {"retired": 1})
        self.assertEqual(self.service.compact_retired_node_references(),
                         {"renumbered": 2, "total": 2})
        self.assertEqual((self.service.get_node(source["id"])["reference_number"],
                          self.service.get_node(target["id"])["reference_number"]), (1, 2))
        self.assertEqual(self.service.get_fields(source["id"])[0]["id"], field["id"])
        self.assertEqual(self.service.get_edge(edge["id"])["upstream_id"], source["id"])
        self.assertEqual(self.service._one("SELECT value FROM schema_meta WHERE key='next_node_number'")["value"], "3")
        self.service.delete_node(target["id"])
        self.service.db.close()
        self.service = GraphService(self.path)
        self.assertEqual(self.service.compact_retired_node_references(),
                         {"renumbered": 0, "total": 1})
        replacement = self.service.create_node({"name": "Next", "type": "Metric"})
        self.assertEqual(replacement["reference_number"], 3)

    def test_node_numbers_survive_edits_and_are_never_reused(self):
        first = self.service.create_node({"name": "Feed", "type": "Source"})
        second = self.service.create_node({"name": "Signal", "type": "Metric"})
        self.assertEqual((first["reference_number"], second["reference_number"]), (1, 2))
        self.service.update_node(first["id"], {"name": "Renamed feed", "position_x": 300})
        self.assertEqual(self.service.get_node(first["id"])["reference_number"], 1)
        self.service.delete_node(second["id"])
        self.service.db.close()
        self.service = GraphService(self.path)
        third = self.service.create_node({"name": "Next signal", "type": "Metric"})
        self.assertEqual(third["reference_number"], 3)

    def test_grouped_card_references_preserve_nodes_and_allocate_by_kind(self):
        self.service.ensure_system_tables()
        source = self.service.create_node({"name": "Crawler", "type": "Source"})
        asset_old_ref = self.service.find_name("assets")["reference_number"]
        metric = self.service.create_node({"name": "Calculate", "type": "Metric",
                                           "definition": f"Read #{asset_old_ref:03d} from #{source['reference_number']:03d}."})
        decision = self.service.create_node({"name": "Look up asset", "type": "Asset Resolution"})
        result = self.service.create_node({"name": "Result", "type": "Flow Result"})
        review = self.service.create_node({"name": "Review", "type": "Review Decision"})
        matched = self.service.create_edge({"upstream_id": decision["id"],
                                            "downstream_id": result["id"], "branch_label": "matched"})
        self.service.create_edge({"upstream_id": decision["id"],
                                  "downstream_id": review["id"], "branch_label": "conflict"})
        self.assertEqual(self.service.group_node_references_once(), {"renumbered": 12, "total": 12})
        self.assertEqual(self.service.group_node_references_once(), {"renumbered": 0, "total": 12})
        self.assertEqual(self.service.find_name("assets")["reference_number"], 1001)
        self.assertEqual(self.service.get_node(source["id"])["reference_number"], 2001)
        self.assertEqual(self.service.get_node(metric["id"])["reference_number"], 3001)
        self.assertEqual(self.service.get_node(metric["id"])["definition"],
                         "Read #1001 from #2001.")
        self.assertEqual(self.service.get_node(result["id"])["reference_number"], 3002)
        self.assertEqual(self.service.get_node(decision["id"])["reference_number"], 4001)
        self.assertEqual(self.service.get_node(review["id"])["reference_number"], 4002)
        self.assertEqual(self.service.get_edge(matched["id"])["reference_number"], 1)
        self.service.db.close()
        self.service = GraphService(self.path)
        self.assertEqual(self.service.compact_retired_node_references(),
                         {"renumbered": 0, "total": 12})
        self.assertEqual(self.service.create_node({"name": "Second crawler", "type": "Source"})["reference_number"], 2002)
        self.assertEqual(self.service.create_node({"name": "Check", "type": "Evidence Check"})["reference_number"], 4003)
        self.assertEqual(self.service.create_node({"name": "Second metric", "type": "Score"})["reference_number"], 3003)
        self.assertEqual(self.service.create_node({"name": "Branch lookup", "type": "Asset Resolution",
                                                   "reference_group": 4})["reference_number"], 4004)
        with self.assertRaisesRegex(GraphError, "reference group"):
            self.service.create_node({"name": "Wrong group", "type": "Source", "reference_group": 4})

    def test_connection_and_field_usage_numbers_survive_edits_and_deletion(self):
        source, target, _, source_field, output, _, edge, usage = self._flow()
        self.assertEqual((edge["reference_number"], usage["reference_number"]), (1, 1))
        self.service.update_edge(edge["id"], {"rationale": "New reason"})
        self.service.update_field_usage(usage["id"], {"usage_note": "New mapping note"})
        self.assertEqual(self.service.get_edge(edge["id"])["reference_number"], 1)
        self.assertEqual(self.service.get_field_usages(edge["id"])[0]["reference_number"], 1)
        self.service.delete_edge(edge["id"])
        self.service.db.close()
        self.service = GraphService(self.path)
        next_edge = self.service.create_edge({"upstream_id": source["id"], "downstream_id": target["id"]})
        next_usage = self.service.create_field_usage(next_edge["id"], {
            "source_field_id": source_field["id"], "target_field_id": output["id"]})
        self.assertEqual((next_edge["reference_number"], next_usage["reference_number"]), (2, 2))
        self.assertEqual(self.service.graph()["edges"][0]["reference_number"], 2)
        self.assertEqual(self.service.graph()["field_usages"][0]["reference_number"], 2)

    def test_decision_routes_keep_labels_and_result_endpoint(self):
        decision = self.service.create_node({"name": "Match identity", "type": "Asset Resolution"})
        result = self.service.create_node({"name": "Matched record", "type": "Flow Result"})
        pending = self.service.create_node({"name": "Pending identity", "type": "Asset Resolution"})
        matched = self.service.create_edge({"upstream_id": decision["id"],
                                            "downstream_id": result["id"], "branch_label": "matched"})
        unmatched = self.service.create_edge({"upstream_id": decision["id"],
                                              "downstream_id": pending["id"], "branch_label": "unmatched / conflict"})
        self.service.update_edge(matched["id"], {"branch_label": "verified match"})
        self.service.db.close()
        self.service = GraphService(self.path)
        routes = {edge["branch_label"]: edge["downstream_id"] for edge in self.service.graph()["edges"]}
        self.assertEqual(routes, {"verified match": result["id"], "unmatched / conflict": pending["id"]})
        self.assertEqual(self.service.get_edge(unmatched["id"])["branch_label"], "unmatched / conflict")

    def test_existing_connections_and_field_usages_gain_numbers(self):
        *_, edge, usage = self._flow()
        self.service.db.execute("UPDATE edges SET reference_number=NULL")
        self.service.db.execute("UPDATE edge_field_usages SET reference_number=NULL")
        self.service.db.execute("DELETE FROM schema_meta WHERE key IN ('next_edge_number', 'next_usage_number')")
        self.service.db.commit()
        self.service.db.close()
        self.service = GraphService(self.path)
        self.assertEqual(self.service.get_edge(edge["id"])["reference_number"], 1)
        self.assertEqual(self.service.get_field_usages(edge["id"])[0]["reference_number"], 1)
        self.assertEqual(self.service._one("SELECT value FROM schema_meta WHERE key='next_edge_number'")["value"], "2")
        self.assertEqual(self.service._one("SELECT value FROM schema_meta WHERE key='next_usage_number'")["value"], "2")

    def test_workflow_lanes_are_persisted_and_sources_default_shared(self):
        source = self.service.create_node({"name": "Feed", "type": "Source"})
        relation = self.service.create_node({"name": "Find relation", "type": "Relationship Discovery"})
        metric = self.service.create_node({"name": "Co-mentions", "type": "Metric",
                                           "workflow_lane": "knowledge"})
        self.assertEqual([source["workflow_lane"], relation["workflow_lane"],
                          metric["workflow_lane"]], ["shared", "knowledge", "knowledge"])
        with self.assertRaises(GraphError):
            self.service.update_node(metric["id"], {"workflow_lane": "unknown"})
        self.service.db.close()
        self.service = GraphService(self.path)
        self.assertEqual(self.service.get_node(metric["id"])["workflow_lane"], "knowledge")

    def test_existing_nodes_gain_workflow_lanes_on_migration(self):
        self.service.db.close()
        self.path.unlink()
        legacy = sqlite3.connect(self.path)
        legacy.execute("""CREATE TABLE nodes (
            id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
            type TEXT NOT NULL, definition TEXT NOT NULL DEFAULT '',
            formula TEXT NOT NULL DEFAULT '', rationale TEXT NOT NULL DEFAULT '',
            caveats TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
            position_x REAL NOT NULL DEFAULT 0, position_y REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL)""")
        legacy.executemany("INSERT INTO nodes (id, name, type, created_at, updated_at) VALUES (?,?,?,?,?)",
                           [("s", "Source", "Source", "now", "now"),
                            ("r", "Relation", "Relationship Discovery", "now", "now"),
                            ("m", "Metric", "Metric", "now", "now")])
        legacy.commit()
        legacy.close()
        self.service = GraphService(self.path)
        self.assertEqual({node["id"]: node["workflow_lane"] for node in self.service.graph()["nodes"]},
                         {"s": "shared", "r": "knowledge", "m": "signal"})
        self.assertEqual({node["reference_number"] for node in self.service.graph()["nodes"]},
                         {1, 2, 3})

    def test_business_table_nodes_are_distinct_connectable_references(self):
        self.assertEqual(self.service.ensure_system_tables(), {"created": 7, "total": 7})
        self.assertEqual(self.service.ensure_system_tables(), {"created": 0, "total": 7})
        self.assertEqual(self.service.graph()["edges"], [])
        self.assertEqual({node["name"] for node in self.service.graph()["nodes"]},
                         {"assets", "asset_identifiers", "asset_relationships", "asset_monitoring_rules",
                          "asset_score_events", "asset_scores_current", "supabase_asset_scores"})
        state = self.service.find_name("asset_identifiers")
        self.assertEqual((state["type"], state["workflow_lane"], state["is_system_state"]),
                         ("asset_identifiers", "shared", 1))
        binding = self.service.create_node({"name": "Bind asset", "type": "Asset Resolution"})
        edge = self.service.create_edge({"upstream_id": state["id"], "downstream_id": binding["id"]})
        self.assertEqual(edge["transport_kind"], "direct")
        with self.assertRaisesRegex(GraphError, "Redpanda"):
            self.service.update_edge(edge["id"], {"transport_kind": "redpanda", "transport_topic": "raw.asset"})
        self.service.update_node(state["id"], {"position_x": 500})
        with self.assertRaises(GraphError):
            self.service.update_node(state["id"], {"name": "Other registry"})
        with self.assertRaises(GraphError):
            self.service.create_field(state["id"], {"name": "fake_record"})
        with self.assertRaises(GraphError):
            self.service.delete_node(state["id"])

    def test_table_feedback_represents_later_runs_without_allowing_processor_cycle(self):
        self.service.ensure_system_tables()
        table = self.service.find_name("assets")
        lookup = self.service.create_node({"name": "Lookup candidate", "type": "Asset Resolution"})
        update = self.service.create_node({"name": "Update candidate", "type": "Asset Resolution"})
        self.service.create_edge({"upstream_id": table["id"], "downstream_id": lookup["id"]})
        self.service.create_edge({"upstream_id": lookup["id"], "downstream_id": update["id"]})
        write = self.service.create_edge({"upstream_id": update["id"], "downstream_id": table["id"]})
        self.assertEqual(write["transport_kind"], "direct")
        with self.assertRaisesRegex(GraphError, "dependency cycle"):
            self.service.create_edge({"upstream_id": update["id"], "downstream_id": lookup["id"]})

    def test_legacy_aggregate_nodes_are_removed_only_when_unconnected(self):
        old = self.service.create_node({"name": "Asset Registry", "type": "Asset Registry"}, actor="system")
        self.service.db.execute("UPDATE nodes SET is_system_state=1 WHERE id=?", (old["id"],))
        self.service.db.commit()
        self.service.ensure_system_tables()
        self.assertIsNone(self.service.find_name("Asset Registry"))
        old = self.service.create_node({"name": "Asset Registry", "type": "Asset Registry"}, actor="system")
        self.service.db.execute("UPDATE nodes SET is_system_state=1 WHERE id=?", (old["id"],))
        binding = self.service.create_node({"name": "Existing design", "type": "Asset Resolution"})
        self.service.create_edge({"upstream_id": old["id"], "downstream_id": binding["id"]})
        self.service.ensure_system_tables()
        self.assertIsNotNone(self.service.find_name("Asset Registry"))

    def test_old_demo_nodes_are_removed_without_deleting_user_nodes(self):
        demo = self.service.create_node({"name": "Legacy Example", "type": "Metric"}, actor="seed")
        self.service.create_field(demo["id"], {"name": "demo_value"}, actor="seed")
        kept = self.service.create_node({"name": "User Signal", "type": "Metric"})
        self.service.db.execute("DELETE FROM schema_meta WHERE key='demo_cleanup_v1'")
        self.service.db.commit()
        self.service.db.close()
        self.service = GraphService(self.path)
        self.assertIsNone(self.service.find_name("Legacy Example"))
        self.assertEqual(self.service.find_name("User Signal")["id"], kept["id"])
        self.assertEqual(self.service.graph()["fields"], [])

    def test_create_update_edge_delete_and_persist(self):
        source, *_ = self._flow()
        node = self.service.create_node({"name": "Liquidity Signal", "type": "Metric", "definition": "Measures liquidity",
            "decision_question": "Can this asset be traded without major slippage?"})
        node = self.service.update_node(node["id"], {"formula": "volume / spread", "position_x": 123,
            "observation_window": "24h, refreshed hourly", "trigger_rule": "score > 70",
            "validation_plan": "Compare with observed slippage", "validation_evidence": "Pilot sample: 20 trades"})
        self.assertEqual(node["position_x"], 123)
        edge = self.service.create_edge({"upstream_id": source["id"], "downstream_id": node["id"]})
        with self.assertRaises(GraphError):
            self.service.create_edge({"upstream_id": edge["upstream_id"], "downstream_id": edge["downstream_id"]})
        self.service.db.close()
        self.service = GraphService(self.path)
        self.assertEqual(self.service.get_node(node["id"])["formula"], "volume / spread")
        self.assertEqual(self.service.get_node(node["id"])["decision_question"], "Can this asset be traded without major slippage?")
        self.assertEqual(self.service.get_node(node["id"])["trigger_rule"], "score > 70")
        self.assertEqual(self.service.get_node(node["id"])["validation_evidence"], "Pilot sample: 20 trades")
        self.assertEqual(len(self.service.get_upstream(node["id"])), 1)
        self.service.delete_edge(edge["id"])
        self.service.delete_node(node["id"])
        self.assertIsNone(self.service.find_name("Liquidity Signal"))

    def test_layout_updates_all_positions_atomically(self):
        self._flow()
        original = self.service.graph()["nodes"]
        positions = [{"id": node["id"], "position_x": index * 340,
                      "position_y": index * 160} for index, node in enumerate(original)]
        with self.assertRaises(GraphError):
            self.service.update_layout({"positions": positions[:-1] + [{**positions[-1], "position_x": float("nan")}]})
        self.assertEqual([(node["position_x"], node["position_y"]) for node in self.service.graph()["nodes"]],
                         [(node["position_x"], node["position_y"]) for node in original])
        self.assertEqual(self.service.update_layout({"positions": positions}), {"updated": len(original)})
        self.assertEqual([(node["position_x"], node["position_y"]) for node in self.service.graph()["nodes"]],
                         [(item["position_x"], item["position_y"]) for item in positions])

    def test_cycle_rejected(self):
        upstream, target, *_ = self._flow()
        upstream, downstream = upstream["id"], target["id"]
        with self.assertRaisesRegex(GraphError, "cycle"):
            self.service.create_edge({"upstream_id": downstream, "downstream_id": upstream})

    def test_catalog_field_can_be_added_and_connected_to_a_signal(self):
        catalog = CatalogStore()
        entity, field = catalog.get_field_definition("taoli.funding_rate.exchange")
        target = self.service.create_node({"name": "Catalog Test Signal", "type": "Metric"})
        first = self.service.use_catalog_field(entity, field, target["id"])
        second = self.service.use_catalog_field(entity, field, target["id"])
        self.assertEqual((first["source_node_id"], first["field_id"], first["edge_id"], first["usage_id"]),
                         (second["source_node_id"], second["field_id"], second["edge_id"], second["usage_id"]))
        self.assertTrue(first["source_created"] and first["field_created"])
        self.assertFalse(second["source_created"] or second["field_created"])
        imported = self.service.get_field(first["field_id"])
        self.assertEqual(imported["catalog_field_id"], field["id"])
        self.assertEqual(imported["example_value"], "")
        self.assertEqual(len(self.service.get_field_usages(first["edge_id"])), 1)
        entity, other = catalog.get_field_definition("taoli.funding_rate.symbol")
        next_result = self.service.use_catalog_field(entity, other, target["id"])
        self.assertEqual(next_result["source_node_id"], first["source_node_id"])
        self.assertEqual(next_result["edge_id"], first["edge_id"])
        self.assertEqual(len(self.service.get_field_usages(first["edge_id"])), 2)
        output = self.service.create_field(target["id"], {"name": "heat_score", "data_type": "number"})
        updated = self.service.update_field_usage(first["usage_id"], {"target_field_id": output["id"]})
        self.assertEqual(updated["target_field_id"], output["id"])
        with self.assertRaises(GraphError):
            self.service.update_field_usage(first["usage_id"], {"target_field_id": first["field_id"]})
        first_entity, first_source = catalog.get_field_definition(
            "kaito-social-spider.kaito_entity_mindshare_delta.data.entity.symbol")
        second_entity, second_source = catalog.get_field_definition(
            "kaito-social-spider.kaito_entity_mindshare_ranking.data.entity.symbol")
        first_kaito = self.service.use_catalog_field(first_entity, first_source, grouped=True)
        second_kaito = self.service.use_catalog_field(second_entity, second_source, grouped=True)
        self.assertEqual(self.service.get_field(first_kaito["field_id"])["name"],
                         self.service.get_field(second_kaito["field_id"])["name"])
        self.assertNotEqual(first_kaito["source_node_id"], second_kaito["source_node_id"])

    def test_catalog_field_can_be_removed_from_graph_with_its_connections(self):
        catalog = CatalogStore()
        target = self.service.create_node({"name": "Removal Test Signal", "type": "Metric"})
        need = self.service.create_requirement(target["id"], {"name": "Market cap"})
        entity, first_field = catalog.get_field_definition("taoli.funding_rate.exchange")
        _, second_field = catalog.get_field_definition("taoli.funding_rate.symbol")
        first = self.service.use_catalog_field(entity, first_field, target["id"], requirement_id=need["id"])
        second = self.service.use_catalog_field(entity, second_field, target["id"])

        removed = self.service.remove_catalog_field(first_field["id"])
        self.assertEqual(removed["source_node_id"], first["source_node_id"])
        self.assertIsNone(self.service.get_requirement(need["id"])["source_field_id"])
        self.assertEqual([usage["source_field_id"] for usage in self.service.get_field_usages(first["edge_id"])],
                         [second["field_id"]])
        self.assertFalse(any(field["id"] == first["field_id"] for field in self.service.graph()["fields"]))

        removed = self.service.remove_catalog_field(second_field["id"])
        graph = self.service.graph()
        self.assertTrue(any(node["id"] == first["source_node_id"] for node in graph["nodes"]))
        self.assertFalse(any(edge["id"] == first["edge_id"] for edge in graph["edges"]))
        with self.assertRaises(GraphError):
            self.service.remove_catalog_field(second_field["id"])

    def test_base_crawlers_are_seeded_once_and_cannot_be_deleted(self):
        catalog = CatalogStore()
        original_node_ids = {node["id"] for node in self.service.graph()["nodes"]}
        result = self.service.ensure_catalog_sources(catalog.entities)
        self.assertEqual(result, {"created": len(catalog.entities), "total": len(catalog.entities)})
        self.assertEqual(self.service.ensure_catalog_sources(catalog.entities)["created"], 0)
        sources = {node["name"]: node for node in self.service.graph()["nodes"]
                   if node["is_catalog_source"]}
        self.assertEqual(set(sources), set(catalog.entities))
        self.assertTrue(original_node_ids.issubset({node["id"] for node in self.service.graph()["nodes"]}))
        source = sources["taoli.funding_rate"]
        with self.assertRaisesRegex(GraphError, "cannot be deleted"):
            self.service.delete_node(source["id"])
        with self.assertRaisesRegex(GraphError, "cannot be renamed"):
            self.service.update_node(source["id"], {"name": "Renamed crawler"})
        with self.assertRaisesRegex(GraphError, "cannot be renamed"):
            self.service.update_node(source["id"], {"type": "Metric"})
        self.service.update_node(source["id"], {"position_x": -500})
        entity, field = catalog.get_field_definition("taoli.funding_rate.exchange")
        added = self.service.use_catalog_field(entity, field, actor="catalog")
        self.assertEqual(added["source_node_id"], source["id"])
        with self.assertRaisesRegex(GraphError, "cannot be deleted"):
            self.service.remove_catalog_field(field["id"])
        self.assertEqual(self.service.get_node(source["id"])["is_catalog_source"], 1)

    def test_v2_sync_retires_v1_field_without_erasing_signal_design(self):
        catalog = CatalogStore()
        signal = self.service.create_node({"name": "Existing Signal", "type": "Metric"})
        need = self.service.create_requirement(signal["id"], {"name": "旧数据需求"})
        legacy_entity = {"id": "taoli", "spider_id": "taoli",
                         "declared_entity_id": "taoli_funding_rate"}
        legacy_field = {"id": "taoli.taoli_funding_rate.funding_rate", "path": "funding_rate",
                        "type": "number", "plain_meaning": "旧目录声明"}
        old = self.service.use_catalog_field(legacy_entity, legacy_field, signal["id"],
                                             requirement_id=need["id"])
        entity, current = catalog.get_field_definition("taoli.funding_rate.exchange")
        new = self.service.use_catalog_field(entity, current, signal["id"], grouped=True)
        result = self.service.retire_catalog_fields({current["id"]})
        self.assertEqual(result, {"retired": 1})
        graph = self.service.graph()
        self.assertNotIn(old["field_id"], {field["id"] for field in graph["fields"]})
        self.assertIn(new["field_id"], {field["id"] for field in graph["fields"]})
        self.assertIsNone(self.service.get_requirement(need["id"])["source_field_id"])
        self.assertIn(old["edge_id"], {edge["id"] for edge in graph["edges"]})
        self.assertEqual(self.service.retire_catalog_fields({current["id"]}), {"retired": 0})

    def test_existing_crawler_field_usages_move_to_record_type_sources(self):
        catalog = CatalogStore()
        crawler = self.service.create_node({"name": "binance-futures", "type": "Source"})
        self.service.db.execute("UPDATE nodes SET is_catalog_source=1 WHERE id=?", (crawler["id"],))
        self.service.db.commit()
        signal = self.service.create_node({"name": "Existing OI signal", "type": "Metric"})
        old_edge = self.service.create_edge({"upstream_id": crawler["id"],
                                             "downstream_id": signal["id"],
                                             "transformation": "按交易对核对"})
        need = self.service.create_requirement(signal["id"], {"name": "交易对"})
        old_ids = []
        for entity_id in ("binance-futures.open_interest", "binance-futures.kline"):
            catalog_id = entity_id + ".symbol"
            field = self.service.create_field(crawler["id"],
                {"name": entity_id.split(".")[1] + ".symbol"}, actor="catalog")
            self.service.db.execute("UPDATE node_fields SET catalog_field_id=? WHERE id=?",
                                    (catalog_id, field["id"]))
            self.service.create_field_usage(old_edge["id"], {"source_field_id": field["id"]})
            old_ids.append(field["id"])
        self.service.db.execute("UPDATE data_requirements SET source_field_id=? WHERE id=?",
                                (old_ids[0], need["id"]))
        self.service.db.commit()
        self.service.ensure_catalog_sources(catalog.entities)
        self.assertEqual(self.service.rehome_catalog_fields(catalog.fields, catalog.spider_info),
                         {"moved": 2})
        graph = self.service.graph()
        by_id = {node["id"]: node["name"] for node in graph["nodes"]}
        moved = [field for field in graph["fields"] if field["id"] in old_ids]
        self.assertEqual({by_id[field["node_id"]] for field in moved},
                         {"binance-futures.open_interest", "binance-futures.kline"})
        self.assertEqual({field["name"] for field in moved}, {"symbol"})
        self.assertEqual(self.service.get_requirement(need["id"])["source_field_id"], old_ids[0])
        self.assertEqual(len(graph["field_usages"]), 2)
        self.assertEqual({by_id[edge["upstream_id"]] for edge in graph["edges"]},
                         {"binance-futures.open_interest", "binance-futures.kline"})
        self.assertIsNone(self.service.find_name("binance-futures"))
        self.assertEqual(self.service.rehome_catalog_fields(catalog.fields, catalog.spider_info),
                         {"moved": 0})

    def test_signal_can_request_data_before_a_crawler_field_exists(self):
        signal = self.service.create_node({"name": "Desired Heat Signal", "type": "Metric"})
        need = self.service.create_requirement(signal["id"], {
            "name": "独立讨论人数", "purpose": "判断热度是否由更多人推动",
            "expected_example": "24 小时内 1200 人"})
        self.assertIsNone(need["source_field_id"])
        self.assertEqual(self.service.graph()["requirements"][-1]["name"], "独立讨论人数")
        updated = self.service.update_requirement(need["id"], {"purpose": "排除少数账号刷量"})
        self.assertEqual(updated["purpose"], "排除少数账号刷量")
        catalog = CatalogStore()
        entity, field = catalog.get_field_definition("kaito-social-spider.kaito_feed_item.data.entity.symbol")
        result = self.service.use_catalog_field(entity, field, signal["id"], grouped=True,
                                                requirement_id=need["id"])
        self.assertEqual(self.service.get_requirement(need["id"])["source_field_id"], result["field_id"])
        output = self.service.create_field(signal["id"], {"name": "signal_value", "data_type": "number"})
        self.service.update_field_usage(result["usage_id"], {"target_field_id": output["id"]})
        repeated = self.service.use_catalog_field(entity, field, signal["id"], grouped=True,
                                                  requirement_id=need["id"])
        self.assertEqual(repeated["usage_id"], result["usage_id"])
        self.assertEqual(len(self.service.get_field_usages(result["edge_id"])), 1)
        with self.assertRaises(GraphError):
            self.service.use_catalog_field(entity, field, requirement_id=need["id"], grouped=True)
        self.service.delete_requirement(need["id"])
        self.assertEqual(self.service.get_requirements(signal["id"]), [])

    def test_proposal_is_reviewable_and_atomic(self):
        self.service.create_node({"name": "Volume", "type": "Raw Field"})
        self.service.create_node({"name": "Price Momentum", "type": "Metric"})
        before = self.service.graph()
        proposal = self.service.propose("创建 Liquidity Signal 指标，依赖 Volume 和 Price Momentum。")
        self.assertEqual(set(proposal["upstream_names"]), {"Volume", "Price Momentum"})
        self.assertEqual(self.service.graph(), before)
        created = self.service.apply_proposal(proposal)
        self.assertEqual({n["name"] for n in self.service.get_upstream(created["id"])}, {"Volume", "Price Momentum"})
        bad = self.service.propose("创建 Broken Signal，依赖 Volume。")
        bad["upstream_names"].append("missing reference")
        with self.assertRaises(GraphError):
            self.service.apply_proposal(bad)
        self.assertIsNone(self.service.find_name("Broken Signal"))

    def test_model_proposal_uses_schema_and_does_not_write(self):
        self.service.create_node({"name": "Volume", "type": "Raw Field"})
        draft = {"node": {"name": "Liquidity Signal", "type": "Metric", "definition": "Liquidity",
                 "formula": "volume / spread", "rationale": "Find liquid assets", "caveats": "Thin markets",
                 "notes": "Research"}, "upstream_names": ["Volume"], "downstream_names": [], "warnings": []}
        fake_response = {"status": "completed", "output": [{"type": "message", "content": [
            {"type": "output_text", "text": json.dumps(draft)}]}]}
        before = self.service.graph()
        with patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"}), patch(
            "graph_service.urlopen", return_value=io.BytesIO(json.dumps(fake_response).encode())) as call:
            proposal = self.service.propose("Create a liquidity signal from Volume")
        sent = json.loads(call.call_args.args[0].data)
        self.assertEqual(sent["text"]["format"]["type"], "json_schema")
        self.assertFalse(sent["store"])
        self.assertEqual(proposal["source"], "model")
        self.assertEqual(self.service.graph(), before)

    def test_fields_and_edge_usage_explain_a_derivation(self):
        source, target, _, _, output, _, edge, _ = self._flow()
        source_fields = self.service.get_fields(source["id"])
        self.assertEqual(len(source_fields), 2)
        usages = self.service.get_field_usages(edge["id"])
        self.assertEqual({self.service.get_field(item["source_field_id"])["name"] for item in usages},
                         {"posted_at"})
        self.assertTrue(all(self.service.get_field(item["target_field_id"])["name"] == "mention_count"
                            for item in usages))
        self.assertIn("去重", edge["transformation"])
        self.assertEqual(len(self.service.get_context(target["id"])["field_usages"]), 1)

    def test_redpanda_transport_records_headers_without_repeating_payload_fields(self):
        *_, edge, _ = self._flow()
        self.assertEqual(edge["transport_kind"], "unspecified")
        before_usages = self.service.get_field_usages(edge["id"])
        updated = self.service.update_edge(edge["id"], {
            "transport_kind": "redpanda", "transport_topic": "market.prices",
            "transport_key": "asset_symbol", "payload_schema": "price-event/v1",
            "consumer_group": "signalstudio.market_prices.v1",
            "transport_headers": [{"name": "source", "description": "采集源", "consumed": True},
                                  {"name": "trace_id", "description": "链路标识"}],
        })
        self.assertEqual(updated["transport_topic"], "market.prices")
        self.assertEqual(updated["consumer_group"], "signalstudio.market_prices.v1")
        self.assertEqual(json.loads(updated["transport_headers"])[1]["name"], "trace_id")
        self.assertTrue(json.loads(updated["transport_headers"])[0]["consumed"])
        self.assertEqual(self.service.get_field_usages(edge["id"]), before_usages)
        self.service.db.close()
        self.service = GraphService(self.path)
        self.assertEqual(self.service.get_edge(edge["id"])["payload_schema"], "price-event/v1")
        direct = self.service.update_edge(edge["id"], {"transport_kind": "direct"})
        self.assertEqual(direct["transport_topic"], "")
        self.assertEqual(direct["transport_headers"], "[]")
        self.assertEqual(direct["consumer_group"], "")

    def test_redpanda_transport_requires_valid_topic_and_headers(self):
        *_, edge, _ = self._flow()
        with self.assertRaisesRegex(GraphError, "topic is required"):
            self.service.update_edge(edge["id"], {"transport_kind": "redpanda"})
        with self.assertRaisesRegex(GraphError, "Invalid Redpanda headers"):
            self.service.update_edge(edge["id"], {"transport_kind": "redpanda", "transport_topic": "prices",
                                                  "transport_headers": {"trace_id": "wrong shape"}})
        with self.assertRaisesRegex(GraphError, "Duplicate Redpanda header"):
            self.service.update_edge(edge["id"], {"transport_kind": "redpanda", "transport_topic": "prices",
                                                  "transport_headers": [{"name": "trace_id"}, {"name": "TRACE_ID"}]})
        self.assertEqual(self.service.get_edge(edge["id"])["transport_kind"], "unspecified")

    def test_field_mapping_validates_endpoints_and_survives_rename(self):
        source, target, _, author, output, wrong, edge, _ = self._flow()
        with self.assertRaisesRegex(GraphError, "upstream node"):
            self.service.create_field_usage(edge["id"], {"source_field_id": wrong["id"]})
        with self.assertRaisesRegex(GraphError, "downstream node"):
            self.service.create_field_usage(edge["id"], {"source_field_id": author["id"],
                "target_field_id": wrong["id"]})
        usage = self.service.create_field_usage(edge["id"], {"source_field_id": author["id"],
            "target_field_id": output["id"], "usage_note": "用于去重作者"})
        self.service.update_field(author["id"], {"name": "author_identifier", "example_value": "user_123"})
        self.assertEqual(self.service.get_field(usage["source_field_id"])["name"], "author_identifier")
        with self.assertRaisesRegex(GraphError, "Remove this field"):
            self.service.delete_field(author["id"])
        self.service.db.close()
        self.service = GraphService(self.path)
        self.assertEqual(len(self.service.get_field_usages(edge["id"])), 2)
        self.assertEqual(self.service.get_field(author["id"])["example_value"], "user_123")
        self.service.delete_field_usage(usage["id"])
        self.service.delete_field(author["id"])
        self.assertEqual(len(self.service.get_fields(source["id"])), 1)

    def test_field_output_contract_is_saved_and_bounds_are_validated(self):
        node = self.service.create_node({"name": "Social Heat", "type": "Metric"})
        field = self.service.create_field(node["id"], {
            "name": "engagement_percent", "data_type": "Decimal", "unit": "%",
            "min_value": 0, "max_value": 100,
            "normalization_rule": "clamp(raw / baseline * 100, 0, 100)",
            "example_value": "73.4%",
        })
        self.assertEqual((field["unit"], field["min_value"], field["max_value"]), ("%", 0, 100))
        with self.assertRaisesRegex(GraphError, "Minimum value"):
            self.service.update_field(field["id"], {"min_value": 101})
        with self.assertRaisesRegex(GraphError, "finite"):
            self.service.update_field(field["id"], {"max_value": float("inf")})
        self.assertEqual(self.service.get_field(field["id"])["max_value"], 100)
        self.service.db.close()
        self.service = GraphService(self.path)
        saved = self.service.get_field(field["id"])
        self.assertEqual(saved["normalization_rule"], "clamp(raw / baseline * 100, 0, 100)")
        self.assertEqual(saved["example_value"], "73.4%")

    def test_deleting_node_removes_its_field_lineage(self):
        _, node, *_ = self._flow()
        self.service.delete_node(node["id"])
        graph = self.service.graph()
        self.assertFalse(any(field["node_id"] == node["id"] for field in graph["fields"]))
        edge_ids = {edge["id"] for edge in graph["edges"]}
        self.assertTrue(all(usage["edge_id"] in edge_ids for usage in graph["field_usages"]))


if __name__ == "__main__":
    unittest.main()
