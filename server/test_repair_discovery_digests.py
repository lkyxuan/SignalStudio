import copy
import hashlib
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from card_model import CardModel, encoded
from retire_market_discovery import ensure_retire_market_discovery
from repair_discovery_digests import ensure_repair_discovery_digests, repaired_config, MARKER, REPAIRS
import test_retire_market_discovery


class DigestRepairTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_retire_market_discovery.RetireDiscoveryTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_retire_market_discovery(self.s)
        # Reproduce the shipped bug, including nested resource definition refs.
        def break_digest(v):
            if isinstance(v, list): return [break_digest(x) for x in v]
            if isinstance(v, dict):
                result={k:break_digest(x) for k,x in v.items()}
                if v.get('path') in REPAIRS: result['revision']=REPAIRS[v['path']][0]
                return result
            return v
        for row in self.s.db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            config=break_digest(json.loads(row['config']))
            config['environment']='preserve-user-edit'
            self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(config),row['node_id']))
        self.s.db.commit()
    def tearDown(self): self.fixture.tearDown()
    def snapshot(self):
        tables=[r[0] for r in self.s.db.execute("SELECT name FROM sqlite_master WHERE type='table'")]
        return {t:[dict(r) for r in self.s.db.execute('SELECT * FROM '+t)] for t in tables}
    def test_known_nested_refs_repaired_and_all_other_rows_preserved(self):
        before=self.snapshot()
        with patch('workspace_scope.SCOPE',{'shelved_cards':[{'node_id':self.s.find_name('生成基础升温榜')['id']}]}):
            ensure_repair_discovery_digests(self.s)
        after=self.snapshot()
        for table in before:
            if table not in ('schema_meta','node_contracts'): self.assertEqual(before[table],after[table],table)
        changed=0
        for old,new in zip(before['node_contracts'],after['node_contracts']):
            expected=copy.deepcopy(old)
            config=repaired_config(json.loads(old['config']),set())
            if config!=json.loads(old['config']):
                expected['config']=encoded(config);expected['revision']+=1;changed+=1
            self.assertEqual(expected,new)
        self.assertGreater(changed,0)
        for row in after['node_contracts']:
            for ref in json.loads(row['config'])['definition_refs']:
                self.assertEqual(ref['revision'],hashlib.sha256(Path(ref['path']).read_bytes()).hexdigest())
        with patch('workspace_scope.SCOPE',{'shelved_cards':[{'node_id':self.s.find_name('生成新发现榜')['id']}]}):
            ensure_repair_discovery_digests(self.s)
        self.assertEqual(after,self.snapshot())
        self.assertFalse(any(i['code']=='definition_changed' for i in CardModel(self.s).readiness()['issues']))
    def test_unknown_digest_remains_visible_and_later_edits_survive_reentry(self):
        n=self.s.find_name('量价评分 · 生成贡献');m=CardModel(self.s)
        c=m.contract(n['id'])['config'];c['definition_refs'][0]['revision']='unknown-user-version'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(c),n['id']));self.s.db.commit()
        ensure_repair_discovery_digests(self.s)
        self.assertEqual(m.contract(n['id'])['config']['definition_refs'][0]['revision'],'unknown-user-version')
        self.assertTrue(any(i['code']=='definition_changed' for i in m.readiness([n['id']])['issues']))
        m.update_contract(n['id'],{'revision':m.contract(n['id'])['revision'],'config':{'environment':'later-edit'}});self.s.db.commit()
        before=self.snapshot();ensure_repair_discovery_digests(self.s);self.assertEqual(before,self.snapshot())
    def test_database_failure_after_first_update_rolls_back(self):
        ids=[r['node_id'] for r in self.s.db.execute('SELECT node_id,config FROM node_contracts')
             if repaired_config(json.loads(r['config']),set())!=json.loads(r['config'])]
        self.assertGreater(len(ids),1)
        self.s.db.execute("CREATE TRIGGER interrupt_digest_update BEFORE UPDATE ON node_contracts "
            "WHEN OLD.node_id='"+ids[1]+"' BEGIN SELECT RAISE(ABORT,'interrupted database'); END")
        self.s.db.commit()
        before=self.snapshot()
        with self.assertRaisesRegex(Exception,'interrupted database'):ensure_repair_discovery_digests(self.s)
        self.assertEqual(before,self.snapshot())

    def test_changed_target_refuses_and_interruption_rolls_back(self):
        before=self.snapshot()
        with patch('repair_discovery_digests.REPAIRS',{p:(a,'unapproved-target') for p,(a,b) in REPAIRS.items()}):
            with self.assertRaisesRegex(ValueError,'target changed'):ensure_repair_discovery_digests(self.s)
        self.assertEqual(before,self.snapshot())
        with patch.object(CardModel,'validate_config',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):ensure_repair_discovery_digests(self.s)
        self.assertEqual(before,self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())

if __name__=='__main__': unittest.main()
