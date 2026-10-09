import copy
import json
from unittest.mock import patch
from leaderboard_simple import ensure_leaderboard_simple, CATALOG, MARKER
import tempfile
import unittest
from pathlib import Path
from graph_service import GraphService
from source_contract_store import SourceContractStore
from leaderboard_scaffolds import ensure_leaderboard_scaffolds
from leaderboard_algorithms import ensure_leaderboard_algorithms


class LeaderboardSimpleTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        self.service.ensure_system_tables()
        source = SourceContractStore().contract
        self.service.ensure_source_contract_sources(source['operations'] + source['resources'])
        self.service.group_node_references_once()
        ensure_leaderboard_scaffolds(self.service)

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def test_simple_upgrade_keeps_existing_hot_and_replaces_four_dependencies(self):
        ensure_leaderboard_algorithms(self.service)
        before = self.service.graph()
        catalog = json.loads(CATALOG.read_text())
        targeted = {b[r] for b in catalog['boards'] for r in ('cache_name', 'calculator_name', 'table_name')}
        ensure_leaderboard_simple(self.service)
        after = self.service.graph()
        self.assertEqual(len(after['nodes']), len(before['nodes']) + 2)
        for node in before['nodes']:
            updated = self.service.get_node(node['id'])
            if node['name'] not in targeted:
                self.assertEqual(node, updated)
            self.assertEqual((node['reference_number'], node['position_x'], node['position_y']),
                             (updated['reference_number'], updated['position_x'], updated['position_y']))
        for board in catalog['boards']:
            calc = self.service.find_name(board['calculator_name'])
            self.assertEqual(calc['formula'], board['formula'])
            for role, columns in [('cache_name', board['input_schema']), ('calculator_name', catalog['columns']), ('table_name', catalog['columns'])]:
                node = self.service.find_name(board[role])
                self.assertEqual({f['name'] for f in self.service.get_fields(node['id'])}, {c['name'] for c in columns})
            cache = self.service.find_name(board['cache_name'])
            source_names = {self.service.get_node(e['upstream_id'])['name'] for e in after['edges'] if e['downstream_id'] == cache['id']}
            self.assertEqual(source_names, set(board['sources']))
        self.service.update_node(calc['id'], {'formula': 'Later simple edit'})
        saved = copy.deepcopy(self.service.graph())
        ensure_leaderboard_simple(self.service)
        self.assertEqual(saved, self.service.graph())

    def test_simple_failure_rolls_back_then_retry(self):
        ensure_leaderboard_algorithms(self.service)
        before = self.service.graph()
        with patch.object(self.service, 'create_edge', side_effect=RuntimeError('interruption')):
            with self.assertRaises(RuntimeError):
                ensure_leaderboard_simple(self.service)
        self.assertEqual(before, self.service.graph())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_leaderboard_simple(self.service)

    def test_simple_conflict_preserves_custom_rule(self):
        ensure_leaderboard_algorithms(self.service)
        board = json.loads(CATALOG.read_text())['boards'][0]
        node = self.service.find_name(board['calculator_name'])
        self.service.update_node(node['id'], {'formula': 'custom'})
        before = self.service.graph()
        with self.assertRaises(ValueError):
            ensure_leaderboard_simple(self.service)
        self.assertEqual(before, self.service.graph())

    def test_simple_case_arithmetic(self):
        catalog = json.loads(CATALOG.read_text())
        self.assertEqual({b['key'] for b in catalog['boards']}, {'warming', 'cooling', 'emerging', 'divergence'})
        for board in catalog['boards']:
            values = board['case']['input']
            expected = {
                'warming': lambda: values['current_score'] - values['previous_score'],
                'cooling': lambda: values['previous_score'] - values['current_score'],
                'emerging': lambda: 24 - values['age_hours'],
                'divergence': lambda: min(values['long_authors'], values['short_authors']),
            }[board['key']]()
            self.assertEqual(board['case']['score'], expected)
