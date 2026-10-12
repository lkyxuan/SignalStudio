import copy
import unittest
from unittest.mock import patch

from card_model import CardModel
from coingecko_identity_handoff import ensure_coingecko_identity_handoff, MARKER
from polars_indicator_flow import ensure_polars_indicator_flow
import test_polars_indicator_flow


class IdentityHandoffTest(unittest.TestCase):
    def setUp(self):
        self.fixture=test_polars_indicator_flow.PolarsFlowTest()
        self.fixture.setUp()
        self.s=self.fixture.s
        ensure_polars_indicator_flow(self.s)
        # The smaller upstream migration fixture does not include the existing shared initial scorer.
        self.s.create_node({'name':'确定资产起始评分','kind':'process'})

    def tearDown(self):
        self.fixture.tearDown()

    def test_null_identity_path_bindings_preservation_export_and_repeat(self):
        s=self.s;before=copy.deepcopy(s.graph())
        ensure_coingecko_identity_handoff(s)
        g=s.graph();by={n['name']:n for n in g['nodes']}
        gate=by['CoinGecko · 筛选无UUID资产'];writer=by['CoinGecko · 核实并建档']
        signal=by['CoinGecko · 首次收录新资产'];channel=by['Few Understand · indicator.data']
        names={n['id']:n['name'] for n in g['nodes']}
        paths={(names[e['upstream_id']],names[e['downstream_id']]) for e in g['edges']}
        for a,b in [('Few Understand · indicator.data',gate['name']), (gate['name'],writer['name']),
                    (writer['name'],signal['name']), (writer['name'],'确定资产起始评分'),
                    (writer['name'],'assets'),(writer['name'],'asset_identifiers')]:
            self.assertIn((a,b),paths)
        self.assertNotIn(('Few Understand · market.snapshot',signal['name']),paths)
        self.assertEqual([e['upstream_id'] for e in g['edges'] if e['downstream_id']==signal['id']],[writer['id']])
        for name in ('Polars · 计算 CoinGecko 量价指标','Polars · 汇总指标并发布',channel['name']):
            fields={f['name']:f for f in s.get_fields(by[name]['id'])}
            self.assertIn('null',fields['asset_id']['data_type'])
            self.assertIn('lookup_error',fields['identity_status']['data_type'])
            self.assertIn('source_name',fields)
        for old in before['nodes']:
            new=s.get_node(old['id'])
            for key in ('id','reference_number','position_x','position_y'):
                self.assertEqual(old[key],new[key])
        ports={p['id']:p for p in g['ports']};edges={e['id']:e for e in g['edges']}
        for binding in g['bindings']:
            e=edges[binding['edge_id']]
            self.assertEqual(ports[binding['source_port_id']]['node_id'],e['upstream_id'])
            self.assertEqual(ports[binding['target_port_id']]['node_id'],e['downstream_id'])
        fields={f['id']:f for f in g['fields']}
        for u in g['field_usages']:
            self.assertEqual(fields[u['source_field_id']]['node_id'],edges[u['edge_id']]['upstream_id'])
            if u['target_field_id']:
                self.assertEqual(fields[u['target_field_id']]['node_id'],edges[u['edge_id']]['downstream_id'])
        self.assertFalse(CardModel(s).cycles());self.assertFalse(s.db.execute('pragma foreign_key_check').fetchall())
        package=CardModel(s).package()
        self.assertIn('catalog/coingecko-identity-handoff.v1.json',package['definitions'])
        self.assertEqual(len(g['nodes']),len(before['nodes'])+2)
        ensure_coingecko_identity_handoff(s)
        self.assertEqual(package,CardModel(s).package())

    def test_rollback_and_edited_card_protection(self):
        s=self.s;before=CardModel(s).package()
        with patch.object(s,'create_field_usage',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):
                ensure_coingecko_identity_handoff(s)
        self.assertEqual(before,CardModel(s).package())
        self.assertFalse(s.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())
        s.update_node(s.find_name('CoinGecko · 首次收录新资产')['id'],{'formula':'user edit'})
        before=CardModel(s).package()
        with self.assertRaisesRegex(ValueError,'edited card'):
            ensure_coingecko_identity_handoff(s)
        self.assertEqual(before,CardModel(s).package())
