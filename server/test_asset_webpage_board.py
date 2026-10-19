import copy
import json
import unittest
from unittest.mock import patch

from asset_grokbot_flow import ensure_asset_grokbot_flow
from asset_webpage_board import PATH, ROOT, MARKER, ensure_asset_webpage_board
import test_asset_grokbot_flow as previous

SPEC = json.loads((ROOT / PATH).read_text())


class WebpageBoardTest(unittest.TestCase):
    def setUp(self):
        previous.GrokbotBoundaryTest.setUp(self)
        ensure_asset_grokbot_flow(self.s)

    def tearDown(self):
        previous.GrokbotBoundaryTest.tearDown(self)

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_nine_cards_minimal_handoff_preserved_identity_and_unrelated_rows(self):
        before = {n['id']: copy.deepcopy(n) for n in self.s.graph()['nodes']}
        original = self.s.find_name(SPEC['reused_card'])
        ensure_asset_webpage_board(self.s)
        graph = self.s.graph()
        nine = [self.s.find_name(c['name']) for c in SPEC['cards'][2:]]
        self.assertEqual(len(nine), 9)
        self.assertEqual(len(graph['nodes']), len(before) + 8)
        for key in ('id', 'reference_number', 'position_x', 'position_y'):
            self.assertEqual(nine[0][key], original[key])
        changed = {original['id'], self.s.find_name('候选代币筛选')['id'], self.s.find_name('刷新判断')['id']}
        for n in graph['nodes']:
            if n['id'] in before and n['id'] not in changed:
                self.assertEqual(n, before[n['id']])
        incoming = next(e for e in graph['edges'] if e['upstream_id'] == self.s.find_name('刷新判断')['id'] and e['downstream_id'] == nine[0]['id'])
        fields = {f['id']: f for f in graph['fields']}
        usages = [u for u in graph['field_usages'] if u['edge_id'] == incoming['id']]
        self.assertEqual({fields[u['source_field_id']]['name'] for u in usages}, {'asset_id', 'action', 'page_ref'})
        for n in nine:
            self.assertNotIn('reason', {f['name'] for f in self.s.get_fields(n['id'])})
            self.assertNotIn('run_id', {f['name'] for f in self.s.get_fields(n['id'])})
        self.assertEqual({b['branch'] for b in graph['bindings'] if b['edge_id'] == incoming['id']}, {'first', 'due'})
        writes = [b for b in graph['bindings'] if b['kind'] == 'write' and next(e for e in graph['edges'] if e['id'] == b['edge_id'])['downstream_id'] == self.s.find_name('asset_pages')['id']]
        self.assertEqual(len(writes), 1)
        self.assertEqual(next(e for e in graph['edges'] if e['id'] == writes[0]['edge_id'])['upstream_id'], nine[-1]['id'])
        self.assertEqual(writes[0]['config']['write_guard']['identity_check'], 'confirmed')
        self.assertEqual(writes[0]['config']['write_guard']['selfcheck'], 'passed')
        refs = [b for b in graph['bindings'] if b['config'].get('role') == 'bounded_internal_revision_reference']
        self.assertEqual(len(refs), 2)
        self.assertTrue(all(b['kind'] == 'reference' and b['config']['trigger'] == 'none' and b['config']['max_iterations'] == 1 for b in refs))
        self.assertFalse(self.model.cycles())
        self.assertFalse(self.s.db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertIn(PATH, self.model.package()['definitions'])
        saved = self.snapshot()
        ensure_asset_webpage_board(self.s)
        self.assertEqual(self.snapshot(), saved)

    def test_historical_nullable_candidate_fields_are_preserved(self):
        node = self.s.find_name('候选代币筛选')
        for name, typ in [('calculated_at', 'UTC timestamp | null'), ('score', 'number | null'), ('algorithm_version', 'string | null')]:
            self.s.db.execute('UPDATE node_fields SET data_type=? WHERE node_id=? AND name=?', (typ, node['id'], name))
        self.s.db.commit()
        before = {f['name']: f['data_type'] for f in self.s.get_fields(node['id'])}
        ensure_asset_webpage_board(self.s)
        self.assertEqual(before, {f['name']: f['data_type'] for f in self.s.get_fields(node['id'])})

    def test_historical_report_is_preserved_but_not_current_verification(self):
        from card_progress import CardProgress
        old = self.s.find_name(SPEC['reused_card'])
        report = json.dumps({'schema_version': 'card-review.v1', 'definition_revision': 'old-aggregate',
                             'summary': 'Old incomplete report', 'status': 'incomplete'})
        self.s.db.execute('INSERT INTO graph_definition_reports VALUES (?,?,?,?,?)', ('historical', 'package', old['id'], report, '2026-10-18T00:00:00Z'))
        self.s.db.commit()
        ensure_asset_webpage_board(self.s)
        self.assertEqual(self.s.db.execute('SELECT report FROM graph_definition_reports WHERE id=?', ('historical',)).fetchone()[0], report)
        progress = CardProgress(self.model).snapshot(self.s.graph())[old['id']]
        self.assertTrue(progress['stale'])
        self.assertEqual(progress['status'], 'unknown')

    def test_interrupted_upgrade_rolls_back_every_row(self):
        before = self.snapshot()
        with patch.object(self.s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_asset_webpage_board(self.s)
        self.assertEqual(self.snapshot(), before)

    def test_user_edge_stops_upgrade_without_overwriting(self):
        n = self.s.create_node({'name': 'Unrelated page consumer', 'kind': 'process'})
        old = self.s.find_name(SPEC['reused_card'])
        self.s.create_edge({'upstream_id': old['id'], 'downstream_id': n['id']})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'unrelated'):
            ensure_asset_webpage_board(self.s)
        self.assertEqual(self.snapshot(), before)

    def test_changed_prose_and_runtime_binding_are_preserved(self):
        old = self.s.find_name(SPEC['reused_card'])
        self.s.db.execute('UPDATE nodes SET formula=? WHERE id=?', ('User revised this rule', old['id']))
        self.s.db.commit()
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'changed/protected'):
            ensure_asset_webpage_board(self.s)
        self.assertEqual(self.snapshot(), before)

    def test_user_requirement_stops_upgrade(self):
        old = self.s.find_name(SPEC['reused_card'])
        self.s.create_requirement(old['id'], {'name': 'User requirement'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'user requirements'):
            ensure_asset_webpage_board(self.s)
        self.assertEqual(self.snapshot(), before)

    def test_sources_outputs_satisfy_forward_inputs(self):
        cards = {c['name']: c for c in SPEC['cards']}
        for e in SPEC['connections']:
            if e.get('kind') == 'reference' or e['source'] not in cards or e['target'] not in cards:
                continue
            if e['source'] == '刷新判断' or e['target'] == '刷新判断':
                continue  # other identity input is explicitly supplied by the identifiers table
            self.assertLessEqual(set(e['fields']), set(cards[e['source']]['output_fields']))
            self.assertLessEqual(set(cards[e['target']]['input_fields']), set(e['fields']))
        self.assertEqual(SPEC['handoff']['input_fields'], ['asset_id', 'action', 'page_ref'])
        self.assertIsNone(SPEC['page_refresh_interval_seconds'])


if __name__ == '__main__':
    unittest.main()
