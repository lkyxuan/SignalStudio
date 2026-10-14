import copy
import unittest
from unittest.mock import patch
from card_model import CardModel, encoded
from coingecko_hottest import ensure_coingecko_hottest
from hottest_warmup import ensure_hottest_warmup
from coingecko_warming import ensure_coingecko_warming, PATH, MARKER
import test_coingecko_hottest


class WarmingMigrationTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_coingecko_hottest.HottestMigrationTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_coingecko_hottest(self.s)
        ensure_hottest_warmup(self.s)

    def tearDown(self):
        self.fixture.tearDown()

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_install_preserves_old_identity_positions_hottest_scores_and_outputs(self):
        before = copy.deepcopy(self.s.graph())
        ensure_coingecko_warming(self.s)
        after = self.s.graph()
        self.assertEqual(len(after['nodes']), len(before['nodes'])+2)
        for n in before['nodes']:
            cur = self.s.get_node(n['id'])
            for k in ('id','reference_number','position_x','position_y'):
                self.assertEqual(cur[k],n[k])
            if n['name'] not in ('生成基础升温榜','leaderboard_warming'):
                self.assertEqual(cur['formula'],n['formula'])
        rank = self.s.find_name('生成基础升温榜')
        sources = {self.s.get_node(r[0])['name'] for r in self.s.db.execute('SELECT upstream_id FROM edges WHERE downstream_id=?',(rank['id'],))}
        self.assertEqual(sources, {'CoinGecko · 升温候选快照','CoinGecko · 计算升温日冻结基准','coingecko_market_history','leaderboard_coverage'})
        model=CardModel(self.s)
        package=model.package()
        self.assertIn(PATH,package['definitions'])
        self.assertTrue({'warming.baseline','warming.rank'} <= {r['id'] for r in package['action_registry']})
        self.assertNotIn('activity_score',{f['name'] for f in self.s.get_fields(rank['id'])})
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertFalse(model.cycles())
        result=self.s.find_name('leaderboard_warming')
        self.assertIn(self.s.find_name('候选代币筛选')['id'],{r[0] for r in self.s.db.execute('SELECT downstream_id FROM edges WHERE upstream_id=?',(result['id'],))})
        self.s.update_node(rank['id'], {'formula':'later user change'})
        saved=self.snapshot();ensure_coingecko_warming(self.s);self.assertEqual(saved,self.snapshot())

    def test_interruption_rolls_back_every_table(self):
        before=self.snapshot()
        with patch.object(self.s,'create_field_usage',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):ensure_coingecko_warming(self.s)
        self.assertEqual(before,self.snapshot());ensure_coingecko_warming(self.s)

    def test_user_edit_and_unknown_pin_refused_without_mutation(self):
        rank=self.s.find_name('生成基础升温榜')
        self.s.update_node(rank['id'],{'formula':'user edit'})
        before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'edited definition'):ensure_coingecko_warming(self.s)
        self.assertEqual(before,self.snapshot())

    def test_unknown_definition_revision_refused(self):
        rank=self.s.find_name('生成基础升温榜');cfg=CardModel(self.s).contract(rank['id'])['config']
        cfg['definition_refs'][0]['revision']='unknown'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),rank['id']));self.s.db.commit()
        before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'unknown definition revision'):ensure_coingecko_warming(self.s)
        self.assertEqual(before,self.snapshot())

    def test_new_card_conflict_refused(self):
        self.s.create_node({'name':'CoinGecko · 升温候选快照','kind':'state'})
        before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'name conflict'):ensure_coingecko_warming(self.s)
        self.assertEqual(before,self.snapshot())

    def test_external_retired_field_dependency_rolls_back(self):
        result=self.s.find_name('leaderboard_warming')
        other=self.s.create_node({'name':'user consumer','kind':'process'})
        edge=self.s.create_edge({'upstream_id':result['id'],'downstream_id':other['id'],'transport_kind':'direct'})
        field=next(f for f in self.s.get_fields(result['id']) if f['name']=='activity_score')
        self.s.create_field_usage(edge['id'],{'source_field_id':field['id'],'target_field_id':None,'usage_note':'user binding'})
        before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'external dependency'):ensure_coingecko_warming(self.s)
        self.assertEqual(before,self.snapshot())


if __name__=='__main__':unittest.main()
