import json
import tempfile
import unittest
from pathlib import Path

from graph_service import GraphService
from leaderboard_scaffolds import CATALOG, MARKER, ensure_leaderboard_scaffolds


class LeaderboardScaffoldsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        self.service.ensure_system_tables()
        self.service.group_node_references_once()

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def test_independent_paths_preserve_existing_graph_and_restart_edits(self):
        before = self.service.graph()
        ensure_leaderboard_scaffolds(self.service)
        graph = self.service.graph()
        self.assertEqual(len(graph['nodes']) - len(before['nodes']), 15)
        self.assertEqual(len(graph['edges']), 10)
        for original in before['nodes']:
            self.assertEqual(self.service.get_node(original['id']), original)
        for board in json.loads(CATALOG.read_text())['boards']:
            cache, calc, table = [self.service.find_name(board[key]) for key in
                                  ('cache_name', 'calculator_name', 'table_name')]
            self.assertTrue(6000 < cache['reference_number'] < 7000)
            self.assertTrue(3000 < calc['reference_number'] < 4000)
            self.assertTrue(1000 < table['reference_number'] < 2000)
            self.assertEqual(table['is_system_state'], 1)
            self.assertEqual({(e['upstream_id'], e['downstream_id']) for e in graph['edges']
                              if e['upstream_id'] in (cache['id'], calc['id'])},
                             {(cache['id'], calc['id']), (calc['id'], table['id'])})
        self.service.update_node(calc['id'], {'formula': 'User future design'})
        saved = self.service.graph()
        ensure_leaderboard_scaffolds(self.service)
        self.assertEqual(saved, self.service.graph())

    def test_conflict_does_not_partially_install(self):
        board = json.loads(CATALOG.read_text())['boards'][-1]
        self.service.create_node({'name': board['calculator_name'], 'type': 'Score'})
        before = self.service.graph()
        with self.assertRaises(ValueError):
            ensure_leaderboard_scaffolds(self.service)
        self.assertEqual(before, self.service.graph())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())

    def test_failed_install_rolls_back_all_writes(self):
        before = self.service.graph()
        create_edge = self.service.create_edge
        def fail(*args, **kwargs):
            raise RuntimeError('simulated interruption')
        self.service.create_edge = fail
        with self.assertRaises(RuntimeError):
            ensure_leaderboard_scaffolds(self.service)
        self.assertEqual(before, self.service.graph())
        self.service.create_edge = create_edge
        ensure_leaderboard_scaffolds(self.service)
        self.assertEqual(len(self.service.graph()['nodes']), len(before['nodes']) + 15)
