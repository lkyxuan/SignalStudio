import copy
import json
import unittest
from unittest.mock import patch

from card_model import CardModel
from coingecko_indicator_signals import ensure_coingecko_indicator_signals
from polars_indicator_module import CATALOG, MARKER, ensure_polars_indicator_module
import test_coingecko_indicator_signals


class PolarsIndicatorModuleTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_coingecko_indicator_signals.IndicatorSignalsTest()
        self.fixture.setUp()
        self.service = self.fixture.service
        ensure_coingecko_indicator_signals(self.service)
        self.spec = json.loads(CATALOG.read_text())

    def tearDown(self):
        self.fixture.tearDown()

    def test_ownership_single_publisher_precise_dependencies_and_export(self):
        s = self.service
        before = copy.deepcopy(s.graph())
        ensure_polars_indicator_module(s)
        graph = s.graph()
        parent = s.find_name(self.spec['parent']['name'])
        channel = s.find_name(self.spec['channel'])
        model = CardModel(s)
        config = model.contract(parent['id'])['config']['resource']
        self.assertEqual(len(config['module_children']), 5)
        refs = [n['reference_number'] for n in graph['nodes']]
        self.assertEqual(len(refs), len(set(refs)))
        for card in self.spec['cards']:
            node = s.find_name(card['name'])
            child = model.contract(node['id'])['config']
            self.assertEqual(child['resource']['parent_module']['node_id'], parent['id'])
            self.assertEqual(child['trigger']['kind'], 'unspecified')
            self.assertEqual(child['resource']['output_field'], card['output'])
            self.assertTrue({'observation_id', 'asset_id', card['output']} <= {f['name'] for f in s.get_fields(node['id'])})
            raw_edge = next(e for e in graph['edges'] if e['downstream_id'] == node['id'] and s.get_node(e['upstream_id'])['name'] == self.spec['input'])
            self.assertEqual([b['kind'] for b in graph['bindings'] if b['edge_id'] == raw_edge['id']], ['reference'])
            self.assertFalse(any(e['upstream_id'] == node['id'] and e['downstream_id'] == channel['id'] for e in graph['edges']))
        self.assertEqual([e['upstream_id'] for e in graph['edges'] if e['downstream_id'] == channel['id']], [parent['id']])
        affected = {parent['id'], channel['id']} | {s.find_name(c['name'])['id'] for c in self.spec['consumers']}
        for old in before['nodes']:
            new = next(n for n in graph['nodes'] if n['id'] == old['id'])
            self.assertEqual([old[k] for k in ('id','reference_number','position_x','position_y')],
                             [new[k] for k in ('id','reference_number','position_x','position_y')])
            if old['id'] not in affected:
                self.assertEqual(old, new)
            elif old['id'] not in (parent['id'], channel['id']):
                self.assertEqual(old['formula'], new['formula'])
        for c in self.spec['consumers']:
            node = s.find_name(c['name'])
            edge = next(e for e in graph['edges'] if e['upstream_id'] == channel['id'] and e['downstream_id'] == node['id'])
            used = {s.get_field(u['source_field_id'])['name'] for u in s.get_field_usages(edge['id'])}
            self.assertEqual(used, set(c['required_fields']))
            self.assertNotIn('ath_change_percentage', used)
        package = model.package()
        self.assertIn('catalog/polars-indicator-module.v1.json', package['definitions'])
        self.assertEqual(len([a for a in package['action_registry'] if a['id'].startswith('polars_indicator.')]), 5)
        self.assertFalse(model.cycles())
        self.assertFalse(s.db.execute('PRAGMA foreign_key_check').fetchall())
        child = s.find_name(self.spec['cards'][0]['name'])
        s.update_node(child['id'], {'formula': 'later user edit'})
        package = model.package()
        ensure_polars_indicator_module(s)
        self.assertEqual(package, model.package())

    def test_interruption_rolls_back_numbers_cards_mappings_and_configs(self):
        s = self.service
        before = CardModel(s).package()
        counters = list(s.db.execute("SELECT key,value FROM schema_meta WHERE key LIKE 'next_%' ORDER BY key"))
        with patch.object(s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_polars_indicator_module(s)
        self.assertEqual(before, CardModel(s).package())
        self.assertEqual(counters, list(s.db.execute("SELECT key,value FROM schema_meta WHERE key LIKE 'next_%' ORDER BY key")))
        self.assertFalse(s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())

    def test_edited_parent_or_mapping_and_name_conflict_are_preserved(self):
        s = self.service
        node = s.find_name(self.spec['parent']['name'])
        old_formula = node['formula']
        s.update_node(node['id'], {'formula': 'user formula'})
        before = CardModel(s).package()
        with self.assertRaisesRegex(ValueError, 'definition/configuration changed'):
            ensure_polars_indicator_module(s)
        self.assertEqual(before, CardModel(s).package())
        s.update_node(node['id'], {'formula': old_formula})
        child = s.create_node({'name': self.spec['cards'][0]['name'], 'kind': 'process'})
        before = CardModel(s).package()
        with self.assertRaisesRegex(ValueError, 'name conflict'):
            ensure_polars_indicator_module(s)
        self.assertEqual(before, CardModel(s).package())
        s.db.execute('DELETE FROM nodes WHERE id=?', (child['id'],)); s.db.commit()
        channel = s.find_name(self.spec['channel'])
        target = s.find_name(self.spec['consumers'][0]['name'])
        edge = next(e for e in s.graph()['edges'] if e['upstream_id'] == channel['id'] and e['downstream_id'] == target['id'])
        usage = s.get_field_usages(edge['id'])[0]
        s.update_field_usage(usage['id'], {'usage_note': 'user mapping'})
        before = CardModel(s).package()
        with self.assertRaisesRegex(ValueError, 'input mapping edited'):
            ensure_polars_indicator_module(s)
        self.assertEqual(before, CardModel(s).package())


if __name__ == '__main__':
    unittest.main()
