import json
import sqlite3
import unittest
from unittest.mock import patch

import test_asset_page_refresh_link as legacy
from asset_page_refresh_link import ensure_asset_page_refresh_link
from asset_pages import PATH, ROOT, MARKER, ensure_asset_pages
from card_model import CardModel

SPEC = json.loads((ROOT / PATH).read_text())


class CurrentAssetPageTest(unittest.TestCase):
    def setUp(self):
        legacy.PageRefreshLinkTest.setUp(self)
        ensure_asset_page_refresh_link(self.s)

    def tearDown(self):
        legacy.PageRefreshLinkTest.tearDown(self)

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_current_record_reuses_card_and_read_edge_without_versions(self):
        original = self.s.get_node(self.pages['id'])
        edge = next(e for e in self.s.graph()['edges'] if e['upstream_id'] == self.pages['id'])
        ensure_asset_pages(self.s)
        current = self.s.find_name('asset_pages')
        for key in ('id', 'reference_number', 'position_x', 'position_y'):
            self.assertEqual(current[key], original[key])
        self.assertIsNone(self.s.find_name('asset_page_versions'))
        self.assertEqual([f['name'] for f in self.s.get_fields(current['id'])], ['asset_id', 'page_ref', 'updated_at'])
        self.assertEqual(len(self.s.get_field_usages(edge['id'])), 3)
        graph = self.s.graph()
        fields = {f['id']: f['name'] for f in graph['fields']}
        mappings = {(fields[u['source_field_id']], fields[u['target_field_id']]) for u in self.s.get_field_usages(edge['id'])}
        self.assertEqual(mappings, {('asset_id', 'asset_id'), ('page_ref', 'page_ref'), ('updated_at', 'page_updated_at')})
        target_fields = [f['name'] for f in self.s.get_fields(self.decision['id'])]
        self.assertNotIn('page_version_id', target_fields)
        cfg = self.model.contract(current['id'])['config']
        self.assertEqual(cfg['resource']['primary_key'], ['asset_id'])
        self.assertEqual(cfg['resource']['observed_rows'], [])
        self.assertIsNone(self.model.contract(self.decision['id'])['config']['page_read']['page_refresh_interval_seconds'])
        self.assertIn(PATH, self.model.package()['definitions'])
        self.assertEqual(self.handoff, self.s.get_edge(self.handoff['id']))
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        saved = self.snapshot()
        ensure_asset_pages(self.s)
        self.assertEqual(saved, self.snapshot())

    def test_interruption_restores_names_fields_mappings_and_definitions(self):
        before = self.snapshot()
        with patch.object(CardModel, 'validate_config', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_asset_pages(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())

    def test_schema_allows_one_current_row_per_asset_and_rejects_orphans(self):
        row = SPEC['example_rows'][0]
        with sqlite3.connect(':memory:') as db:
            db.execute('PRAGMA foreign_keys=ON')
            db.execute('CREATE TABLE assets(asset_id TEXT PRIMARY KEY)')
            db.execute('INSERT INTO assets VALUES (?)', (row['asset_id'],))
            db.execute(SPEC['table']['create_sql'])
            db.execute('INSERT INTO asset_pages VALUES (?,?,?)', tuple(row.values()))
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute('INSERT INTO asset_pages VALUES (?,?,?)', tuple(row.values()))
            with self.assertRaises(sqlite3.IntegrityError):
                db.execute('INSERT INTO asset_pages VALUES (?,?,?)', ('missing', 'page.html', None))
            self.assertEqual(db.execute('SELECT COUNT(*) FROM asset_pages').fetchone()[0], 1)


if __name__ == '__main__':
    unittest.main()
