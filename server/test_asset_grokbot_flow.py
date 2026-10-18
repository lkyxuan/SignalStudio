import copy
import json
import unittest
from unittest.mock import patch

from asset_grokbot_flow import ROOT, PATH, MARKER, ACCESS_MARKER, ensure_asset_grokbot_flow
from asset_webpage_flow import ensure_asset_webpage_flow
import test_asset_webpage_flow as previous_test

SPEC = json.loads((ROOT / PATH).read_text())
NAME = next(c['name'] for c in SPEC['cards'] if c['key'] == 'grokbot')


class GrokbotBoundaryTest(unittest.TestCase):
    def setUp(self):
        previous_test.CurrentWebpageFlowTest.setUp(self)
        ensure_asset_webpage_flow(self.s)

    def tearDown(self):
        previous_test.CurrentWebpageFlowTest.tearDown(self)

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_boundary_preserves_identity_other_cards_and_has_guarded_write(self):
        before = {n['id']: copy.deepcopy(n) for n in self.s.graph()['nodes']}
        original = self.s.find_name('读取已有资料')
        ensure_asset_grokbot_flow(self.s)
        node = self.s.find_name(NAME)
        for key in ('id', 'reference_number', 'position_x', 'position_y'):
            self.assertEqual(node[key], original[key])
        for name in SPEC['retired_cards'] + ['读取已有资料']:
            self.assertIsNone(self.s.find_name(name))
        removed_ids = {self.nodes[n]['id'] for n in SPEC['retired_cards']}
        changed_ids = {node['id'], self.nodes['候选代币筛选']['id'], self.nodes['刷新判断']['id']}
        for current in self.s.graph()['nodes']:
            if current['id'] not in changed_ids | removed_ids:
                self.assertEqual(current, before[current['id']])
        self.assertEqual({f['name'] for f in self.s.get_fields(node['id'])}, {f['name'] for f in SPEC['cards'][-1]['fields']})
        graph = self.s.graph()
        incoming = [e for e in graph['edges'] if e['downstream_id'] == node['id']]
        self.assertEqual({e['upstream_id'] for e in incoming}, {self.nodes['刷新判断']['id'], self.nodes['asset_identifiers']['id']})
        decision_edge = next(e for e in incoming if e['upstream_id'] == self.nodes['刷新判断']['id'])
        self.assertEqual({b['branch'] for b in graph['bindings'] if b['edge_id'] == decision_edge['id']}, {'first', 'due'})
        write = next(e for e in graph['edges'] if e['upstream_id'] == node['id'])
        binding = next(b for b in graph['bindings'] if b['edge_id'] == write['id'])
        self.assertEqual(binding['kind'], 'write')
        self.assertEqual(binding['config']['write_guard']['status'], 'success')
        fields = {f['id']: f['name'] for f in graph['fields']}
        self.assertEqual({(fields[u['source_field_id']], fields[u['target_field_id']]) for u in graph['field_usages'] if u['edge_id'] == write['id']},
                         {('asset_id', 'asset_id'), ('saved_page_ref', 'page_ref'), ('saved_at', 'updated_at')})
        cfg = self.model.contract(node['id'])['config']
        self.assertEqual(cfg['action']['implementation'], 'unknown')
        self.assertIsNone(cfg['resource']['workflow_version'])
        self.assertIn(PATH, self.model.package()['definitions'])
        self.assertFalse(self.model.cycles())
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        saved = self.snapshot()
        ensure_asset_grokbot_flow(self.s)
        self.assertEqual(saved, self.snapshot())

    def test_interrupted_upgrade_restores_all_rows(self):
        before = self.snapshot()
        with patch.object(self.s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_asset_grokbot_flow(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())

    def test_outside_connection_is_preserved(self):
        other = self.s.create_node({'name': 'Unrelated consumer', 'kind': 'process'})
        self.s.create_edge({'upstream_id': self.nodes['搜索资料暂存']['id'], 'downstream_id': other['id']})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'unrelated connection'):
            ensure_asset_grokbot_flow(self.s)
        self.assertEqual(before, self.snapshot())

    def test_requirements_on_absorbed_fields_are_preserved(self):
        field = self.s.get_fields(self.nodes['搜索资料暂存']['id'])[0]
        r = self.s.create_requirement(self.nodes['asset_pages']['id'], {'name': 'Keep user reference'})
        self.s.db.execute('UPDATE data_requirements SET source_field_id=? WHERE id=?', (field['id'], r['id']))
        self.s.db.commit()
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'data requirements'):
            ensure_asset_grokbot_flow(self.s)
        self.assertEqual(before, self.snapshot())

    def test_early_boundary_receives_both_tool_paths_once(self):
        ensure_asset_grokbot_flow(self.s)
        node = self.s.find_name(NAME)
        cfg = self.model.contract(node['id'])['config']
        cfg['resource'].pop('data_access')
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (json.dumps(cfg), node['id']))
        self.s.db.execute('DELETE FROM schema_meta WHERE key=?', (ACCESS_MARKER,))
        self.s.db.commit()
        ensure_asset_grokbot_flow(self.s)
        access = self.model.contract(node['id'])['config']['resource']['data_access']
        self.assertEqual({a['id'] for a in access}, {'signalstudio', 'external'})
        self.assertTrue(all(a['binding'] is None for a in access))
        before = self.snapshot()
        ensure_asset_grokbot_flow(self.s)
        self.assertEqual(before, self.snapshot())

    def test_tool_description_upgrade_rolls_back_when_interrupted(self):
        ensure_asset_grokbot_flow(self.s)
        self.s.db.execute('DELETE FROM schema_meta WHERE key=?', (ACCESS_MARKER,))
        self.s.db.commit()
        before = self.snapshot()
        with patch.object(self.model.__class__, 'validate_config', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_asset_grokbot_flow(self.s)
        self.assertEqual(before, self.snapshot())

    def test_imported_cache_records_are_preserved(self):
        node = self.nodes['搜索资料暂存']
        cfg = self.model.contract(node['id'])['config']
        cfg['resource']['observed_rows'] = [{'asset_id': 'actual-observation'}]
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (json.dumps(cfg), node['id']))
        self.s.db.commit()
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'protected, imported'):
            ensure_asset_grokbot_flow(self.s)
        self.assertEqual(before, self.snapshot())


if __name__ == '__main__':
    unittest.main()
