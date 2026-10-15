import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from graph_service import GraphService
from card_model import CardModel
from worth_reading_translation import ensure_worth_reading_translation, PATH, ROOT, MARKER


class TranslationMappingTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.s = GraphService(str(Path(self.tmp.name) / 'test.db'))
        self.model = CardModel(self.s)
        self.model.migrate()
        self.old = self.s.create_node({'name': 'Existing user card', 'kind': 'process', 'position_x': 9, 'position_y': 17, 'formula': 'user rule'})

    def tearDown(self):
        self.s.db.close()
        self.tmp.cleanup()

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_mapping_is_additive_idempotent_and_non_executable(self):
        old = copy.deepcopy(self.s.get_node(self.old['id']))
        ensure_worth_reading_translation(self.s)
        spec = json.loads((ROOT / PATH).read_text())
        self.assertEqual(self.s.get_node(old['id']), old)
        self.assertEqual(len(self.s.graph()['nodes']), len(spec['cards']) + 1)
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertFalse(self.model.cycles())
        package = self.model.package()
        self.assertIn(PATH, package['definitions'])
        for c in spec['cards']:
            cfg = self.model.contract(self.s.find_name(c['name'])['id'])['config']
            self.assertEqual(cfg['action']['id'], '')
            self.assertEqual(cfg['trigger']['kind'], 'unspecified')
            self.assertEqual(cfg['resource']['observed_rows'], [])
        bindings = self.s.graph()['bindings']
        self.assertTrue(all(b['config']['trigger'] == 'none' for b in bindings))
        saved = self.snapshot()
        ensure_worth_reading_translation(self.s)
        self.assertEqual(saved, self.snapshot())

    def test_interruption_rolls_back_allocations_and_entire_graph(self):
        before = self.snapshot()
        with patch.object(self.s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_worth_reading_translation(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_worth_reading_translation(self.s)

    def test_name_conflict_refuses_without_mutation(self):
        self.s.create_node({'name': 'content.translations', 'kind': 'table'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'name conflict'):
            ensure_worth_reading_translation(self.s)
        self.assertEqual(before, self.snapshot())

if __name__ == '__main__':
    unittest.main()
