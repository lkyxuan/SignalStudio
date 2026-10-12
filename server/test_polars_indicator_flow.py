import copy
import unittest
from unittest.mock import patch

from card_model import CardModel
from polars_indicator_module import ensure_polars_indicator_module
from polars_indicator_flow import ensure_polars_indicator_flow, MARKER
import test_polars_indicator_module


class PolarsFlowTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_polars_indicator_module.PolarsIndicatorModuleTest()
        self.fixture.setUp()
        self.s = self.fixture.service
        ensure_polars_indicator_module(self.s)

    def tearDown(self):
        self.fixture.tearDown()

    def test_entry_fanout_convergence_publication_and_matching_ports(self):
        s = self.s
        before = copy.deepcopy(s.graph())
        ensure_polars_indicator_flow(s)
        graph = s.graph()
        model = CardModel(s)
        parent = s.find_name('Polars · 计算 CoinGecko 量价指标')
        assembly = s.find_name('Polars · 汇总指标并发布')
        channel = s.find_name('Few Understand · indicator.data')
        children = model.contract(parent['id'])['config']['resource']['module_children']
        links = {(e['upstream_id'],e['downstream_id']) for e in graph['edges']}
        for c in children:
            self.assertIn((parent['id'],c['node_id']),links)
            self.assertIn((c['node_id'],assembly['id']),links)
            self.assertNotIn((c['node_id'],parent['id']),links)
            self.assertGreater(s.get_node(c['node_id'])['position_y'],parent['position_y'])
            self.assertLess(s.get_node(c['node_id'])['position_y'],s.get_node(assembly['id'])['position_y'])
        self.assertIn((parent['id'],assembly['id']),links)
        self.assertEqual([e['upstream_id'] for e in graph['edges'] if e['downstream_id']==channel['id']],[assembly['id']])
        self.assertEqual({f['name'] for f in s.get_fields(assembly['id'])}, {f['name'] for f in before['fields'] if f['node_id']==parent['id']})
        self.assertNotIn('volume_ratio',{f['name'] for f in s.get_fields(parent['id'])})
        ports = {p['id']:p for p in graph['ports']}
        edges = {e['id']:e for e in graph['edges']}
        for b in graph['bindings']:
            self.assertEqual(ports[b['source_port_id']]['node_id'],edges[b['edge_id']]['upstream_id'])
            self.assertEqual(ports[b['target_port_id']]['node_id'],edges[b['edge_id']]['downstream_id'])
        for old in before['nodes']:
            if old['id'] not in {parent['id'],channel['id']} | {c['node_id'] for c in children}:
                self.assertEqual(old['formula'],s.get_node(old['id'])['formula'])
        self.assertFalse(model.cycles())
        self.assertFalse(s.db.execute('pragma foreign_key_check').fetchall())
        self.assertIn('catalog/polars-indicator-flow.v1.json',model.package()['definitions'])
        package = model.package()
        ensure_polars_indicator_flow(s)
        self.assertEqual(package,model.package())

    def test_rollback_and_preserve_edited_card(self):
        s=self.s
        package=CardModel(s).package()
        with patch.object(s,'create_field_usage',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):
                ensure_polars_indicator_flow(s)
        self.assertEqual(package,CardModel(s).package())
        self.assertFalse(s.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())
        parent=s.find_name('Polars · 计算 CoinGecko 量价指标')
        s.update_node(parent['id'],{'formula':'user edit'})
        package=CardModel(s).package()
        with self.assertRaisesRegex(ValueError,'parent edited'):
            ensure_polars_indicator_flow(s)
        self.assertEqual(package,CardModel(s).package())


if __name__ == '__main__':
    unittest.main()
