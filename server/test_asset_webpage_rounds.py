import copy
import json
import unittest
from unittest.mock import patch

from asset_webpage_board import ensure_asset_webpage_board
from asset_webpage_rounds import ROOT, PATH, PREVIOUS, MARKER, ensure_asset_webpage_rounds
import test_asset_webpage_board as previous

SPEC = json.loads((ROOT / PATH).read_text())
OLD = json.loads((ROOT / PREVIOUS).read_text())


class ThreeRoundBoardTest(unittest.TestCase):
    def setUp(self):
        previous.WebpageBoardTest.setUp(self)
        ensure_asset_webpage_board(self.s)

    def tearDown(self):
        previous.WebpageBoardTest.tearDown(self)

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_upgrade_retains_identity_positions_fields_edges_reports_and_success_records(self):
        graph = copy.deepcopy(self.s.graph())
        originals = {c['key']: self.s.find_name(c['name']) for c in OLD['cards']}
        # Display overrides and historical reports must survive without reinterpreting old evidence.
        self.s.db.execute('INSERT INTO graph_definition_reports VALUES (?,?,?,?,?)',
                          ('old-trial', 'package', originals['compose']['id'], '{}', '2026-10-19T00:00:00Z'))
        self.s.db.commit()
        ensure_asset_webpage_rounds(self.s)
        current = self.s.graph()
        self.assertEqual(len(current['nodes']), len(graph['nodes']) + 1)
        self.assertEqual(len(current['edges']), len(graph['edges']) + 7)
        for c in SPEC['cards'][:-1]:
            actual, old = self.s.find_name(c['name']), originals[c['key']]
            for key in ('id', 'reference_number', 'position_x', 'position_y'):
                self.assertEqual(actual[key], old[key])
        for name in ('fields', 'edges', 'field_usages', 'bindings'):
            now_by_id = {r['id']: r for r in current[name]}
            for row in graph[name]:
                if name == 'fields':
                    self.assertEqual(now_by_id[row['id']]['data_type'], row['data_type'])
                else:
                    self.assertEqual(now_by_id[row['id']], row)
        touched = {n['id'] for n in originals.values()}
        for node in graph['nodes']:
            if node['id'] not in touched:
                self.assertEqual(next(n for n in current['nodes'] if n['id'] == node['id']), node)
        self.assertEqual(self.s.db.execute('SELECT report FROM graph_definition_reports WHERE id=?', ('old-trial',)).fetchone()[0], '{}')
        rules = self.s.find_name(SPEC['cards'][-1]['name'])
        refs = [b for b in current['bindings'] if b['config'].get('role') == 'documentation_reference']
        self.assertEqual(len(refs), 7)
        self.assertTrue(all(b['kind'] == 'reference' and b['config']['trigger'] == 'none' for b in refs))
        self.assertEqual(self.model.contract(rules['id'])['config']['action']['implementation'], 'unknown')
        self.assertFalse(self.model.cycles())
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertIn(PATH, self.model.package()['definitions'])
        before = self.snapshot()
        ensure_asset_webpage_rounds(self.s)
        self.assertEqual(before, self.snapshot())

    def test_interruption_rolls_back_whole_upgrade(self):
        before = self.snapshot()
        with patch.object(self.s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_asset_webpage_rounds(self.s)
        self.assertEqual(before, self.snapshot())
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())

    def test_user_definition_runtime_field_or_mapping_edits_block_without_overwrite(self):
        for change in ('definition', 'runtime', 'field', 'mapping', 'binding'):
            with self.subTest(change=change):
                self.s.db.execute('SAVEPOINT user_edit')
                card = self.s.find_name(OLD['cards'][4]['name'])
                if change == 'definition':
                    self.s.db.execute('UPDATE nodes SET formula=? WHERE id=?', ('User formula', card['id']))
                elif change == 'runtime':
                    cfg = self.model.contract(card['id'])['config']
                    cfg['resource']['physical_binding'] = 'live-tool'
                    self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (json.dumps(cfg), card['id']))
                elif change == 'field':
                    self.s.db.execute('UPDATE node_fields SET definition=? WHERE node_id=?', ('User field', card['id']))
                elif change == 'mapping':
                    self.s.db.execute('UPDATE edge_field_usages SET usage_note=?', ('User mapping',))
                else:
                    self.s.db.execute("UPDATE edge_bindings SET config=? WHERE kind='reference'", ('{"trigger":"none","user_rule":true}',))
                self.s.db.execute('RELEASE user_edit')
                self.s.db.commit()
                before = self.snapshot()
                with self.assertRaisesRegex(ValueError, 'changed'):
                    ensure_asset_webpage_rounds(self.s)
                self.assertEqual(before, self.snapshot())
                # Fresh fixture for the next independent edit.
                if change != 'binding':
                    self.tearDown()
                    self.setUp()

    def test_unrelated_edges_and_requirements_are_not_removed(self):
        card = self.s.find_name(OLD['cards'][4]['name'])
        extra = self.s.create_node({'name': 'User consumer', 'kind': 'process'})
        self.s.create_edge({'upstream_id': card['id'], 'downstream_id': extra['id']})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'unrelated'):
            ensure_asset_webpage_rounds(self.s)
        self.assertEqual(before, self.snapshot())

    def test_user_requirement_stops_upgrade(self):
        card = self.s.find_name(OLD['cards'][4]['name'])
        self.s.create_requirement(card['id'], {'name': 'Preserve user requirement'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'user requirements'):
            ensure_asset_webpage_rounds(self.s)
        self.assertEqual(before, self.snapshot())

    def test_question_and_research_record_flow_never_becomes_extra_few_handoff(self):
        cards = {c['name']: c for c in SPEC['cards']}
        for edge in SPEC['connections']:
            if edge.get('kind') == 'reference' or edge['source'] not in cards or edge['target'] not in cards:
                continue
            if '刷新判断' in (edge['source'], edge['target']):
                continue
            self.assertLessEqual(set(edge['fields']), set(cards[edge['source']]['output_fields']))
            self.assertLessEqual(set(cards[edge['target']]['input_fields']), set(edge['fields']))
        self.assertEqual(SPEC['handoff']['input_fields'], ['asset_id', 'action', 'page_ref'])
        self.assertIsNone(SPEC['page_refresh_interval_seconds'])
        ensure_asset_webpage_rounds(self.s)
        for c in SPEC['cards'][2:]:
            fields = {f['name'] for f in self.s.get_fields(self.s.find_name(c['name'])['id'])}
            self.assertFalse(fields & {'reason', 'run_id', 'expected_page_ref'})


if __name__ == '__main__':
    unittest.main()
