import copy
import json
import unittest
from unittest.mock import patch
from card_model import CardModel, encoded
from hottest_history import ensure_hottest_history, ROOT, PATH


class HottestHistoryTest(unittest.TestCase):
    def setUp(self):
        from test_coingecko_hottest import HottestMigrationTest
        from coingecko_hottest import ensure_coingecko_hottest
        self.fixture = HottestMigrationTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_coingecko_hottest(self.s)
        self.s.db.execute("INSERT INTO schema_meta VALUES ('board_display_top50_ss131_v1','50')")
        self.s.db.commit()

    def tearDown(self):
        self.fixture.tearDown()

    def dump(self):
        return list(self.s.db.iterdump())

    def test_installed_flow_and_package_are_complete_and_reentry_preserves_edits(self):
        ensure_hottest_history(self.s)
        spec = json.loads((ROOT / PATH).read_text())
        model = CardModel(self.s)
        nodes = {n['name']: n for n in self.s.graph()['nodes']}
        for c in spec['cards']:
            cfg = model.contract(nodes[c['name']]['id'])['config']
            self.assertEqual(cfg['resource']['hottest_history_key'], c['key'])
            self.assertIsNone(cfg['resource']['physical_binding'])
            self.assertEqual(cfg['action']['implementation'], 'planned')
        for e in spec['connections']:
            edge = self.s.db.execute('SELECT id FROM edges WHERE upstream_id=? AND downstream_id=?',(nodes[e['source']]['id'],nodes[e['target']]['id'])).fetchone()
            self.assertIsNotNone(edge)
            self.assertTrue(self.s.get_field_usages(edge['id']))
        self.assertIsNone(self.s.db.execute('SELECT id FROM edges WHERE upstream_id=? AND downstream_id=?',(nodes['生成基础最热榜']['id'],nodes['leaderboard_hottest']['id'])).fetchone())
        package=model.package()
        self.assertIn(PATH,package['definitions'])
        registry={a['id']:a for a in package['action_registry']}
        self.assertEqual(registry['hottest.rank']['version'],3)
        for key in ('current','archive','query'):
            self.assertIn('hottest_history.'+key,registry)
        self.assertFalse(model.cycles())
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        n=nodes[spec['cards'][0]['name']]
        self.s.update_node(n['id'],{'formula':'later user edit'})
        saved=self.dump();ensure_hottest_history(self.s);self.assertEqual(saved,self.dump())

    def test_existing_identity_positions_rules_and_downstream_preserved(self):
        old=copy.deepcopy(self.s.graph())
        out=self.s.find_name('leaderboard_hottest')['id']
        outgoing=list(self.s.db.execute('SELECT * FROM edges WHERE upstream_id=?',(out,)))
        ensure_hottest_history(self.s)
        for n in old['nodes']:
            current=self.s.get_node(n['id'])
            for key in ('id','reference_number','position_x','position_y','formula','definition'):
                self.assertEqual(current[key],n[key])
        self.assertEqual(outgoing,list(self.s.db.execute('SELECT * FROM edges WHERE upstream_id=?',(out,))))
        self.assertEqual(len(self.s.graph()['nodes']),len(old['nodes'])+5)

    def test_interruption_rolls_back_and_unknown_pin_or_edits_refuse(self):
        before=self.dump()
        with patch.object(self.s,'create_field_usage',side_effect=RuntimeError('interrupt')):
            with self.assertRaisesRegex(RuntimeError,'interrupt'):ensure_hottest_history(self.s)
        self.assertEqual(before,self.dump())
        node=self.s.find_name('生成基础最热榜')
        cfg=CardModel(self.s).contract(node['id'])['config'];cfg['definition_refs'][0]['revision']='unknown'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),node['id']));self.s.db.commit()
        before=self.dump()
        with self.assertRaisesRegex(ValueError,'unknown definition revision'):ensure_hottest_history(self.s)
        self.assertEqual(before,self.dump())

    def test_known_delivery_correction_refreshes_pins_without_reinstalling_cards(self):
        import hashlib
        from hottest_history import MARKER
        ensure_hottest_history(self.s)
        spec=json.loads((ROOT/PATH).read_text())
        spec['existing_cards'][0]['delivery_action_version']=2
        previous=hashlib.sha256((json.dumps(spec,ensure_ascii=False,indent=2)+'\n').encode()).hexdigest()
        for row in self.s.db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            cfg=json.loads(row['config'])
            for ref in cfg['definition_refs']:
                if ref['path']==PATH:ref['revision']=previous
            self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),row['node_id']))
        self.s.db.execute('UPDATE schema_meta SET value=? WHERE key=?',(previous,MARKER));self.s.db.commit()
        nodes=copy.deepcopy(self.s.graph()['nodes'])
        ensure_hottest_history(self.s)
        for n in nodes:
            for key in ('name','position_x','position_y','formula','definition'):
                self.assertEqual(n[key],self.s.get_node(n['id'])[key])
        revision=hashlib.sha256((ROOT/PATH).read_bytes()).hexdigest()
        for n in self.s.graph()['nodes']:
            for ref in n['card_contract']['config']['definition_refs']:
                if ref['path']==PATH:self.assertEqual(ref['revision'],revision)

if __name__=='__main__':unittest.main()
