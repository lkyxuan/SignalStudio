import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from asset_page_refresh_link import MARKER, ensure_asset_page_refresh_link
from asset_page_versions import ensure_asset_page_versions
from card_model import CardModel
from graph_service import GraphService


class PageRefreshLinkTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = GraphService(Path(self.tmp.name) / 'graph.db')
        self.s.group_node_references_once()
        self.model = CardModel(self.s)
        self.model.migrate()
        self.assets = self.s.create_node({'name': 'assets', 'kind': 'table'})
        self.s.create_field(self.assets['id'], {'name': 'asset_id', 'data_type': 'TEXT'})
        self.candidate = self.s.create_node({'name': '候选代币筛选', 'kind': 'process'})
        self.decision = self.s.create_node({'name': '刷新判断', 'kind': 'decision'})
        self.s.create_field(self.decision['id'], {'name': 'asset_id', 'data_type': 'string'})
        self.handoff = self.s.create_edge({'upstream_id': self.candidate['id'], 'downstream_id': self.decision['id']})
        ensure_asset_page_versions(self.s)
        self.pages = self.s.find_name('asset_page_versions')

    def tearDown(self):
        self.s.db.close()
        self.tmp.cleanup()

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_replaces_only_identity_line_and_keeps_candidate_handoff(self):
        before = copy.deepcopy(self.s.graph())
        ensure_asset_page_refresh_link(self.s)
        after = self.s.graph()
        # Only the two affected definition contracts gain the explicit read module.
        for old, new in zip(before['nodes'], after['nodes']):
            if old['id'] in (self.pages['id'], self.decision['id']):
                old.pop('card_contract')
                new = {k: v for k, v in new.items() if k != 'card_contract'}
            self.assertEqual(old, new)
        self.assertEqual(self.handoff, self.s.get_edge(self.handoff['id']))
        edges = {(e['upstream_id'], e['downstream_id']): e for e in after['edges']}
        self.assertNotIn((self.assets['id'], self.pages['id']), edges)
        read = edges[(self.pages['id'], self.decision['id'])]
        self.assertEqual(len(after['edges']), len(before['edges']))
        self.assertNotIn((self.pages['id'], self.candidate['id']), edges)
        binding = next(b for b in after['bindings'] if b['edge_id'] == read['id'])
        self.assertEqual((binding['kind'], binding['config']['trigger']), ('read', 'none'))
        fields = {f['id']: f for f in after['fields']}
        usages = self.s.get_field_usages(read['id'])
        self.assertEqual(len(usages), 4)
        for usage in usages:
            self.assertEqual(fields[usage['source_field_id']]['name'], fields[usage['target_field_id']]['name'])
        cfg = self.model.contract(self.decision['id'])['config']
        self.assertIsNone(cfg['page_history_read']['page_refresh_interval_seconds'])
        self.assertIn('catalog/asset-page-refresh-link.v1.json', self.model.package()['definitions'])
        saved = self.snapshot()
        ensure_asset_page_refresh_link(self.s)
        self.assertEqual(saved, self.snapshot())

    def test_failure_restores_old_edge_fields_contracts_and_allocator(self):
        before = self.snapshot()
        with patch.object(self.s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_asset_page_refresh_link(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())

    def test_edited_identity_line_is_not_deleted(self):
        edge = next(e for e in self.s.graph()['edges'] if e['upstream_id'] == self.assets['id'])
        self.s.update_edge(edge['id'], {'transformation': 'user edit'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'edited'):
            ensure_asset_page_refresh_link(self.s)
        self.assertEqual(before, self.snapshot())


if __name__ == '__main__':
    unittest.main()
