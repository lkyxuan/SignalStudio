import copy
import json
import unittest
from unittest.mock import patch
from card_model import CardModel, encoded
from coingecko_hottest import ensure_coingecko_hottest
from hottest_warmup import ensure_hottest_warmup, ROOT, PATH, MARKER
import test_coingecko_hottest


class WarmupMigrationTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_coingecko_hottest.HottestMigrationTest(); self.fixture.setUp(); self.s = self.fixture.s
        ensure_coingecko_hottest(self.s)
        previous = json.loads((ROOT / 'server/migration_snapshots/hottest-before-ss101.json').read_text())
        self.previous = previous
        model = CardModel(self.s)
        for entry in previous['spec']['cards']:
            node = self.s.find_name(entry['name'])
            self.s.db.execute('UPDATE nodes SET definition=?,formula=? WHERE id=?', (entry['description_zh'], entry['algorithm_zh'], node['id']))
            self.s.db.execute("DELETE FROM edge_field_usages WHERE source_field_id IN (SELECT id FROM node_fields WHERE node_id=? AND name='rvol_warmup') OR target_field_id IN (SELECT id FROM node_fields WHERE node_id=? AND name='rvol_warmup')", (node['id'], node['id']))
            self.s.db.execute("DELETE FROM node_fields WHERE node_id=? AND name='rvol_warmup'", (node['id'],))
            for f in entry['fields']:
                self.s.db.execute('UPDATE node_fields SET definition=? WHERE node_id=? AND name=?', (f['label_zh'], node['id'], f['name']))
        for row in self.s.db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            cfg = json.loads(row['config'])
            def reset(obj):
                if isinstance(obj,dict):
                    if obj.get('path')==PATH and 'revision' in obj: obj['revision']=previous['digest']
                    for value in obj.values():reset(value)
                elif isinstance(obj,list):
                    for value in obj:reset(value)
            reset(cfg)
            if 'algorithm_version' in cfg['resource']:cfg['resource']['algorithm_version']=previous['spec']['version']
            if 'metric_compatibility' in cfg['resource']:cfg['resource']['metric_compatibility']=previous['spec']['metric_compatibility']
            self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),row['node_id']))
        self.s.db.commit()
    def tearDown(self): self.fixture.tearDown()
    def snapshot(self): return list(self.s.db.iterdump())
    def test_upgrade_preserves_graph_and_reentry_preserves_edits(self):
        before=copy.deepcopy(self.s.graph());ensure_hottest_warmup(self.s);after=self.s.graph()
        self.assertEqual(len(before['nodes']),len(after['nodes']));self.assertEqual(len(before['edges']),len(after['edges']))
        for old in before['nodes']:
            cur=self.s.get_node(old['id'])
            for field in ('id','reference_number','position_x','position_y'):self.assertEqual(old[field],cur[field])
        for name in ('生成基础最热榜','leaderboard_hottest'):
            node=self.s.find_name(name)
            self.assertIn('rvol_warmup',{f['name'] for f in self.s.get_fields(node['id'])})
        self.assertEqual(CardModel(self.s).contract(self.s.find_name('生成基础最热榜')['id'])['config']['action']['version'],2)
        self.s.update_node(self.s.find_name('生成基础最热榜')['id'],{'formula':'later user edit'})
        saved=self.snapshot();ensure_hottest_warmup(self.s);self.assertEqual(saved,self.snapshot())
    def test_edited_card_rolls_back_all_changes(self):
        self.s.db.execute("UPDATE nodes SET formula='user edit' WHERE name='leaderboard_hottest'");self.s.db.commit()
        before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'edited card'):ensure_hottest_warmup(self.s)
        self.assertEqual(before,self.snapshot())
    def test_unknown_pin_rolls_back(self):
        node=self.s.find_name('生成基础最热榜');cfg=CardModel(self.s).contract(node['id'])['config'];cfg['definition_refs'][0]['revision']='unknown'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),node['id']));self.s.db.commit();before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'unknown definition revision'):ensure_hottest_warmup(self.s)
        self.assertEqual(before,self.snapshot())
    def test_interruption_rolls_back_and_retry_succeeds(self):
        before=self.snapshot()
        with patch.object(self.s,'create_field_usage',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):ensure_hottest_warmup(self.s)
        self.assertEqual(before,self.snapshot());ensure_hottest_warmup(self.s)
