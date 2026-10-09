import tempfile
import unittest
from pathlib import Path

from graph_service import GraphService
from initial_score_sources import MARKER, ensure_initial_score_sources


class InitialScoreSourcesTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.directory.name) / "test.db")
        self.service.ensure_system_tables()
        self.service.group_node_references_once()

    def tearDown(self):
        self.service.db.close()
        self.directory.cleanup()

    def dependencies(self):
        refs = (3002, 3004, 3006, 3009, 4001)
        nodes = [self.service.create_node({"name": f"step-{ref}", "type": "Score",
            "position_x": 700, "position_y": 500}) for ref in refs]
        with self.service.db:
            for node in nodes:
                self.service.db.execute("UPDATE nodes SET reference_number=-reference_number WHERE id=?", (node["id"],))
            for ref, node in zip(refs, nodes):
                self.service.db.execute("UPDATE nodes SET reference_number=? WHERE id=?", (ref, node["id"]))
            self.service.db.execute("UPDATE schema_meta SET value='3010' WHERE key='next_node_number_3'")
        return nodes

    def test_install_preserves_existing_positions_and_later_edits_and_is_idempotent(self):
        ensure_initial_score_sources(self.service)
        self.assertIsNone(self.service.find_name("asset_initial_score_sources"))
        nodes = self.dependencies()
        before = {n["id"]: (n["position_x"], n["position_y"]) for n in nodes}
        ensure_initial_score_sources(self.service)
        table = self.service.find_name("asset_initial_score_sources")
        self.assertEqual(table["is_system_state"], 1)
        self.assertTrue(1000 <= table["reference_number"] < 2000)
        self.assertEqual(len(self.service.get_fields(table["id"])), 5)
        scorer = self.service.get_node(nodes[3]["id"])
        self.assertIn("缺配置", scorer["definition"])
        for node_id, position in before.items():
            current = self.service.get_node(node_id)
            self.assertEqual((current["position_x"], current["position_y"]), position)
        edge = next(e for e in self.service.graph()["edges"] if e["upstream_id"] == table["id"])
        self.assertEqual(edge["downstream_id"], scorer["id"])
        self.assertEqual(len(self.service.get_field_usages(edge["id"])), 4)
        self.service.update_node(scorer["id"], {"formula": "later user edit"})
        graph = self.service.graph()
        ensure_initial_score_sources(self.service)
        self.assertEqual(graph, self.service.graph())

    def test_failure_rolls_back_table_fields_edges_and_processor_migration(self):
        self.dependencies()
        graph = self.service.graph()
        original = self.service.create_edge
        def fail(*args, **kwargs):
            raise RuntimeError("injected failure")
        self.service.create_edge = fail
        with self.assertRaisesRegex(RuntimeError, "injected"):
            ensure_initial_score_sources(self.service)
        self.assertEqual(graph, self.service.graph())
        self.assertIsNone(self.service.db.execute("SELECT 1 FROM schema_meta WHERE key=?", (MARKER,)).fetchone())
        self.service.create_edge = original
        ensure_initial_score_sources(self.service)
        self.assertIsNotNone(self.service.find_name("asset_initial_score_sources"))


if __name__ == '__main__':
    unittest.main()
