import copy
import json
import unittest
from unittest.mock import patch

from card_model import CardModel, encoded
from new_uuid_board import ensure_new_uuid_board
from search_preparation import ensure_search_preparation, PATH, MARKER
import test_new_uuid_board


class SearchPreparationTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_new_uuid_board.NewUuidBoardTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_new_uuid_board(self.s)

    def tearDown(self):
        self.fixture.tearDown()

    def snapshot(self):
        return {r[0]: [tuple(row) for row in self.s.db.execute('SELECT * FROM ' + r[0])]
                for r in self.s.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}

    def test_five_cards_routes_default_policy_and_identity_preservation(self):
        s = self.s
        old = copy.deepcopy(s.graph())
        ensure_search_preparation(s)
        graph = s.graph()
        self.assertEqual(len(graph['nodes']), len(old['nodes']) + 5)
        self.assertEqual(len(graph['edges']), len(old['edges']) + 9)
        for node in old['nodes']:
            current = s.get_node(node['id'])
            for key in ('id','reference_number','position_x','position_y'):
                self.assertEqual(current[key], node[key])
            if node['name'] not in ('数据采集与内容生成','刷新判断'):
                self.assertEqual(current, {k:node[k] for k in current})
        gen = s.find_name('根据资料生成内容')
        self.assertIsNotNone(gen)
        self.assertIsNone(s.find_name('数据采集与内容生成'))
        gap = s.find_name('判断资料缺口')
        cfg = CardModel(s).contract(gap['id'])['config']
        self.assertEqual(cfg['resource']['search_policy'], 'realtime_search_required')
        self.assertEqual({b['id'] for b in cfg['branches']}, {'need_search','enough','blocked'})
        names = {n['id']:n['name'] for n in graph['nodes']}
        pairs = {(names[e['upstream_id']],names[e['downstream_id']]) for e in graph['edges']}
        self.assertNotIn(('刷新判断', gen['name']), pairs)
        self.assertNotIn(('asset_identifiers', gen['name']), pairs)
        self.assertIn(('组装生成资料', gen['name']), pairs)
        for branch, target in [('need_search','搜索补缺'),('enough','组装生成资料')]:
            bindings = [b for b in graph['bindings'] if b['branch']==branch]
            self.assertEqual(len(bindings),1)
            edge = s.get_edge(bindings[0]['edge_id'])
            self.assertEqual(names[edge['downstream_id']],target)
        fields = {f['id']:f for f in graph['fields']}
        for usage in graph['field_usages']:
            edge = s.get_edge(usage['edge_id'])
            if edge['rationale'].startswith('SS-87'):
                self.assertEqual(fields[usage['source_field_id']]['name'], fields[usage['target_field_id']]['name'])
        self.assertFalse(s.db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertFalse(CardModel(s).cycles())
        self.assertFalse(any(i['code']=='definition_changed' for i in CardModel(s).readiness()['issues']))
        package = CardModel(s).package()
        self.assertEqual(package['definitions'][PATH]['body']['observed_rows'], [])
        saved = self.snapshot()
        ensure_search_preparation(s)
        self.assertEqual(saved,self.snapshot())

    def test_failure_rolls_back_all_tables_and_allocation(self):
        before = self.snapshot()
        with patch.object(self.s,'create_field_usage',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):
                ensure_search_preparation(self.s)
        self.assertEqual(before,self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())
        ensure_search_preparation(self.s)

    def test_unrelated_user_fields_edges_and_configuration_survive(self):
        gen = self.s.find_name('数据采集与内容生成')
        field = self.s.create_field(gen['id'], {'name':'user_annotation','data_type':'string'})
        extra = self.s.create_node({'name':'user reader','kind':'process'})
        edge = self.s.create_edge({'upstream_id':gen['id'],'downstream_id':extra['id']})
        usage = self.s.create_field_usage(edge['id'],{'source_field_id':field['id']})
        ensure_search_preparation(self.s)
        self.assertEqual(self.s.get_edge(edge['id']),edge)
        self.assertIn(field,self.s.get_fields(gen['id']))
        self.assertIn(usage,self.s.graph()['field_usages'])

    def test_conflict_and_edited_definition_refuse_without_mutation(self):
        gen = self.s.find_name('数据采集与内容生成')
        self.s.update_node(gen['id'],{'formula':'user change'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError,'edited generate'):
            ensure_search_preparation(self.s)
        self.assertEqual(before,self.snapshot())

    def test_unknown_reference_rolls_back_every_change(self):
        node = self.s.find_name('刷新判断')
        cfg = CardModel(self.s).contract(node['id'])['config']
        cfg['definition_refs'][0]['revision']='user-unknown-revision'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?',(encoded(cfg),node['id']))
        self.s.db.commit()
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError,'unknown content definition'):
            ensure_search_preparation(self.s)
        self.assertEqual(before,self.snapshot())

    def test_name_conflict_refuses_without_mutation(self):
        self.s.create_node({'name':'搜索补缺','kind':'process'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError,'name conflict'):
            ensure_search_preparation(self.s)
        self.assertEqual(before,self.snapshot())


if __name__ == '__main__':
    unittest.main()
