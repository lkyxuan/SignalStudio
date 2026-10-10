"""Protect saved graph edits and versioned evidence during the SS-48 correction."""
import json
from pathlib import Path
import tempfile
import unittest

from card_model import CardModel
from graph_service import GraphService
from live_state import snapshot
from score_rollup_alignment import MARKER, ensure_score_rollup_alignment


class ScoreRollupAlignmentTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / "test.db")
        self.service.ensure_system_tables()
        self.current = self.service.find_name("asset_scores_current")
        self.scorer = self.service.create_node({"name": "计算当前资产评分", "type": "Score",
            "definition": "old scope", "position_x": 700, "position_y": 500,
            "notes": json.dumps({"custom": "keep", "configuration": {"custom": 17,
                "asset_scope": "all_registered_assets_including_pending_identity_and_zero_event_assets",
                "write_policy": "upsert_all_registered_assets_total_heat_if_not_older_including_zero"}})})
        with self.service.db:
            self.service.db.execute("UPDATE nodes SET is_system_state=0 WHERE id=?", (self.current["id"],))
            self.field = self.service.create_field(self.current["id"], {"name": "calculated_at",
                "definition": "读取时折算到实际查询时刻", "notes": "keep", "example_value": "original"}, commit=False)
            self.service.db.execute("UPDATE nodes SET is_system_state=1 WHERE id=?", (self.current["id"],))
        self.edge = self.service.create_edge({"upstream_id": self.scorer["id"], "downstream_id": self.current["id"]})
        self.model = CardModel(self.service)
        self.model.migrate()
        self.model.update_contract(self.scorer["id"], {"revision": 1, "config": {"environment": "testnet"}})
        self.service.db.commit()

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def rows(self, table):
        return [dict(row) for row in self.service.db.execute("SELECT * FROM " + table + " ORDER BY rowid")]

    def test_preserves_graph_and_reports_while_upgrading_owned_definitions(self):
        old_report = self.model.report({"package_revision": self.model.package()["package_revision"],
            "node_id": self.current["id"], "code_revision": "fixture", "evidence_ref": "fixture-only",
            "observations": {"implementation": "implemented"}, "reported_by": "test"})
        before = snapshot(self.service)
        reports = self.rows("graph_definition_reports")
        protected = {table: self.rows(table) for table in ("edges", "edge_field_usages", "edge_bindings", "data_schemas", "node_ports")}
        ensure_score_rollup_alignment(self.service)
        after = snapshot(self.service)
        self.assertEqual(before["presentation_revision"], after["presentation_revision"])
        self.assertEqual(reports, self.rows("graph_definition_reports"))
        for table, rows in protected.items():
            self.assertEqual(rows, self.rows(table), table)
        score = self.service.get_node(self.scorer["id"])
        notes = json.loads(score["notes"])
        self.assertEqual(notes["custom"], "keep")
        self.assertEqual(notes["configuration"]["custom"], 17)
        self.assertEqual(notes["configuration"]["asset_scope"], "asset_ids_with_total_heat_events_in_6001")
        self.assertEqual(notes["configuration"]["schedule"]["triggers"], ["event", "timer"])
        self.assertFalse(notes["configuration"]["schedule"]["query_triggers_calculation"])
        self.assertIn("有事件但合计为 0 仍保存", score["definition"])
        self.assertIn("空事件集合无输出", self.service.get_node(self.current["id"])["definition"])
        field = self.service.get_fields(self.current["id"])[0]
        self.assertEqual((field["id"], field["notes"], field["example_value"]), (self.field["id"], "keep", "original"))
        self.assertIn("不按查询时间再次衰减", field["definition"])
        self.assertEqual(self.model.contract(self.scorer["id"])["config"]["environment"], "testnet")
        progress = after["card_progress"][self.current["id"]]
        self.assertTrue(progress["stale"])
        self.assertIsNone(progress["report"])
        self.assertEqual(json.loads(reports[0]["report"])["definition_revision"], old_report["definition_revision"])
        issues = self.model.readiness([self.scorer["id"], self.current["id"]])["issues"]
        self.assertFalse(any(item["code"] == "definition_changed" for item in issues))
        package = self.model.package()
        exported = next(n for n in package["graph"]["nodes"] if n["id"] == self.scorer["id"])
        self.assertEqual(json.loads(exported["notes"])["configuration"], notes["configuration"])

        self.service.update_node(self.scorer["id"], {"definition": "later user edit"})
        after_edit = snapshot(self.service)
        ensure_score_rollup_alignment(self.service)
        self.assertEqual(after_edit, snapshot(self.service))

    def test_failure_rolls_back_all_changes_and_can_retry(self):
        before = snapshot(self.service)
        events = self.rows("change_events")
        from unittest.mock import patch
        with patch.object(CardModel, "validate_config", side_effect=ValueError("injected failure")):
            with self.assertRaisesRegex(ValueError, "injected failure"):
                ensure_score_rollup_alignment(self.service)
        self.assertEqual(before, snapshot(self.service))
        self.assertEqual(events, self.rows("change_events"))
        self.assertIsNone(self.service.db.execute("SELECT 1 FROM schema_meta WHERE key=?", (MARKER,)).fetchone())
        ensure_score_rollup_alignment(self.service)
        self.assertIsNotNone(self.service.db.execute("SELECT 1 FROM schema_meta WHERE key=?", (MARKER,)).fetchone())

    def test_missing_dependency_leaves_marker_unset(self):
        self.service.db.execute("DELETE FROM nodes WHERE id=?", (self.scorer["id"],))
        self.service.db.commit()
        ensure_score_rollup_alignment(self.service)
        self.assertIsNone(self.service.db.execute("SELECT 1 FROM schema_meta WHERE key=?", (MARKER,)).fetchone())


if __name__ == "__main__":
    unittest.main()
