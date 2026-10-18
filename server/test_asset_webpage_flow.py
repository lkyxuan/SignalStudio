import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from asset_webpage_flow import ROOT, PATH, MARKER, ensure_asset_webpage_flow
from card_model import CardModel
from graph_service import GraphService

SPEC = json.loads((ROOT / PATH).read_text())


class CurrentWebpageFlowTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = GraphService(Path(self.tmp.name) / 'graph.db')
        self.s.group_node_references_once()
        self.model = CardModel(self.s)
        self.model.migrate()
        self.nodes = {}
        for card in SPEC['cards']:
            self.nodes[card['name']] = self.s.create_node({'name': card['name'], 'kind': card['kind']})
            for f in card['fields']:
                self.s.create_field(self.nodes[card['name']]['id'], {'name': f['name'], 'data_type': f['type']})
            self.s.create_field(self.nodes[card['name']]['id'], {'name': 'information_key', 'data_type': 'TEXT'})
        for name, kind, fields in (
                ('asset_pages', 'table', ['asset_id', 'page_ref', 'updated_at']),
                ('asset_identifiers', 'table', ['asset_id', 'source_namespace', 'external_identifier']),
                ('asset_information_content', 'table', ['asset_id']),
                ('根据资料生成内容', 'process', ['asset_id']),
                ('验证与保存', 'process', ['asset_id'])):
            self.nodes[name] = self.s.create_node({'name': name, 'kind': kind})
            for field in fields:
                self.s.create_field(self.nodes[name]['id'], {'name': field, 'data_type': 'TEXT'})
        for relation in SPEC['connections']:
            self.s.create_edge({'upstream_id': self.nodes[relation['source']]['id'],
                                'downstream_id': self.nodes[relation['target']]['id']})
        for source, target in [('asset_information_content', '刷新判断'), ('asset_information_content', '读取已有资料'),
                               ('asset_information_content', '根据资料生成内容'), ('根据资料生成内容', '验证与保存'),
                               ('验证与保存', 'asset_information_content'), ('组装生成资料', '根据资料生成内容')]:
            self.s.create_edge({'upstream_id': self.nodes[source]['id'], 'downstream_id': self.nodes[target]['id']})

    def tearDown(self):
        self.s.db.close()
        self.tmp.cleanup()

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_removes_only_old_cards_and_preserves_current_identity_positions_and_links(self):
        unrelated = self.s.create_node({'name': 'Unrelated', 'kind': 'table'})
        before = {n['id']: copy.deepcopy(n) for n in self.s.graph()['nodes']}
        ensure_asset_webpage_flow(self.s)
        for name in SPEC['retired_cards']:
            self.assertIsNone(self.s.find_name(name))
        for card in SPEC['cards']:
            node = self.s.find_name(card['name'])
            for field in ('id', 'reference_number', 'position_x', 'position_y'):
                self.assertEqual(node[field], before[node['id']][field])
            self.assertNotIn('information_key', [f['name'] for f in self.s.get_fields(node['id'])])
        self.assertEqual(unrelated, self.s.get_node(unrelated['id']))
        self.assertIsNotNone(self.s.find_name('asset_pages'))
        fields = {f['id'] for f in self.s.graph()['fields']}
        for usage in self.s.graph()['field_usages']:
            self.assertIn(usage['source_field_id'], fields)
            self.assertIn(usage['target_field_id'], fields)
        self.assertIn(PATH, self.model.package()['definitions'])
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        saved = self.snapshot()
        ensure_asset_webpage_flow(self.s)
        self.assertEqual(saved, self.snapshot())

    def test_interruption_restores_deleted_cards_edges_fields_and_audit(self):
        before = self.snapshot()
        with patch.object(self.s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_asset_webpage_flow(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())

    def test_unrelated_outside_connection_is_not_silently_removed(self):
        node = self.s.create_node({'name': 'User flow', 'kind': 'process'})
        self.s.create_edge({'upstream_id': self.nodes['asset_information_content']['id'], 'downstream_id': node['id']})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'unrelated connection'):
            ensure_asset_webpage_flow(self.s)
        self.assertEqual(before, self.snapshot())


if __name__ == '__main__':
    unittest.main()
