import copy
import json
import unittest
from unittest.mock import patch
from board_display_limit import ensure_board_display_limit
from coingecko_warming import ensure_coingecko_warming, ensure_warming_v3, V3_MARKER
from card_model import CardModel, encoded
from test_coingecko_warming import WarmingMigrationTest


class WarmingV3Test(unittest.TestCase):
    def setUp(self):
        self.fixture = WarmingMigrationTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_coingecko_warming(self.s)
        ensure_board_display_limit(self.s)

    def tearDown(self):
        self.fixture.tearDown()

    def dump(self):
        return list(self.s.db.iterdump())

    def test_upgrade_preserves_identity_layout_unrelated_cards_and_is_idempotent(self):
        before = copy.deepcopy(self.s.graph())
        ensure_warming_v3(self.s)
        owned = {'生成基础升温榜', 'leaderboard_warming', 'CoinGecko · 计算升温日冻结基准', 'CoinGecko · 升温候选快照'}
        self.assertEqual(len(before['nodes']), len(self.s.graph()['nodes']))
        for old in before['nodes']:
            new = self.s.get_node(old['id'])
            for key in ('id','reference_number','position_x','position_y','is_system_state'):
                self.assertEqual(old[key],new[key])
            if old['name'] not in owned:
                self.assertEqual(old['definition'],new['definition'])
                self.assertEqual(old['formula'],new['formula'])
        n = self.s.find_name('CoinGecko · 计算升温小时基准')
        self.assertIn('75分钟',n['formula'])
        self.assertNotIn('daily_cache_key',CardModel(self.s).contract(n['id'])['config']['resource'])
        result = self.s.find_name('leaderboard_warming')
        self.assertTrue({'baseline_hours','is_new','is_new_asset'} <= {f['name'] for f in self.s.get_fields(result['id'])})
        self.assertFalse(self.s.db.execute('pragma foreign_key_check').fetchall())
        self.s.update_node(n['id'],{'formula':'later edit'})
        before=self.dump();ensure_warming_v3(self.s);self.assertEqual(before,self.dump())

    def test_edit_or_unknown_pin_refuses_without_mutation(self):
        rank = self.s.find_name('生成基础升温榜')
        self.s.update_node(rank['id'],{'formula':'user edit'})
        before=self.dump()
        with self.assertRaisesRegex(ValueError,'edited definition'):ensure_warming_v3(self.s)
        self.assertEqual(before,self.dump())

    def test_interruption_rolls_back_all_tables(self):
        before=self.dump()
        with patch.object(self.s,'create_field_usage',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):ensure_warming_v3(self.s)
        self.assertEqual(before,self.dump())
        ensure_warming_v3(self.s)

    def test_unknown_revision_refuses(self):
        node=self.s.find_name('生成基础升温榜');cfg=CardModel(self.s).contract(node['id'])['config']
        cfg['definition_refs'][0]['revision']='unknown'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),node['id']));self.s.db.commit()
        before=self.dump()
        with self.assertRaisesRegex(ValueError,'unknown definition revision'):ensure_warming_v3(self.s)
        self.assertEqual(before,self.dump())
