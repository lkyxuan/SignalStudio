"""SS-98 transaction guards on isolated graph fixtures."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from graph_service import GraphService
from card_model import CardModel, encoded
from card_corrections import ensure_card_corrections, load, MARKER

class CardCorrectionsTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.s=GraphService(Path(self.tmp.name)/'graph.db')
        self.expected=load('server/migration_snapshots/card-corrections-before-ss98.json')
        for ref,fields in self.expected['nodes'].items():
            kind='interface' if ref=='7003' else 'table' if ref=='1014' else 'process'
            node=self.s.create_node({**fields,'kind':kind})
            self.s.db.execute('UPDATE nodes SET reference_number=? WHERE id=?',(int(ref),node['id']))
        node=self.s.create_node({'name':'test market channel','kind':'channel'})
        self.s.db.execute('UPDATE nodes SET reference_number=5004 WHERE id=?',(node['id'],));self.s.db.commit()
        self.model=CardModel(self.s);self.model.migrate()
        old=self.s.find_name('市场交易活跃候选')
        for f in self.expected['candidate_fields']:
            self.s.create_field(old['id'],f)
        cfg=self.model.contract(old['id'])['config'];cfg.update(self.expected['candidate_config'])
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),old['id']))
        ui=self.s.find_name('榜单与信号首页');cfg=self.model.contract(ui['id'])['config'];cfg['interface']=self.expected['homepage_interface']
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),ui['id']))
        self.s.db.execute("INSERT INTO schema_meta VALUES ('coingecko_hottest_z_v1','1')");self.s.db.commit()
        self.s.create_edge({'upstream_id':node['id'],'downstream_id':old['id']})
    def tearDown(self):self.s.db.close();self.tmp.cleanup()
    def snapshot(self):return list(self.s.db.iterdump())
    def test_removal_layout_and_reentry_preserve_positions(self):
        positions={n['id']:(n['position_x'],n['position_y']) for n in self.s.graph()['nodes'] if n['reference_number']!=3001}
        ensure_card_corrections(self.s)
        self.assertIsNone(self.s.find_name('市场交易活跃候选'))
        self.assertEqual(positions,{n['id']:(n['position_x'],n['position_y']) for n in self.s.graph()['nodes']})
        self.assertFalse(self.s.db.execute('pragma foreign_key_check').fetchall())
        self.assertIn('中间',self.s.find_name('榜单与信号首页')['definition'])
        before=self.snapshot();ensure_card_corrections(self.s);self.assertEqual(before,self.snapshot())
    def test_new_dependency_blocks_atomically(self):
        self.s.create_edge({'upstream_id':self.s.find_name('市场交易活跃候选')['id'],'downstream_id':self.s.find_name('计算当前资产评分')['id']})
        before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'dependency'):ensure_card_corrections(self.s)
        self.assertEqual(before,self.snapshot())
    def test_custom_homepage_contract_blocks(self):
        ui=self.s.find_name('榜单与信号首页');cfg=self.model.contract(ui['id'])['config'];cfg['interface']['custom']='user edit'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),ui['id']));self.s.db.commit();before=self.snapshot()
        with self.assertRaisesRegex(ValueError,'edited homepage'):ensure_card_corrections(self.s)
        self.assertEqual(before,self.snapshot())
    def test_interruption_rolls_back(self):
        before=self.snapshot()
        with patch.object(self.s,'_event',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):ensure_card_corrections(self.s)
        self.assertEqual(before,self.snapshot())
