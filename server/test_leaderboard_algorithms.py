import json
import math
import tempfile
import unittest
from pathlib import Path

from graph_service import GraphService
from source_contract_store import SourceContractStore
from leaderboard_scaffolds import CATALOG, ensure_leaderboard_scaffolds
from leaderboard_algorithms import MARKER, ensure_leaderboard_algorithms


class LeaderboardAlgorithmsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        self.service.ensure_system_tables()
        source = SourceContractStore().contract
        self.service.ensure_source_contract_sources(source['operations'] + source['resources'])
        self.service.group_node_references_once()
        ensure_leaderboard_scaffolds(self.service)
        self.catalog = json.loads(CATALOG.read_text())

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def test_upgrade_preserves_ids_positions_unrelated_work_and_later_edits(self):
        before = self.service.graph()
        ensure_leaderboard_algorithms(self.service)
        after = self.service.graph()
        self.assertEqual(len(after['nodes']) - len(before['nodes']), 9)
        for original in before['nodes']:
            node = self.service.get_node(original['id'])
            self.assertEqual((node['reference_number'], node['position_x'], node['position_y']),
                             (original['reference_number'], original['position_x'], original['position_y']))
            if not any(original['name'] in [b['cache_name'], b['calculator_name'], b['table_name']]
                       for b in self.catalog['boards']):
                self.assertEqual(node, original)
        for board in self.catalog['boards']:
            cache, calc, table = [self.service.find_name(board[role]) for role in
                                  ('cache_name', 'calculator_name', 'table_name')]
            self.assertEqual(calc['formula'], board['algorithm']['formula'])
            self.assertEqual({f['name'] for f in self.service.get_fields(table['id'])},
                             {f['name'] for f in self.catalog['columns']})
            self.assertEqual(table['is_system_state'], 1)
            for edge in [e for e in after['edges'] if e['downstream_id'] in (cache['id'], calc['id'], table['id'])]:
                self.assertTrue(any(u['edge_id'] == edge['id'] for u in after['field_usages']))
        self.service.update_node(calc['id'], {'formula': 'Later user edit'})
        saved = self.service.graph()
        ensure_leaderboard_algorithms(self.service)
        self.assertEqual(saved, self.service.graph())

    def test_conflicts_and_custom_scaffolds_never_overwrite_user_work(self):
        calc = self.service.find_name(self.catalog['boards'][0]['calculator_name'])
        self.service.update_node(calc['id'], {'formula': 'Custom rule'})
        before = self.service.graph()
        with self.assertRaises(ValueError):
            ensure_leaderboard_algorithms(self.service)
        self.assertEqual(before, self.service.graph())

    def test_mid_upgrade_failure_rolls_back_then_can_retry(self):
        before = self.service.graph()
        create = self.service.create_edge
        self.service.create_edge = lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError('interruption'))
        with self.assertRaises(RuntimeError):
            ensure_leaderboard_algorithms(self.service)
        self.assertEqual(before, self.service.graph())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        self.service.create_edge = create
        ensure_leaderboard_algorithms(self.service)

    def test_design_case_arithmetic_and_versions(self):
        # Independent arithmetic checks for the displayed specified cases, not signal validation.
        expected = {
            'hottest': 1 + 0.5 + 0.25,
            'warming': math.log(12 / 4) * math.log(11),
            'emerging': 100 * 0.5 * 1.5,
            'cooling': 0.5 * math.log(21),
            'divergence': 4 * 4 * 2 / 36 * math.log(7),
        }
        for board in self.catalog['boards']:
            self.assertAlmostEqual(board['case']['score'], expected[board['key']])
            self.assertEqual(board['case']['provenance'], 'synthetic_design_case')
            self.assertEqual(board['algorithm']['version'], board['key'] + '/v1')
            self.assertFalse(board['schedule']['execution_observed'])


if __name__ == '__main__':
    unittest.main()
