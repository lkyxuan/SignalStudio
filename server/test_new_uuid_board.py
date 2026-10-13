import copy
import json
import unittest
from unittest.mock import patch

from card_model import CardModel, encoded
from application_interfaces import ensure_application_interfaces
from homepage_interface import ensure_homepage_interface
from retire_market_discovery import ensure_retire_market_discovery
from repair_discovery_digests import ensure_repair_discovery_digests
from new_uuid_board import ensure_new_uuid_board, MARKER, PATH
import test_retire_market_discovery


class NewUuidBoardTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_retire_market_discovery.RetireDiscoveryTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_retire_market_discovery(self.s)
        ensure_application_interfaces(self.s)
        ensure_homepage_interface(self.s)
        ensure_repair_discovery_digests(self.s)
        self.model = CardModel(self.s)

    def tearDown(self):
        self.fixture.tearDown()

    def snapshot(self):
        return {r[0]: [tuple(row) for row in self.s.db.execute('SELECT * FROM ' + r[0])]
                for r in self.s.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    def test_install_preserves_identity_positions_and_retirement_with_three_inputs(self):
        before = copy.deepcopy(self.s.graph())
        ensure_new_uuid_board(self.s)
        after = self.s.graph()
        self.assertEqual(len(after['nodes']), len(before['nodes']) + 2)
        for node in before['nodes']:
            updated = self.s.get_node(node['id'])
            for key in ('id', 'reference_number', 'position_x', 'position_y'):
                self.assertEqual(node[key], updated[key])
        candidate = self.s.find_name('候选代币筛选')
        names = {n['id']: n['name'] for n in after['nodes']}
        inputs = {names[e['upstream_id']] for e in after['edges'] if e['downstream_id'] == candidate['id']}
        self.assertEqual(inputs, {'leaderboard_warming', 'leaderboard_hottest', 'leaderboard_new_uuid'})
        ui = self.s.find_name('榜单与信号首页')
        bindings = [b for b in after['bindings'] if b['edge_id'] in
                    {e['id'] for e in after['edges'] if e['downstream_id'] == ui['id']}]
        self.assertEqual(len(bindings), 4)
        self.assertTrue(all(b['kind'] == 'reference' and b['config']['trigger'] == 'none' for b in bindings))
        self.assertFalse(self.s.get_fields(self.s.find_name('leaderboard_emerging')['id']))
        self.assertIsNone(self.s.find_name('记录首次有效发现'))
        package = self.model.package()
        body = package['definitions'][PATH]['body']
        self.assertEqual(body['observed_rows'], [])
        self.assertIsNone(body['score_contribution'])
        self.assertEqual(len(package['definitions']['catalog/content-refresh.v1.json']['body']['boards']), 3)
        self.assertFalse(any(i['code'] == 'definition_changed' for i in self.model.readiness()['issues']))
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        saved = self.snapshot()
        ensure_new_uuid_board(self.s)
        self.assertEqual(saved, self.snapshot())

    def test_transaction_failure_rolls_back_every_table_and_allocation(self):
        before = self.snapshot()
        with patch.object(self.s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_new_uuid_board(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_new_uuid_board(self.s)

    def test_edited_definition_and_unknown_revision_refuse_without_mutation(self):
        candidate = self.s.find_name('候选代币筛选')
        self.s.update_node(candidate['id'], {'formula': 'user change'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'edited candidate'):
            ensure_new_uuid_board(self.s)
        self.assertEqual(before, self.snapshot())

    def test_unrelated_fields_and_connections_survive_and_unknown_refs_roll_back(self):
        extra = self.s.create_node({'name': 'user consumer', 'kind': 'process'})
        asset = self.s.find_name('assets')
        edge = self.s.create_edge({'upstream_id': asset['id'], 'downstream_id': extra['id']})
        original = self.s.get_node(extra['id'])
        node = self.s.find_name('量价评分 · 生成贡献')
        cfg = self.model.contract(node['id'])['config']
        cfg['definition_refs'][0]['revision'] = 'unknown-user-version'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(cfg), node['id']))
        self.s.db.commit()
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'unrecognized definition'):
            ensure_new_uuid_board(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertEqual(original, self.s.get_node(extra['id']))
        self.assertEqual(edge, self.s.get_edge(edge['id']))


if __name__ == '__main__':
    unittest.main()
