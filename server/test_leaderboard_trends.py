import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from graph_service import GraphService
from source_contract_store import SourceContractStore
from leaderboard_scaffolds import ensure_leaderboard_scaffolds
from leaderboard_algorithms import ensure_leaderboard_algorithms
from leaderboard_simple import ensure_leaderboard_simple
from leaderboard_trends import ensure_leaderboard_trends, CATALOG, MARKER
from content_refresh import ensure_content_refresh
from card_model import CardModel


class ThreeBoardDesignTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        self.service.ensure_system_tables()
        sources = SourceContractStore().contract
        self.service.ensure_source_contract_sources(sources['operations'] + sources['resources'])
        self.service.group_node_references_once()
        ensure_leaderboard_scaffolds(self.service)
        ensure_leaderboard_algorithms(self.service)
        ensure_leaderboard_simple(self.service)
        ensure_content_refresh(self.service)
        self.model = CardModel(self.service)
        self.model.migrate()
        self.catalog = json.loads(CATALOG.read_text())

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def test_migration_keeps_ids_positions_and_unrelated_rows_and_is_idempotent(self):
        before = self.service.graph()
        targeted = set(self.catalog['previous_nodes'])
        ensure_leaderboard_trends(self.service)
        after = self.service.graph()
        for node in before['nodes']:
            if node['name'] in self.catalog['retire_names']:
                self.assertIsNone(self.service.find_name(node['name']))
                continue
            updated = self.service.get_node(node['id'])
            self.assertEqual((node['reference_number'], node['position_x'], node['position_y']),
                             (updated['reference_number'], updated['position_x'], updated['position_y']))
            if node['name'] not in targeted:
                self.assertEqual({k:node[k] for k in updated}, updated)
        self.assertEqual(len(after['nodes']), len(before['nodes']) - len(self.catalog['retire_names']))
        self.assertEqual(self.catalog['frontend']['slots'], {'1':'warming', '2':'hottest', '5':'discoveries'})
        self.assertIsNone(self.service.find_name('leaderboard_cooling'))
        self.assertIsNotNone(self.service.find_name('asset_attention_states'))
        for spec in self.catalog['nodes']:
            node = self.service.find_name(spec['name'])
            incoming = {self.service.get_node(e['upstream_id'])['name'] for e in after['edges'] if e['downstream_id']==node['id']}
            self.assertEqual(incoming, set(spec['sources']))
            self.assertEqual({f['name'] for f in self.service.get_fields(node['id'])}, {f['name'] for f in spec['columns']})
        self.assertFalse(self.service.db.execute('PRAGMA foreign_key_check').fetchall())
        saved = copy.deepcopy(self.service.graph())
        ensure_leaderboard_trends(self.service)
        self.assertEqual(saved, self.service.graph())

    def test_definition_and_dependency_conflicts_preserve_entire_graph(self):
        node = self.service.find_name('计算升温榜得分')
        self.service.update_node(node['id'], {'formula':'custom formula'})
        before = self.service.graph()
        with self.assertRaisesRegex(ValueError, 'changed'):
            ensure_leaderboard_trends(self.service)
        self.assertEqual(before, self.service.graph())

    def test_interruption_rolls_back_retirements_fields_and_contracts(self):
        before = self.model.package()
        with patch.object(self.service, 'create_field', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_leaderboard_trends(self.service)
        self.assertEqual(before, self.model.package())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_leaderboard_trends(self.service)

    def test_package_has_current_contract_and_no_invented_parameter_or_implementation(self):
        ensure_leaderboard_trends(self.service)
        package = self.model.package()
        self.assertEqual(package['definitions']['catalog/leaderboard-trends.v1.json']['body'], self.catalog)
        self.assertIsNone(self.catalog['execution']['parameters'])
        self.assertTrue(self.catalog['execution']['no_numeric_fallback'])
        actions = {x['id'] for x in package['action_registry']}
        for spec in self.catalog['nodes']:
            config = self.model.contract(self.service.find_name(spec['name'])['id'])['config']
            self.assertEqual(config['action']['implementation'], 'unknown')
            self.assertTrue(config['draft'])
            if spec['role']=='process':
                self.assertIn(config['action']['id'], actions)


if __name__ == '__main__':
    unittest.main()
