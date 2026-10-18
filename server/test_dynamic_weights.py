import copy
import json
import math
import sqlite3
import tempfile
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

from card_model import CardModel
from dynamic_weights import ROOT, PATH, MARKER, ensure_dynamic_weights
from graph_service import GraphService


SPEC = json.loads((ROOT / PATH).read_text())
TABLES = json.loads((ROOT / 'catalog/business-tables.v1.json').read_text())['tables']
CASES = json.loads((ROOT / 'catalog/business-table-cases.v1.json').read_text())['tables']


class WeightDesignInstallTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = GraphService(Path(self.tmp.name) / 'graph.db')
        self.s.group_node_references_once()
        self.model = CardModel(self.s)
        self.model.migrate()
        for name, field in [('assets', 'asset_id'), ('asset_relationships', 'row_id')]:
            node = self.s.create_node({'name': name, 'kind': 'table', 'position_x': 7, 'position_y': 19})
            self.s.create_field(node['id'], {'name': field, 'data_type': 'TEXT'})

    def tearDown(self):
        self.s.db.close()
        self.tmp.cleanup()

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_additive_idempotent_and_reference_only(self):
        old = copy.deepcopy(self.s.graph())
        ensure_dynamic_weights(self.s)
        current = {n['id']: n for n in self.s.graph()['nodes']}
        for node in old['nodes']:
            self.assertEqual(node, current[node['id']])
        self.assertEqual(len(self.s.graph()['nodes']), len(old['nodes']) + 4)
        for card in SPEC['cards']:
            node = self.s.find_name(card['name'])
            self.assertTrue(1000 < node['reference_number'] < 2000)
            cfg = self.model.contract(node['id'])['config']
            self.assertEqual(cfg['action']['id'], '')
            self.assertEqual(cfg['resource']['observed_rows'], [])
        self.assertTrue(all(b['kind'] == 'reference' and b['config']['trigger'] == 'none'
                            for b in self.s.graph()['bindings']))
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        saved = self.snapshot()
        ensure_dynamic_weights(self.s)
        self.assertEqual(saved, self.snapshot())
        self.assertIn(PATH, self.model.package()['definitions'])
        self.assertFalse(self.s.db.execute("SELECT name FROM sqlite_master WHERE name='weight_rules_current'").fetchone())

    def test_interruption_rolls_back_cards_references_and_allocated_numbers(self):
        before = self.snapshot()
        with patch.object(self.s, 'create_field_usage', side_effect=RuntimeError('interruption')):
            with self.assertRaisesRegex(RuntimeError, 'interruption'):
                ensure_dynamic_weights(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_dynamic_weights(self.s)

    def test_name_conflict_refuses_without_overwriting_user_work(self):
        self.s.create_node({'name': 'weight_topics', 'kind': 'table'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'name conflict'):
            ensure_dynamic_weights(self.s)
        self.assertEqual(before, self.snapshot())


class WeightSchemaCaseTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(':memory:')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute(TABLES['assets']['create_sql'])
        for row in CASES['assets']:
            self.insert('assets', row)
        for name in ('weight_topics', 'weight_evaluations', 'weight_rule_versions', 'weight_rules_current'):
            definition = TABLES[name]
            self.db.execute(definition['create_sql'])
            for statement in definition['index_sql']:
                self.db.execute(statement)
            for row in SPEC['tables'][name]['rows']:
                self.insert(name, row)

    def tearDown(self):
        self.db.close()

    def insert(self, name, row):
        values = [json.dumps(v) if isinstance(v, (dict, list)) else v for v in row.values()]
        self.db.execute(f'INSERT INTO {name} ({",".join(row)}) VALUES ({",".join("?" for _ in row)})', values)

    def test_account_identity_topic_defaults_and_version_snapshots(self):
        ids = SPEC['identity']
        self.assertEqual(len(set([ids['project_asset_id'], *ids['account_asset_ids']])), 3)
        for a in ids['account_asset_ids']:
            self.assertEqual(uuid.UUID(a).version, 7)
            self.assertEqual(self.db.execute('SELECT asset_kind FROM assets WHERE asset_id=?', (a,)).fetchone()[0], 'social_account')
            self.assertTrue(any(r['from_asset_id'] == a and r['to_asset_id'] == ids['project_asset_id']
                                for r in CASES['asset_relationships']))
        a = ids['account_asset_ids'][0]
        rows = {r['topic_id']: r for r in SPEC['tables']['weight_rules_current']['rows'] if r['subject_asset_id'] == a}
        self.assertEqual(rows[None]['coefficient'], 1)
        self.assertEqual(sorted(r['coefficient'] for topic, r in rows.items() if topic), [0.6, 1.8])
        versions = {v['version_id']: v for v in SPEC['tables']['weight_rule_versions']['rows']}
        for current in SPEC['tables']['weight_rules_current']['rows']:
            version = versions[current['current_version_id']]
            for key, value in current.items():
                if key != 'current_version_id':
                    self.assertEqual(value, version[key])
            self.assertTrue(math.isfinite(current['coefficient']))
        self.assertFalse(self.db.execute('PRAGMA foreign_key_check').fetchall())

    def test_current_scope_with_null_defaults_cannot_duplicate(self):
        row = dict(SPEC['tables']['weight_rules_current']['rows'][0])
        version = dict(SPEC['tables']['weight_rule_versions']['rows'][0])
        row['rule_id'] = version['rule_id'] = str(uuid.uuid4())
        row['current_version_id'] = version['version_id'] = str(uuid.uuid4())
        self.insert('weight_rule_versions', version)
        with self.assertRaises(sqlite3.IntegrityError):
            self.insert('weight_rules_current', row)

    def test_orphan_account_and_mismatched_version_values_are_rejected(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('UPDATE weight_rules_current SET subject_asset_id=? WHERE weight_layer=?', ('missing', 'subject'))
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute('UPDATE weight_rules_current SET coefficient=9')
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE weight_rules_current SET topic_id=? WHERE weight_layer='signal'", (SPEC['tables']['weight_topics']['rows'][0]['topic_id'],))

    def test_pending_evaluation_cannot_fabricate_verified_results(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute("UPDATE weight_evaluations SET status='evaluated',result=1")
        row = self.db.execute('SELECT status,result,evaluated_at FROM weight_evaluations').fetchone()
        self.assertEqual(row, ('pending', None, None))


if __name__ == '__main__':
    unittest.main()
