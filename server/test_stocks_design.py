# coding: utf-8
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from graph_service import GraphService
from card_model import CardModel
from stocks_design import ensure_stocks_design, MARKER, PATH


class StocksDesignTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name)/'test.db')
        CardModel(self.service).migrate()
        for name in ['assets', 'asset_identifiers']:
            self.service.create_node({'name': name, 'kind': 'table', 'position_x': 35, 'position_y': 75})
        self.spec = json.loads((Path(__file__).resolve().parent.parent/PATH).read_text())

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def test_preserves_existing_graph_and_stays_design_only_on_restart_and_export(self):
        before = copy.deepcopy(self.service.graph())
        ensure_stocks_design(self.service)
        graph = self.service.graph()
        for old in before['nodes']:
            current = next(n for n in graph['nodes'] if n['id']==old['id'])
            self.assertEqual({k:v for k,v in old.items() if k!='display_positions'},
                             {k:v for k,v in current.items() if k!='display_positions'})
            for key,value in old['display_positions'].items():
                self.assertEqual(value,current['display_positions'][key])
            self.assertEqual(len(current['display_positions'])-len(old['display_positions']),1)
        self.assertEqual(len(graph['nodes']),len(before['nodes'])+len(self.spec['cards']))
        self.assertTrue(all(b['kind']=='reference' and b['config']['trigger']=='none' for b in graph['bindings']))
        stock_nodes = [n for n in graph['nodes'] if n['name'].startswith('coingecko.stocks.')]
        for n in stock_nodes:
            config = n['card_contract']['config']
            self.assertFalse(config['action']['id'])
            self.assertFalse(config['resource']['runtime_enabled'])
            self.assertIsNone(config['resource']['physical_binding'])
        package = CardModel(self.service).package()
        self.assertIn(PATH, package['definitions'])
        self.assertIn('catalog/coingecko-stocks-observed.v1.json',package['definitions'])
        first = self.service.graph()
        ensure_stocks_design(self.service)
        self.assertEqual(first,self.service.graph())
        n=stock_nodes[0]
        self.service.update_node(n['id'],{'definition':'User saved definition'})
        ensure_stocks_design(self.service)
        self.assertEqual(self.service.get_node(n['id'])['definition'],'User saved definition')

    def test_failure_rolls_back_entire_install_and_collision_preserves_user_work(self):
        before=CardModel(self.service).package()
        with patch.object(CardModel,'add_binding',side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError): ensure_stocks_design(self.service)
        self.assertEqual(before,CardModel(self.service).package())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())
        self.service.create_node({'name':self.spec['cards'][0]['name'],'kind':'source'})
        before=CardModel(self.service).package()
        with self.assertRaisesRegex(ValueError,'conflict'):ensure_stocks_design(self.service)
        self.assertEqual(before,CardModel(self.service).package())

if __name__=='__main__':unittest.main()
