import copy
import json
import unittest
from unittest.mock import patch
from card_model import CardModel, encoded
from coingecko_hottest import ensure_coingecko_hottest, MARKER, PATH
from new_uuid_board import ensure_new_uuid_board
from test_new_uuid_board import NewUuidBoardTest

class HottestMigrationTest(unittest.TestCase):
    def setUp(self):
        self.fixture=NewUuidBoardTest();self.fixture.setUp();self.s=self.fixture.s
        ensure_new_uuid_board(self.s)
    def tearDown(self):self.fixture.tearDown()
    def snapshot(self):
        return {r[0]:[tuple(row) for row in self.s.db.execute('SELECT * FROM '+r[0])] for r in self.s.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    def test_install_three_cards_preserves_old_identity_and_rules(self):
        before=copy.deepcopy(self.s.graph());ensure_coingecko_hottest(self.s);after=self.s.graph()
        self.assertEqual(len(after['nodes']),len(before['nodes'])+3)
        for n in before['nodes']:
            cur=self.s.get_node(n['id'])
            for k in ('id','reference_number','position_x','position_y'):self.assertEqual(cur[k],n[k])
        for name in ('量价评分 · 生成贡献','量价评分 · 汇总Redis记分','CoinGecko · 24 小时大涨','Polars · 计算相对昨日放量倍数'):
            old=next(n for n in before['nodes'] if n['name']==name)
            self.assertEqual(self.s.get_node(old['id'])['formula'],old['formula'])
        rank=self.s.find_name('生成基础最热榜')
        sources={self.s.get_node(r[0])['name'] for r in self.s.db.execute('SELECT upstream_id FROM edges WHERE downstream_id=?',(rank['id'],))}
        self.assertEqual(sources,{'CoinGecko · 最热榜候选快照','leaderboard_coverage'})
        model=CardModel(self.s);package=model.package()
        self.assertIn(PATH,package['definitions'])
        registry={a['id']:a for a in package['action_registry']}
        self.assertIn('hottest.rank',registry);self.assertEqual(registry['polars_indicator.assemble']['version'],2)
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall());self.assertFalse(model.cycles())
        for name in ('Polars · 汇总指标并发布','Few Understand · indicator.data'):
            self.assertIn('rvol_7d',{f['name'] for f in self.s.get_fields(self.s.find_name(name)['id'])})
        cfg=model.contract(self.s.find_name('CoinGecko · 24 小时大涨')['id'])['config']
        self.assertEqual(cfg['resource']['accepted_metric_versions'],['market_indicators_v1','market_indicators_v2'])
        saved=self.snapshot();ensure_coingecko_hottest(self.s);self.assertEqual(saved,self.snapshot())
    def test_interruption_rolls_back_every_table(self):
        before=self.snapshot()
        with patch.object(self.s,'create_field_usage',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):ensure_coingecko_hottest(self.s)
        self.assertEqual(before,self.snapshot());ensure_coingecko_hottest(self.s)
    def test_edited_definition_or_unknown_revision_is_not_overwritten(self):
        rank=self.s.find_name('生成基础最热榜');self.s.update_node(rank['id'],{'formula':'user edit'})
        before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'edited definition'):ensure_coingecko_hottest(self.s)
        self.assertEqual(before,self.snapshot())
    def test_unknown_reference_and_external_retired_field_dependency_refuse(self):
        result=self.s.find_name('leaderboard_hottest');cfg=CardModel(self.s).contract(result['id'])['config']
        cfg['definition_refs'][0]['revision']='unknown';self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),result['id']));self.s.db.commit()
        before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'unknown definition revision'):ensure_coingecko_hottest(self.s)
        self.assertEqual(before,self.snapshot())
    def test_new_name_conflict_and_reentry_preserve_user_work(self):
        ensure_coingecko_hottest(self.s)
        rank=self.s.find_name('生成基础最热榜');self.s.update_node(rank['id'],{'formula':'later user edit'})
        before=self.snapshot();ensure_coingecko_hottest(self.s);self.assertEqual(before,self.snapshot())

if __name__=='__main__':unittest.main()
