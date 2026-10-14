import json
import unittest
from unittest.mock import patch
from card_model import CardModel, encoded
from coingecko_hottest import ROOT, PATH, ensure_coingecko_hottest
from hottest_warmup import ensure_hottest_warmup
from hottest_round_trigger import ensure_hottest_round_trigger
from test_coingecko_hottest import HottestMigrationTest


class RoundTriggerMigrationTest(unittest.TestCase):
    def setUp(self):
        self.fixture = HottestMigrationTest()
        self.fixture.setUp()
        self.s = self.fixture.s
        ensure_coingecko_hottest(self.s)
        ensure_hottest_warmup(self.s)
        previous = json.loads((ROOT / 'server/migration_snapshots/hottest-before-ss105.json').read_text())
        spec = json.loads((ROOT / PATH).read_text())
        for entry in spec['cards']:
            if entry['key'] in previous['triggers']:
                self.s.db.execute('UPDATE nodes SET trigger_rule=? WHERE name=?', (previous['triggers'][entry['key']], entry['name']))
        for row in self.s.db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            cfg = json.loads(row['config'])
            def reset(obj):
                if isinstance(obj, dict):
                    if obj.get('path') == PATH and 'revision' in obj:
                        obj['revision'] = previous['digest']
                    for value in obj.values(): reset(value)
                elif isinstance(obj, list):
                    for value in obj: reset(value)
            reset(cfg)
            if cfg['resource'].get('hottest_key') == 'rank':
                cfg['trigger'] = {'kind': 'schedule', 'interval_seconds': 300}
            self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(cfg), row['node_id']))
        self.s.db.commit()

    def tearDown(self):
        self.fixture.tearDown()

    def snapshot(self):
        return list(self.s.db.iterdump())

    def test_upgrade_preserves_graph_and_reentry_preserves_edits(self):
        before = {n['id']: n for n in self.s.graph()['nodes']}
        ensure_hottest_round_trigger(self.s)
        for node in self.s.graph()['nodes']:
            for field in ('id', 'reference_number', 'position_x', 'position_y', 'formula', 'definition'):
                self.assertEqual(node[field], before[node['id']][field])
        rank = self.s.find_name('生成基础最热榜')
        trigger = CardModel(self.s).contract(rank['id'])['config']['trigger']
        self.assertEqual(trigger['event'], 'crawler_round_complete')
        self.assertNotIn('interval_seconds', trigger)
        self.assertIn('每收齐一轮爬虫算一次', rank['trigger_rule'])
        self.s.update_node(rank['id'], {'trigger_rule': 'later user edit'})
        saved = self.snapshot()
        ensure_hottest_round_trigger(self.s)
        self.assertEqual(saved, self.snapshot())

    def test_conflicting_trigger_rolls_back(self):
        self.s.update_node(self.s.find_name('CoinGecko · 最热榜候选快照')['id'], {'trigger_rule': 'user edit'})
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'edited trigger'):
            ensure_hottest_round_trigger(self.s)
        self.assertEqual(before, self.snapshot())

    def test_unknown_pin_rolls_back(self):
        rank = self.s.find_name('生成基础最热榜')
        cfg = CardModel(self.s).contract(rank['id'])['config']
        cfg['definition_refs'][0]['revision'] = 'unknown'
        self.s.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(cfg), rank['id']))
        self.s.db.commit()
        before = self.snapshot()
        with self.assertRaisesRegex(ValueError, 'unknown definition revision'):
            ensure_hottest_round_trigger(self.s)
        self.assertEqual(before, self.snapshot())

    def test_interruption_rolls_back(self):
        before = self.snapshot()
        with patch.object(self.s, '_event', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'interrupted'):
                ensure_hottest_round_trigger(self.s)
        self.assertEqual(before, self.snapshot())
        ensure_hottest_round_trigger(self.s)
