import copy
import json
import unittest
from unittest.mock import patch

from card_model import CardModel
from market_channel import ensure_market_channel
from market_polars import CATALOG, MARKER, ensure_market_polars
import test_market_channel


class MarketPolarsTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_market_channel.MarketChannelTest()
        self.fixture.setUp()
        self.service = self.fixture.service
        ensure_market_channel(self.service)
        self.service.create_node({'name':'维护近期评分窗口', 'kind':'process'})

    def tearDown(self):
        self.fixture.tearDown()

    def test_indicator_first_topology_deletes_old_cards_preserves_other_work(self):
        s = self.service
        before = s.graph()
        spec = json.loads(CATALOG.read_text())
        ensure_market_polars(s)
        after = s.graph()
        for item in spec['retired']:
            self.assertIsNone(s.find_name(item['name']))
        pairs = {(s.get_node(e['upstream_id'])['name'], s.get_node(e['downstream_id'])['name']) for e in after['edges']}
        self.assertIn(('Polars · 计算 CoinGecko 量价指标', 'Few Understand · indicator.data'), pairs)
        self.assertIn(('Few Understand · indicator.data', '量价评分 · 生成贡献'), pairs)
        self.assertIn(('维护近期评分窗口','量价评分 · 汇总Redis记分'), pairs)
        self.assertIn(('量价评分 · 汇总Redis记分','生成基础升温榜'), pairs)
        self.assertNotIn(('coingecko_market_history', '量价评分 · 生成贡献'), pairs)
        self.assertNotIn(('Few Understand · market.snapshot', '量价评分 · 生成贡献'), pairs)
        for name in ('生成基础升温榜', '生成基础最热榜', '生成新发现榜'):
            self.assertIn(('market_scores_current', name), pairs)
        managed = {n['old_name'] for n in spec['nodes']} | {n['name'] for n in spec['retired']} | {'Few Understand · market.snapshot', '市场交易活跃候选'}
        for node in before['nodes']:
            if node['name'] not in managed:
                updated = s.get_node(node['id'])
                self.assertEqual(node, next(n for n in after['nodes'] if n['id']==updated['id']))
        old = next(n for n in before['nodes'] if n['name']=='leaderboard_observations')
        new = s.find_name('coingecko_market_history')
        self.assertEqual([old[k] for k in ('id','reference_number','position_x','position_y')], [new[k] for k in ('id','reference_number','position_x','position_y')])
        self.assertFalse(s.db.execute('PRAGMA foreign_key_check').fetchall())
        package = CardModel(s).package()
        self.assertIn('catalog/market-polars.v1.json', package['definitions'])
        self.assertNotIn('catalog/leaderboard-foundation.v1.json', package['definitions'])
        self.assertNotIn('catalog/market-channel.v1.json', package['definitions'])
        saved = copy.deepcopy(package)
        ensure_market_polars(s)
        self.assertEqual(saved, CardModel(s).package())

    def test_conflict_and_failure_are_atomic(self):
        s = self.service
        node = s.find_name('归一结构化榜单观测')
        s.update_node(node['id'], {'formula':'someone else changed this'})
        before = CardModel(s).package()
        with self.assertRaisesRegex(ValueError, 'definition changed'):
            ensure_market_polars(s)
        self.assertEqual(before, CardModel(s).package())

    def test_unknown_downstream_is_not_deleted(self):
        s = self.service
        node = s.create_node({'name':'unrelated future work', 'kind':'process'})
        s.create_edge({'upstream_id':s.find_name('归一结构化榜单观测')['id'], 'downstream_id':node['id']})
        before = CardModel(s).package()
        with self.assertRaisesRegex(ValueError, 'unrelated downstream'):
            ensure_market_polars(s)
        self.assertEqual(before, CardModel(s).package())

    def test_interruption_rolls_back_card_deletion_and_number_allocation(self):
        s = self.service
        before = CardModel(s).package()
        with patch.object(s, 'create_field', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_market_polars(s)
        self.assertEqual(before, CardModel(s).package())
        self.assertFalse(s.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone())


if __name__ == '__main__':
    unittest.main()
