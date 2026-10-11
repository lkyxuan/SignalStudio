import copy
import json
import unittest
from unittest.mock import patch

from leaderboard_foundation import ensure_leaderboard_foundation, CATALOG, MARKER
from leaderboard_trends import ensure_leaderboard_trends
import test_leaderboard_trends


class ThreeBoardFoundationTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_leaderboard_trends.ThreeBoardDesignTest()
        self.fixture.setUp()
        self.service, self.model = self.fixture.service, self.fixture.model
        ensure_leaderboard_trends(self.service)
        self.catalog = json.loads(CATALOG.read_text())
        # Existing production scoring endpoints, absent from the historical board fixture.
        for name in ('Redis 近期评分窗口', '提交评分事件'):
            self.service.create_node({'name': name, 'type': 'Score', 'workflow_lane': 'shared'})
        publisher = self.service.find_name('提交评分事件')
        for name in ('asset_id','score_key','score_delta','decision_ref','decay_policy_ref','half_life_minutes'):
            self.service.create_field(publisher['id'], {'name':name,'data_type':'string','definition':name})

    def tearDown(self):
        self.fixture.tearDown()

    def test_disconnect_text_preserve_ids_layout_and_unrelated_rows(self):
        before = self.service.graph()
        managed = {spec['old_name'] for spec in self.catalog['nodes']}
        sources = set(self.catalog['source_field_mappings'])
        ensure_leaderboard_foundation(self.service)
        after = self.service.graph()
        self.assertEqual(len(before['nodes']) + 4, len(after['nodes']))
        for node in before['nodes']:
            updated = self.service.get_node(node['id'])
            self.assertEqual([node[k] for k in ('reference_number','position_x','position_y')],
                             [updated[k] for k in ('reference_number','position_x','position_y')])
            if node['name'] not in managed:
                self.assertEqual({k:node[k] for k in updated}, updated)
                if node['name'] not in sources:
                    self.assertEqual([f for f in before['fields'] if f['node_id']==node['id']],
                                     [f for f in after['fields'] if f['node_id']==node['id']])
        for spec in self.catalog['nodes']:
            node = self.service.find_name(spec['name'])
            incoming = {self.service.get_node(e['upstream_id'])['name'] for e in after['edges'] if e['downstream_id']==node['id']}
            self.assertEqual(incoming, set(spec['sources']))
            self.assertFalse(incoming.intersection(self.catalog['migration']['text_sources_disconnected']))
            self.assertEqual([(f['name'],f['data_type']) for f in self.service.get_fields(node['id'])],
                             [(f['name'],f['data_type']) for f in spec['columns']])
        self.assertIsNone(self.service.find_name('归一榜单证据'))
        self.assertIsNotNone(self.service.find_name('rss.item'))
        self.assertEqual(self.catalog['frontend']['slots'], {'1':'warming','2':'hottest','5':'discoveries'})
        self.assertFalse(self.service.db.execute('PRAGMA foreign_key_check').fetchall())

    def test_missing_shared_chain_does_not_manufacture_runtime_or_upgrade_marker(self):
        publisher = self.service.find_name('提交评分事件')
        self.service.db.execute('DELETE FROM nodes WHERE id=?',(publisher['id'],))
        self.service.db.commit()
        before = self.model.package()
        with self.assertRaisesRegex(ValueError,'publisher missing'):
            ensure_leaderboard_foundation(self.service)
        self.assertEqual(before,self.model.package())
        redis = self.service.find_name('Redis 近期评分窗口')
        self.service.db.execute('DELETE FROM nodes WHERE id=?',(redis['id'],))
        self.service.db.commit()
        before = self.model.package()
        ensure_leaderboard_foundation(self.service)
        self.assertEqual(before,self.model.package())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())

    def test_repeat_does_not_overwrite_new_user_definition(self):
        ensure_leaderboard_foundation(self.service)
        node = self.service.find_name('生成基础升温榜')
        self.service.update_node(node['id'], {'formula':'future approved rule'})
        saved = copy.deepcopy(self.model.package())
        ensure_leaderboard_foundation(self.service)
        self.assertEqual(saved, self.model.package())

    def test_fields_dependencies_and_configuration_conflicts_leave_graph_unchanged(self):
        node = self.service.find_name('计算升温榜得分')
        self.service.update_node(node['id'], {'formula':'concurrent edit'})
        before = self.model.package()
        with self.assertRaisesRegex(ValueError,'definition changed'):
            ensure_leaderboard_foundation(self.service)
        self.assertEqual(before, self.model.package())
        old = next(n for n in self.fixture.catalog['nodes'] if n['key']=='warming_calc')
        self.service.update_node(node['id'], {'formula':old['algorithm']})
        self.service.db.execute("UPDATE node_contracts SET config=json_set(config,'$.action.implementation','verified') WHERE node_id=?",(node['id'],))
        self.service.db.commit()
        before = self.model.package()
        with self.assertRaisesRegex(ValueError,'configuration changed'):
            ensure_leaderboard_foundation(self.service)
        self.assertEqual(before, self.model.package())

    def test_interruption_rolls_back_source_fields_and_whole_transition(self):
        before = self.model.package()
        with patch.object(self.service, 'create_field', side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'):
                ensure_leaderboard_foundation(self.service)
        self.assertEqual(before, self.model.package())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())
        ensure_leaderboard_foundation(self.service)

    def test_package_includes_versioned_rules_and_nullable_unobserved_scores(self):
        ensure_leaderboard_foundation(self.service)
        package = self.model.package()
        self.assertEqual(package['definitions']['catalog/leaderboard-foundation.v1.json']['body'],self.catalog)
        self.assertEqual(self.catalog['execution']['parameters']['top_n'],20)
        self.assertIn('catalog/market-scoring.v1.json',package['definitions'])
        actions = {item['id']:item for item in package['action_registry']}
        for spec in self.catalog['nodes']:
            node = self.service.find_name(spec['name'])
            config = self.model.contract(node['id'])['config']
            self.assertTrue(config['draft'])
            self.assertEqual(config['action']['implementation'],'unknown')
            if spec['role']=='process':
                self.assertIn(config['action']['id'],actions)
            if spec['key'].endswith('_table'):
                fields = {f['name']:f for f in spec['columns']}
                self.assertEqual(fields['score']['data_type'],'number | null')
                self.assertTrue({'score_components_json','score_event_refs_json','snapshot_ref','window_label','object_key','identity_status'}.issubset(fields))
                self.assertNotIn('text',fields)
                self.assertNotIn('importance_reason',fields)
        discovery = next(n for n in self.catalog['nodes'] if n['key']=='discoveries')
        self.assertIn('baseline',next(f for f in discovery['columns'] if f['name']=='discovery_status')['data_type'])


if __name__ == '__main__':
    unittest.main()
