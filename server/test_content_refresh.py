import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from graph_service import GraphService
from source_contract_store import SourceContractStore
from leaderboard_simple import ensure_leaderboard_simple
from leaderboard_scaffolds import ensure_leaderboard_scaffolds
from content_refresh import ensure_content_refresh, CATALOG, MARKER


class ContentRefreshTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        self.service.ensure_system_tables()
        sources = SourceContractStore().contract
        self.service.ensure_source_contract_sources(sources['operations'] + sources['resources'])
        self.service.group_node_references_once()
        ensure_leaderboard_scaffolds(self.service)
        ensure_leaderboard_simple(self.service)

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def test_install_is_additive_focused_and_idempotent(self):
        before = self.service.graph()
        ensure_content_refresh(self.service)
        after = self.service.graph()
        catalog = json.loads(CATALOG.read_text())
        self.assertEqual(len(after['nodes']), len(before['nodes']) + 2)
        self.assertEqual(len(after['edges']), len(before['edges']) + 8)
        for node in before['nodes']:
            self.assertEqual(node, self.service.get_node(node['id']))
        engine = self.service.find_name(catalog['node']['name'])
        result = self.service.find_name(catalog['result']['name'])
        self.assertEqual(result['is_system_state'], 1)
        self.assertGreaterEqual(engine['reference_number'], 3000)
        self.assertLess(result['reference_number'], 2000)
        for board in catalog['boards']:
            source = self.service.find_name(board['table_name'])
            edge = next(e for e in after['edges'] if e['upstream_id'] == source['id'] and e['downstream_id'] == engine['id'])
            usages = [u for u in after['field_usages'] if u['edge_id'] == edge['id']]
            field_ids = {u['source_field_id'] for u in usages}
            used = {f['name'] for f in after['fields'] if f['id'] in field_ids}
            self.assertEqual(used, set(board['consumed_fields']))
        self.service.update_node(engine['id'], {'formula': 'Later user design'})
        saved = copy.deepcopy(self.service.graph())
        ensure_content_refresh(self.service)
        self.assertEqual(saved, self.service.graph())

    def test_partial_failure_rolls_back_nodes_edges_fields_and_marker(self):
        before = self.service.graph()
        with patch.object(self.service, 'create_edge', side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError):
                ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_content_refresh(self.service)

    def test_existing_name_is_not_overwritten(self):
        catalog = json.loads(CATALOG.read_text())
        self.service.create_node({'name': catalog['node']['name'], 'type': 'Metric'})
        before = self.service.graph()
        with self.assertRaises(ValueError):
            ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())

    def test_missing_prerequisite_rejects_before_mutation(self):
        before = self.service.graph()
        original = self.service.find_name
        with patch.object(self.service, 'find_name', side_effect=lambda name: None if name == 'leaderboard_warming' else original(name)):
            with self.assertRaises(ValueError):
                ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())


if __name__ == '__main__':
    unittest.main()
