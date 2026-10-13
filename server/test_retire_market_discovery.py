import copy
import hashlib
from pathlib import Path
import unittest
from unittest.mock import patch

from card_model import CardModel
from coingecko_identity_handoff import ensure_coingecko_identity_handoff
from retire_market_discovery import ensure_retire_market_discovery, MARKER
import test_coingecko_identity_handoff


class RetireDiscoveryTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_coingecko_identity_handoff.IdentityHandoffTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_coingecko_identity_handoff(self.s)

    def tearDown(self):
        self.fixture.tearDown()

    def test_cleanup_preserves_identity_flow_ids_positions_and_is_idempotent(self):
        s = self.s
        before = copy.deepcopy(s.graph())
        ensure_retire_market_discovery(s)
        after = s.graph()
        for name in ('记录首次有效发现', 'leaderboard_discoveries'):
            self.assertIsNone(s.find_name(name))
        for n in before['nodes']:
            if n['name'] in ('记录首次有效发现', 'leaderboard_discoveries'):
                continue
            updated = s.get_node(n['id'])
            for key in ('id', 'reference_number', 'position_x', 'position_y'):
                self.assertEqual(n[key], updated[key])
            if n['name'] in ('assets', 'asset_identifiers', 'asset_relationships', 'asset_monitoring_rules',
                             'CoinGecko · 筛选无UUID资产', 'CoinGecko · 核实并建档', '确定资产起始评分'):
                self.assertEqual(n, next(x for x in after['nodes'] if x['id'] == n['id']))
        names = {n['id']: n['name'] for n in after['nodes']}
        pairs = {(names[e['upstream_id']], names[e['downstream_id']]) for e in after['edges']}
        for target in ('assets', 'asset_identifiers', '确定资产起始评分', 'CoinGecko · 首次收录新资产'):
            self.assertIn(('CoinGecko · 核实并建档', target), pairs)
        self.assertIn(('Few Understand · indicator.data', '量价评分 · 生成贡献'), pairs)
        for name in ('生成新发现榜', 'leaderboard_emerging'):
            node = s.find_name(name)
            self.assertFalse(any(node['id'] in (e['upstream_id'], e['downstream_id']) for e in after['edges']))
            self.assertEqual(s.get_fields(node['id']), [])
            self.assertEqual(CardModel(s).contract(node['id'])['config']['action']['id'], '')
        self.assertFalse(any(f['name'] in ('discovery_score', 'new_score') for f in after['fields']))
        self.assertFalse(s.db.execute('pragma foreign_key_check').fetchall())
        self.assertFalse(CardModel(s).cycles())
        package = CardModel(s).package()
        self.assertNotIn('catalog/market-polars.v1.json', package['definitions'])
        self.assertNotIn('catalog/polars-indicator-module.v1.json', package['definitions'])
        current = package['definitions']['catalog/market-current.v1.json']['body']
        self.assertNotIn('first_seen', [n['key'] for n in current['nodes']])
        self.assertNotIn('discovery', [r['key'] for r in package['definitions']['catalog/market-scoring.v1.json']['body']['rules']])
        active_ids = {r['id'] for r in package['action_registry']}
        self.assertNotIn('market_polars.first_seen', active_ids)
        self.assertNotIn('market_polars.discoveries_calc', active_ids)
        ensure_retire_market_discovery(s)
        self.assertEqual(package, CardModel(s).package())

    def test_replaced_paths_always_include_the_replacement_digest(self):
        ensure_retire_market_discovery(self.s)
        refs = []
        def collect(value):
            if isinstance(value, dict):
                if value.get('path') in ('catalog/market-current.v1.json', 'catalog/polars-indicator-current.v1.json'):
                    refs.append(value)
                for child in value.values(): collect(child)
            elif isinstance(value, list):
                for child in value: collect(child)
        for row in self.s.db.execute('SELECT config FROM node_contracts'):
            import json
            collect(json.loads(row['config']))
        self.assertTrue(refs)
        self.assertEqual({r['path'] for r in refs}, {'catalog/market-current.v1.json', 'catalog/polars-indicator-current.v1.json'})
        for ref in refs:
            self.assertEqual(ref['revision'], hashlib.sha256(Path(ref['path']).read_bytes()).hexdigest())

    def test_cleanup_includes_shelved_cards(self):
        s = self.s
        hidden = s.find_name('生成新发现榜')['id']
        with patch('workspace_scope.SCOPE', {'shelved_cards': [{'node_id': hidden}]}):
            ensure_retire_market_discovery(s)
            self.assertIsNone(s.find_name('记录首次有效发现'))
            self.assertFalse(s.db.execute('SELECT 1 FROM edges WHERE upstream_id=? OR downstream_id=?', (hidden, hidden)).fetchone())

    def test_new_dependency_blocks_without_mutation(self):
        s = self.s
        new = s.create_node({'name': 'unrelated future consumer', 'kind': 'process'})
        s.create_edge({'upstream_id': s.find_name('leaderboard_discoveries')['id'], 'downstream_id': new['id']})
        before = CardModel(s).package()
        with self.assertRaisesRegex(ValueError, 'unrelated dependency'):
            ensure_retire_market_discovery(s)
        self.assertEqual(before, CardModel(s).package())

    def test_interruption_rolls_back_all_deletes(self):
        s = self.s
        before = CardModel(s).package()
        with patch.object(CardModel, 'validate_config', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_retire_market_discovery(s)
        self.assertEqual(before, CardModel(s).package())
        self.assertFalse(s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())

    def test_surviving_definition_edit_rolls_back(self):
        s = self.s
        s.update_node(s.find_name('量价评分 · 生成贡献')['id'], {'formula': 'another edit'})
        before = CardModel(s).package()
        with self.assertRaisesRegex(ValueError, 'edited surviving definition'):
            ensure_retire_market_discovery(s)
        self.assertEqual(before, CardModel(s).package())


if __name__ == '__main__':
    unittest.main()
