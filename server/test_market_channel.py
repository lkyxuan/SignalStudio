import copy
import unittest
from unittest.mock import patch

from card_model import CardModel
from coingecko_reference_cards import ensure_coingecko_reference_cards
from leaderboard_foundation import ensure_leaderboard_foundation
from market_channel import ensure_market_channel, MARKER
from scripts.seed_example_signal import seed
from signal_contract_store import SignalContractStore
from source_contract_store import SourceContractStore
import test_leaderboard_foundation


class MarketChannelTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_leaderboard_foundation.ThreeBoardFoundationTest()
        self.fixture.setUp()
        self.service = s = self.fixture.service
        ensure_leaderboard_foundation(s)
        ensure_coingecko_reference_cards(s)
        self.signals = SignalContractStore(SourceContractStore())
        source = s.find_name('coingecko.coins_markets')
        with s.db:
            for field in s.get_fields(source['id']):
                s.db.execute('UPDATE node_fields SET catalog_field_id=? WHERE id=?',
                             ('source-contracts.v1::coingecko.coins_markets::' + field['name'], field['id']))
        candidate = seed(s, SourceContractStore(), self.signals)
        source = s.find_name('coingecko.coins_markets')
        retired = s.create_node({'name': 'CoinGecko 市场 Topic', 'type': 'Redpanda Topic'})
        fields = {f['id']: f for f in s.get_fields(source['id'])}
        replacements = {f['id']: s.create_field(retired['id'], {'name': f['name'], 'data_type': f['data_type']})
                        for f in fields.values()}
        old = next(e for e in s.graph()['edges'] if e['upstream_id'] == source['id'] and e['downstream_id'] == candidate['id'])
        with s.db:
            s.db.execute('UPDATE edges SET upstream_id=? WHERE id=?', (retired['id'], old['id']))
            for usage in s.get_field_usages(old['id']):
                s.db.execute('UPDATE edge_field_usages SET source_field_id=? WHERE id=?',
                             (replacements[usage['source_field_id']]['id'], usage['id']))
            s.db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (old['id'],))
            CardModel(s).ensure_edge(s.get_edge(old['id']))
        s.create_edge({'upstream_id': source['id'], 'downstream_id': retired['id']})

    def tearDown(self):
        self.fixture.tearDown()

    def test_single_channel_consumers_lineage_and_repeat_preserve_user_edits(self):
        s = self.service
        before = s.graph()
        ensure_market_channel(s)
        after = s.graph()
        self.assertIsNone(s.find_name('CoinGecko 市场 Topic'))
        channel = s.find_name('Few Understand · market.snapshot')
        source = s.find_name('coingecko.coins_markets')
        source_channels = [s.get_node(e['downstream_id'])['name'] for e in after['edges']
                           if e['upstream_id'] == source['id'] and s.get_node(e['downstream_id'])['type'] == 'Redpanda Topic']
        self.assertEqual(source_channels, [channel['name']])
        for name in ('归一结构化榜单观测', '市场交易活跃候选'):
            node = s.find_name(name)
            incoming = [e for e in after['edges'] if e['downstream_id'] == node['id']]
            self.assertFalse(any(e['upstream_id'] == source['id'] for e in incoming))
            edge = next(e for e in incoming if e['upstream_id'] == channel['id'])
            self.assertEqual([b['kind'] for b in after['bindings'] if b['edge_id'] == edge['id']], ['consume'])
            for u in s.get_field_usages(edge['id']):
                self.assertEqual(s.get_field(u['source_field_id'])['node_id'], channel['id'])
        for n in before['nodes']:
            if n['name'] == 'CoinGecko 市场 Topic':
                continue
            updated = s.get_node(n['id'])
            self.assertEqual([n[k] for k in ('reference_number', 'position_x', 'position_y')],
                             [updated[k] for k in ('reference_number', 'position_x', 'position_y')])
            if n['name'] not in ('Few Understand · market.snapshot', '归一结构化榜单观测', '市场交易活跃候选'):
                self.assertEqual(n['card_contract'], next(x for x in after['nodes'] if x['id'] == n['id'])['card_contract'])
        self.assertEqual(self.signals.package(s, 'coingecko_market_turnover_candidate')['implementation_readiness'],
                         {'status': 'ready', 'issues': []})
        self.assertFalse(s.db.execute('PRAGMA foreign_key_check').fetchall())
        s.update_node(channel['id'], {'definition': 'later user edit'})
        saved = copy.deepcopy(s.graph())
        ensure_market_channel(s)
        self.assertEqual(saved, s.graph())

    def test_unexpected_retired_consumer_blocks_without_changes(self):
        s = self.service
        extra = s.create_node({'name': 'extra consumer', 'type': 'Metric'})
        s.create_edge({'upstream_id': s.find_name('CoinGecko 市场 Topic')['id'], 'downstream_id': extra['id']})
        before = s.graph()
        with self.assertRaisesRegex(ValueError, 'other dependencies'):
            ensure_market_channel(s)
        self.assertEqual(before, s.graph())

    def test_interruption_rolls_back_whole_transition(self):
        s = self.service
        before = s.graph()
        with patch.object(s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_market_channel(s)
        self.assertEqual(before, s.graph())
        self.assertIsNone(s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_market_channel(s)

    def test_concurrent_channel_settings_are_not_overwritten(self):
        s = self.service
        channel = s.find_name('Few Understand · market.snapshot')
        s.update_node(channel['id'], {'notes': '{"topic":"user.custom"}'})
        before = s.graph()
        with self.assertRaisesRegex(ValueError, 'settings changed'):
            ensure_market_channel(s)
        self.assertEqual(before, s.graph())
