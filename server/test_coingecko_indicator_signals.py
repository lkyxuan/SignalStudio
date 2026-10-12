import copy
import json
import unittest
from unittest.mock import patch

from card_model import CardModel
from coingecko_indicator_signals import CATALOG, MARKER, ensure_coingecko_indicator_signals
from market_polars import ensure_market_polars
import test_market_channel


class IndicatorSignalsTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_market_channel.MarketChannelTest()
        self.fixture.setUp()
        self.service = self.fixture.service
        from market_channel import ensure_market_channel
        ensure_market_channel(self.service)
        self.service.create_node({'name':'维护近期评分窗口', 'kind':'process'})
        ensure_market_polars(self.service)

    def tearDown(self):
        self.fixture.tearDown()

    def test_rewire_preserves_identity_layout_output_and_unrelated_work(self):
        s = self.service
        spec = json.loads(CATALOG.read_text())
        before = s.graph()
        ensure_coingecko_indicator_signals(s)
        after = s.graph()
        channel = s.find_name(spec['input'])
        for card in spec['cards']:
            old = next(n for n in before['nodes'] if n['name']==card['name'])
            node = s.get_node(old['id'])
            self.assertEqual([old[k] for k in ('reference_number','position_x','position_y')],
                             [node[k] for k in ('reference_number','position_x','position_y')])
            incoming = [e for e in after['edges'] if e['downstream_id']==node['id']]
            self.assertEqual([e['upstream_id'] for e in incoming], [channel['id']])
            self.assertTrue(s.get_field_usages(incoming[0]['id']))
            self.assertEqual([b['kind'] for b in after['bindings'] if b['edge_id']==incoming[0]['id']], ['consume'])
            self.assertEqual([e for e in before['edges'] if e['upstream_id']==node['id']],
                             [e for e in after['edges'] if e['upstream_id']==node['id']])
        changed = {c['name'] for c in spec['cards']} | {'Few Understand · market.snapshot',spec['input'],spec['output'],'Polars · 计算 CoinGecko 量价指标'}
        for n in before['nodes']:
            if n['name'] not in changed:
                updated=next(x for x in after['nodes'] if x['id']==n['id'])
                # Catalog pin changes are expected, but user-facing data and layout are preserved.
                self.assertEqual({k:v for k,v in n.items() if k!='card_contract'},
                                 {k:v for k,v in updated.items() if k!='card_contract'})
        package = CardModel(s).package()
        self.assertIn('catalog/coingecko-indicator-signals.v1.json',package['definitions'])
        self.assertEqual(len([a for a in package['action_registry'] if a['id'].startswith('coingecko_alerts.')]),5)
        ensure_coingecko_indicator_signals(s)
        self.assertEqual(package, CardModel(s).package())
        self.assertFalse(s.db.execute('PRAGMA foreign_key_check').fetchall())

    def test_old_polars_schema_upgrades_and_ath_mapping_is_complete(self):
        s=self.service; spec=json.loads(CATALOG.read_text())
        p=s.find_name('Polars · 计算 CoinGecko 量价指标')
        with s.db:
            s.db.execute('UPDATE nodes SET definition=?,formula=? WHERE id=?',
                         (spec['previous_polars']['description'],spec['previous_polars']['algorithm'],p['id']))
            for name in (p['name'], spec['input']):
                s.db.execute("DELETE FROM node_fields WHERE node_id=? AND name='ath_change_percentage'",(s.find_name(name)['id'],))
        ensure_coingecko_indicator_signals(s)
        for source,target in (('Few Understand · market.snapshot',p['name']),(p['name'],spec['input'])):
            a,b=s.find_name(source),s.find_name(target)
            e=next(e for e in s.graph()['edges'] if e['upstream_id']==a['id'] and e['downstream_id']==b['id'])
            f=next(f for f in s.get_fields(a['id']) if f['name']=='ath_change_percentage')
            self.assertTrue(any(u['source_field_id']==f['id'] for u in s.get_field_usages(e['id'])))

    def test_conflict_and_interruption_leave_no_partial_migration(self):
        s=self.service
        before=copy.deepcopy(CardModel(s).package())
        with patch.object(s,'create_field_usage',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):
                ensure_coingecko_indicator_signals(s)
        self.assertEqual(before,CardModel(s).package())
        self.assertFalse(s.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())
        node=s.find_name('CoinGecko · 24 小时大涨')
        s.update_node(node['id'],{'formula':'user changed threshold'})
        before=copy.deepcopy(CardModel(s).package())
        with self.assertRaisesRegex(ValueError,'definition changed'):
            ensure_coingecko_indicator_signals(s)
        self.assertEqual(before,CardModel(s).package())
