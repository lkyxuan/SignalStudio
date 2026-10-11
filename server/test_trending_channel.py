import copy
import json
import unittest
from unittest.mock import patch

from card_model import CardModel
from coingecko_trending import ensure_coingecko_trending
from trending_channel import ensure_trending_channel, MARKER, CATALOG
import test_coingecko_trending


class TrendingChannelTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_coingecko_trending.CoinGeckoTrendingTest()
        self.fixture.setUp()
        self.fixture.dependencies()
        self.service = self.fixture.service
        ensure_coingecko_trending(self.service)
        self.model = CardModel(self.service)
        self.model.migrate()

    def tearDown(self):
        self.fixture.tearDown()

    def test_route_bindings_field_lineage_and_repeat_preserve_edits(self):
        s = self.service
        before = copy.deepcopy(s.graph())
        source = s.find_name('coingecko.search_trending')
        consumer = s.find_name('CoinGecko · 热榜上榜加分')
        old = next(e for e in before['edges'] if e['upstream_id'] == source['id'] and e['downstream_id'] == consumer['id'])
        old_fields = {f['id']: f for f in s.get_fields(source['id'])}
        old_usages = s.get_field_usages(old['id'])
        ensure_trending_channel(s)
        after = s.graph()
        channel = s.find_name('Few Understand · social.data')
        self.assertEqual(len(after['nodes']), len(before['nodes']) + 1)
        self.assertEqual(len(after['edges']), len(before['edges']) + 1)
        self.assertEqual(s.get_edge(old['id'])['upstream_id'], channel['id'])
        producer = next(e for e in after['edges'] if e['upstream_id'] == source['id'])
        self.assertEqual(producer['downstream_id'], channel['id'])
        for edge, expected in [(producer, 'publish'), (old, 'consume')]:
            self.assertEqual([b['kind'] for b in after['bindings'] if b['edge_id'] == edge['id']], [expected])
        settings = self.model.contract(channel['id'])['config']['resource']
        self.assertEqual(settings['topic'], 'social.data')
        self.assertEqual(settings['header_registry']['status'], 'required_not_registered_or_verified')
        self.assertEqual(settings['message_key'], 'data.slot_start')
        self.assertEqual(settings['payload_record_path'], 'data')
        new_usages = {u['id']: u for u in s.get_field_usages(old['id'])}
        for u in old_usages:
            mapped = new_usages[u['id']]
            field = s.get_field(mapped['source_field_id'])
            self.assertEqual(field['node_id'], channel['id'])
            self.assertEqual(field['name'], old_fields[u['source_field_id']]['name'])
            self.assertEqual(mapped['target_field_id'], u['target_field_id'])
            self.assertEqual(mapped['usage_note'], u['usage_note'])
        for n in before['nodes']:
            current = s.get_node(n['id'])
            self.assertEqual([n[k] for k in ('reference_number', 'position_x', 'position_y', 'formula', 'definition')],
                             [current[k] for k in ('reference_number', 'position_x', 'position_y', 'formula', 'definition')])
            if n['id'] != consumer['id']:
                self.assertEqual(n['card_contract'], next(x for x in after['nodes'] if x['id'] == n['id'])['card_contract'])
        for e in before['edges']:
            if e['id'] != old['id']:
                self.assertEqual(s.get_edge(e['id']), e)
        self.assertFalse(s.db.execute('PRAGMA foreign_key_check').fetchall())
        self.assertEqual(self.model.cycles(), [])
        s.update_node(channel['id'], {'definition': 'later edit'})
        saved = s.graph()
        ensure_trending_channel(s)
        self.assertEqual(saved, s.graph())
        s.delete_node(channel['id'])
        saved = s.graph()
        ensure_trending_channel(s)
        self.assertEqual(saved, s.graph())

    def test_interruption_rolls_back_every_mutation(self):
        s = self.service
        before = s.graph()
        with patch.object(s, 'create_field_usage', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_trending_channel(s)
        self.assertEqual(before, s.graph())
        self.assertIsNone(s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())
        ensure_trending_channel(s)

    def test_existing_custom_social_channel_requires_review(self):
        s = self.service
        s.create_node({'name': 'Few Understand · social.data', 'type': 'Redpanda Topic', 'notes': 'user config'})
        before = s.graph()
        with self.assertRaisesRegex(ValueError, 'existing social.data'):
            ensure_trending_channel(s)
        self.assertEqual(before, s.graph())

    def test_custom_input_binding_requires_review(self):
        s = self.service
        source = s.find_name('coingecko.search_trending')
        consumer = s.find_name('CoinGecko · 热榜上榜加分')
        edge = next(e for e in s.graph()['edges'] if e['upstream_id'] == source['id'] and e['downstream_id'] == consumer['id'])
        s.db.execute("UPDATE edge_bindings SET kind='reference' WHERE edge_id=?", (edge['id'],))
        s.db.commit()
        before = s.graph()
        with self.assertRaisesRegex(ValueError, 'edited input binding'):
            ensure_trending_channel(s)
        self.assertEqual(before, s.graph())

    def test_catalog_covers_all_ten_existing_topics_and_preserves_rules(self):
        spec = json.loads(CATALOG.read_text())
        self.assertEqual(len(spec['registry_basis']['existing_topics']), 10)
        self.assertEqual({t for a in spec['reuse_assessment'] for t in a['topics']},
                         set(spec['registry_basis']['existing_topics']))
        self.assertEqual([a['topics'] for a in spec['reuse_assessment'] if a['decision'] == 'reuse'], [['social.data']])
        self.assertEqual([h['name'] for h in spec['headers']], ['source', 'type', 'category'])
        self.assertIn('成功空榜为[]，失败为null', spec['fields'][0]['definition'])

    def test_user_trigger_is_not_overwritten(self):
        s = self.service
        consumer = s.find_name('CoinGecko · 热榜上榜加分')
        s.db.execute("UPDATE node_contracts SET config=json_set(config,'$.trigger.kind','schedule') WHERE node_id=?", (consumer['id'],))
        s.db.commit()
        before = s.graph()
        with self.assertRaisesRegex(ValueError, 'edited consumer trigger'):
            ensure_trending_channel(s)
        self.assertEqual(before, s.graph())
