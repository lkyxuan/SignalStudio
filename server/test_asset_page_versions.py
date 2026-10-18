import copy
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from asset_page_versions import ROOT, PATH, MARKER, ensure_asset_page_versions
from card_model import CardModel
from graph_service import GraphService

SPEC = json.loads((ROOT / PATH).read_text())


class PageVersionDesignTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = GraphService(Path(self.tmp.name) / 'graph.db')
        self.s.group_node_references_once()
        self.model = CardModel(self.s)
        self.model.migrate()
        self.assets = self.s.create_node({'name': 'assets', 'kind': 'table',
                                          'position_x': 100, 'position_y': 200})
        self.s.create_field(self.assets['id'], {'name': 'asset_id', 'data_type': 'TEXT'})
        self.s.create_node({'name': 'asset_information_content', 'kind': 'table'})

    def tearDown(self):
        self.s.db.close()
        self.tmp.cleanup()

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_adds_one_card_and_identity_reference_preserving_existing_cards(self):
        before = copy.deepcopy(self.s.graph())
        ensure_asset_page_versions(self.s)
        after = self.s.graph()
        by_id = {n['id']: n for n in after['nodes']}
        for node in before['nodes']:
            self.assertEqual(node, by_id[node['id']])
        self.assertEqual(len(after['nodes']), len(before['nodes']) + 1)
        node = self.s.find_name('asset_page_versions')
        self.assertTrue(1000 < node['reference_number'] < 2000)
        self.assertEqual([f['name'] for f in self.s.get_fields(node['id'])],
                         ['page_version_id', 'asset_id', 'page_ref', 'generated_at'])
        cfg = self.model.contract(node['id'])['config']
        self.assertEqual(cfg['resource']['observed_rows'], [])
        self.assertEqual(cfg['resource']['physical_binding'], 'unconnected')
        self.assertEqual(cfg['action']['id'], '')
        self.assertEqual(len(after['edges']), 1)
        edge = after['edges'][0]
        self.assertEqual((edge['upstream_id'], edge['downstream_id']), (self.assets['id'], node['id']))
        self.assertEqual(after['bindings'][0]['kind'], 'reference')
        self.assertEqual(after['bindings'][0]['config']['trigger'], 'none')
        self.assertFalse(any(issue['code'] == 'meaning_missing'
                             for issue in self.model.readiness()['issues'] if issue['node_id'] == node['id']))
        self.assertIn(PATH, self.model.package()['definitions'])
        self.assertFalse(self.s.db.execute("SELECT name FROM sqlite_master WHERE name='asset_page_versions'").fetchone())
        saved = self.snapshot()
        ensure_asset_page_versions(self.s)
        self.assertEqual(saved, self.snapshot())

    def test_failure_rolls_back_fields_card_edges_and_number_allocation(self):
        before = self.snapshot()
        with patch.object(self.s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_asset_page_versions(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_asset_page_versions(self.s)

    def test_name_conflict_does_not_overwrite(self):
        self.s.create_node({'name': 'asset_page_versions', 'kind': 'table'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'name conflict'):
            ensure_asset_page_versions(self.s)
        self.assertEqual(before, self.snapshot())


class PageVersionSchemaTest(unittest.TestCase):
    def test_history_keeps_versions_and_rejects_orphans_and_duplicate_versions(self):
        # Disposable contract verification, never an installation into the Studio business DB.
        with sqlite3.connect(':memory:') as db:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('CREATE TABLE assets(asset_id TEXT PRIMARY KEY)')
            asset = SPEC['example_rows'][0]['asset_id']
            db.execute('INSERT INTO assets VALUES (?)', (asset,))
            db.execute(SPEC['table']['create_sql'])
            for sql in SPEC['table']['index_sql']:
                db.execute(sql)
            for row in SPEC['example_rows']:
                db.execute('INSERT INTO asset_page_versions VALUES (?,?,?,?)', tuple(row.values()))
            db.execute('INSERT INTO asset_page_versions VALUES (?,?,?,?)', ('legacy', asset, 'legacy.html', None))
            latest = db.execute('SELECT page_version_id FROM asset_page_versions WHERE asset_id=? AND generated_at IS NOT NULL ORDER BY generated_at DESC,page_version_id ASC LIMIT 1', (asset,)).fetchone()
            self.assertEqual(latest[0], 'example-btc-page-v2')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM asset_page_versions').fetchone()[0], 3)
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute('INSERT INTO asset_page_versions VALUES (?,?,?,?)', ('orphan', 'missing', 'page.html', None))
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute('INSERT INTO asset_page_versions VALUES (?,?,?,?)', tuple(SPEC['example_rows'][0].values()))
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute('INSERT INTO asset_page_versions VALUES (?,?,?,?)', ('blank', asset, ' ', None))


if __name__ == '__main__':
    unittest.main()
