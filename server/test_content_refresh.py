import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from graph_service import GraphService
from source_contract_store import SourceContractStore
from leaderboard_simple import ensure_leaderboard_simple
from leaderboard_scaffolds import ensure_leaderboard_scaffolds
from content_refresh import (ensure_content_refresh, _ensure_legacy_content_refresh,
                             CATALOG, MARKER, SPLIT_MARKER)


class ContentRefreshTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        self.service.ensure_system_tables()
        sources = SourceContractStore().contract
        self.service.ensure_source_contract_sources(sources['operations'] + sources['resources'])
        self.service.group_node_references_once()
        ensure_leaderboard_scaffolds(self.service)
        ensure_leaderboard_simple(self.service)

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def test_install_is_additive_focused_and_idempotent(self):
        before = self.service.graph()
        ensure_content_refresh(self.service)
        after = self.service.graph()
        catalog = json.loads(CATALOG.read_text())
        self.assertEqual(len(after['nodes']), len(before['nodes']) + 5)
        self.assertEqual(len(after['edges']), len(before['edges']) + 13)
        for node in before['nodes']:
            self.assertEqual(node, self.service.get_node(node['id']))
        engine = self.service.find_name(catalog['node']['name'])
        result = self.service.find_name(catalog['result']['name'])
        self.assertEqual(result['is_system_state'], 1)
        self.assertGreaterEqual(engine['reference_number'], 3000)
        self.assertLess(result['reference_number'], 2000)
        for board in catalog['boards']:
            source = self.service.find_name(board['table_name'])
            edge = next(e for e in after['edges'] if e['upstream_id'] == source['id'] and e['downstream_id'] == engine['id'])
            usages = [u for u in after['field_usages'] if u['edge_id'] == edge['id']]
            field_ids = {u['source_field_id'] for u in usages}
            used = {f['name'] for f in after['fields'] if f['id'] in field_ids}
            self.assertEqual(used, set(board['consumed_fields']))
        self.service.update_node(engine['id'], {'formula': 'Later user design'})
        saved = copy.deepcopy(self.service.graph())
        ensure_content_refresh(self.service)
        self.assertEqual(saved, self.service.graph())

    def test_partial_failure_rolls_back_nodes_edges_fields_and_marker(self):
        before = self.service.graph()
        with patch.object(self.service, 'create_edge', side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError):
                ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_content_refresh(self.service)

    def test_existing_name_is_not_overwritten(self):
        catalog = json.loads(CATALOG.read_text())
        self.service.create_node({'name': catalog['legacy_node']['name'], 'type': 'Metric'})
        before = self.service.graph()
        with self.assertRaises(ValueError):
            ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())

    def test_fresh_split_name_conflict_does_not_install_legacy_cards(self):
        catalog = json.loads(CATALOG.read_text())
        self.service.create_node({'name': catalog['stages'][1]['name'], 'type': 'Metric'})
        before = copy.deepcopy(self.service.graph())
        with self.assertRaises(ValueError):
            ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())

    def test_missing_prerequisite_rejects_before_mutation(self):
        before = self.service.graph()
        original = self.service.find_name
        with patch.object(self.service, 'find_name', side_effect=lambda name: None if name == 'leaderboard_warming' else original(name)):
            with self.assertRaises(ValueError):
                ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())


    def test_upgrade_preserves_ids_positions_user_fields_and_unrelated_edges(self):
        _ensure_legacy_content_refresh(self.service)
        catalog = json.loads(CATALOG.read_text())
        old = self.service.find_name(catalog['legacy_node']['name'])
        result = self.service.find_name(catalog['result']['name'])
        self.service.update_node(old['id'], {'position_x': 123, 'position_y': 456})
        extra = self.service.create_node({'name': 'User destination', 'type': 'Metric'})
        field = next(f for f in self.service.get_fields(old['id']) if f['name'] == 'content_json')
        user_edge = self.service.create_edge({'upstream_id': old['id'], 'downstream_id': extra['id']})
        usage = self.service.create_field_usage(user_edge['id'], {'source_field_id': field['id']})
        before = copy.deepcopy(self.service.graph())
        ensure_content_refresh(self.service)
        after = self.service.graph()
        first = self.service.find_name(catalog['stages'][0]['name'])
        self.assertEqual(first['id'], old['id'])
        self.assertEqual(first['reference_number'], old['reference_number'])
        self.assertEqual((first['position_x'], first['position_y']), (123, 456))
        self.assertEqual(self.service.get_node(result['id']), result)
        for node in before['nodes']:
            if node['id'] != old['id']:
                self.assertEqual(node, self.service.get_node(node['id']))
        self.assertEqual(self.service.get_edge(user_edge['id']), user_edge)
        self.assertIn(usage, after['field_usages'])
        self.assertIn(field, self.service.get_fields(old['id']))
        self.assertEqual(len(after['nodes']), len(before['nodes']) + 3)
        self.assertEqual(len(after['edges']), len(before['edges']) + 5)
        saved = copy.deepcopy(after)
        ensure_content_refresh(self.service)
        self.assertEqual(saved, self.service.graph())

    def test_split_edges_map_exact_stage_fields_and_remove_old_shortcuts(self):
        ensure_content_refresh(self.service)
        c = json.loads(CATALOG.read_text())
        graph = self.service.graph()
        nodes = {stage['key']: self.service.find_name(stage['name']) for stage in c['stages']}
        fields = {f['id']: f for f in graph['fields']}
        for dependency in c['connections']:
            source = nodes.get(dependency['source']) or self.service.find_name(dependency['source'])
            target = nodes.get(dependency['target']) or self.service.find_name(dependency['target'])
            edge = next(e for e in graph['edges'] if e['upstream_id'] == source['id'] and e['downstream_id'] == target['id'])
            usages = [u for u in graph['field_usages'] if u['edge_id'] == edge['id']]
            self.assertEqual({fields[u['source_field_id']]['name'] for u in usages}, set(dependency['fields']))
            for usage in usages:
                self.assertEqual(fields[usage['target_field_id']]['name'], fields[usage['source_field_id']]['name'])
        first = nodes['candidates']
        result = self.service.find_name(c['result']['name'])
        self.assertFalse(any(e['upstream_id'] == first['id'] and e['downstream_id'] == result['id'] for e in graph['edges']))
        self.assertFalse(any(e['upstream_id'] == result['id'] and e['downstream_id'] == first['id'] for e in graph['edges']))
        self.assertEqual(c['result']['observed_rows'], [])
        self.assertIsNone(c['result']['physical_binding'])

    def test_upgrade_failure_rolls_back_rename_edges_fields_counters_and_audit(self):
        _ensure_legacy_content_refresh(self.service)
        before = copy.deepcopy(self.service.graph())
        before_meta = list(self.service.db.execute('SELECT * FROM schema_meta ORDER BY key'))
        events = self.service.db.execute('SELECT COUNT(*) FROM change_events').fetchone()[0]
        with patch.object(self.service, 'create_edge', side_effect=RuntimeError('interrupted split')):
            with self.assertRaises(RuntimeError):
                ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())
        self.assertEqual(before_meta, list(self.service.db.execute('SELECT * FROM schema_meta ORDER BY key')))
        self.assertEqual(events, self.service.db.execute('SELECT COUNT(*) FROM change_events').fetchone()[0])
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (SPLIT_MARKER,)).fetchone())
        ensure_content_refresh(self.service)

    def test_split_conflict_and_missing_source_do_not_mutate_legacy_design(self):
        _ensure_legacy_content_refresh(self.service)
        c = json.loads(CATALOG.read_text())
        original = self.service.find_name
        before = copy.deepcopy(self.service.graph())
        with patch.object(self.service, 'find_name', side_effect=lambda name: None if name == 'asset_identifiers' else original(name)):
            with self.assertRaises(ValueError):
                ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())
        self.service.create_node({'name': c['stages'][1]['name'], 'type': 'Metric'})
        before = copy.deepcopy(self.service.graph())
        with self.assertRaises(ValueError):
            ensure_content_refresh(self.service)
        self.assertEqual(before, self.service.graph())


if __name__ == '__main__':
    unittest.main()
