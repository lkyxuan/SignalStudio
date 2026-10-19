import copy
import hashlib
import json
import unittest
from unittest.mock import patch
from board_display_limit import ensure_board_display_limit, ROOT, SNAPSHOT
from card_model import CardModel, encoded
from coingecko_warming import ensure_coingecko_warming
import test_coingecko_warming


class BoardDisplayLimitTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_coingecko_warming.WarmingMigrationTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_coingecko_warming(self.s)
        # Reproduce an installed pre-SS131 workspace with frozen old definitions.
        before = json.loads((ROOT / SNAPSHOT).read_text())
        for path, saved in before.items():
            spec = saved['spec']
            if 'cards' in spec:
                for card in spec['cards']:
                    self.s.db.execute('UPDATE nodes SET definition=?,formula=? WHERE name=?',
                                      (card['description_zh'], card['algorithm_zh'], card['name']))
            else:
                self.s.db.execute('UPDATE nodes SET formula=? WHERE name=?',
                                  ('\n'.join(spec['requirements_zh']), spec['calculator_name']))
        for row in self.s.db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            cfg = json.loads(row['config'])
            def reset(obj):
                if isinstance(obj, dict):
                    if obj.get('path') in before and 'revision' in obj:
                        obj['revision'] = before[obj['path']]['digest']
                    for value in obj.values(): reset(value)
                elif isinstance(obj, list):
                    for value in obj: reset(value)
            reset(cfg)
            self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(cfg), row['node_id']))
        self.s.db.commit()

    def tearDown(self):
        self.fixture.tearDown()

    def dump(self):
        return list(self.s.db.iterdump())

    def test_upgrade_preserves_layout_edges_and_refresh_capacity(self):
        before = copy.deepcopy(self.s.graph())
        candidate = self.s.find_name('候选代币筛选')
        ensure_board_display_limit(self.s)
        after = self.s.graph()
        self.assertEqual(before['edges'], after['edges'])
        self.assertEqual(len(before['nodes']), len(after['nodes']))
        for n in before['nodes']:
            updated = self.s.get_node(n['id'])
            for key in ('id', 'reference_number', 'position_x', 'position_y'):
                self.assertEqual(n[key], updated[key])
        self.assertEqual(candidate['formula'], self.s.get_node(candidate['id'])['formula'])
        for name in ('生成基础最热榜', 'leaderboard_hottest', '生成基础升温榜', 'leaderboard_warming', '生成最新UUID榜'):
            n = self.s.find_name(name)
            self.assertIn('50', n['definition'] + n['formula'])
        for path in json.loads((ROOT / SNAPSHOT).read_text()):
            expected = hashlib.sha256((ROOT / path).read_bytes()).hexdigest()
            for row in self.s.db.execute('SELECT config FROM node_contracts'):
                for ref in json.loads(row[0]).get('definition_refs', []):
                    if ref['path'] == path: self.assertEqual(expected, ref['revision'])
        n = self.s.find_name('生成基础升温榜')
        self.s.update_node(n['id'], {'formula': 'later user edit'})
        before = self.dump(); ensure_board_display_limit(self.s)
        self.assertEqual(before, self.dump())

    def test_unknown_revision_or_user_edit_rolls_back(self):
        model = CardModel(self.s)
        node = self.s.find_name('生成基础升温榜')
        cfg = model.contract(node['id'])['config']
        cfg['definition_refs'][0]['revision'] = 'unknown'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(cfg), node['id']))
        self.s.db.commit()
        before = self.dump()
        with self.assertRaisesRegex(ValueError, 'unknown definition revision'): ensure_board_display_limit(self.s)
        self.assertEqual(before, self.dump())

    def test_interruption_rolls_back(self):
        before = self.dump()
        with patch.object(self.s, '_event', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'): ensure_board_display_limit(self.s)
        self.assertEqual(before, self.dump())
