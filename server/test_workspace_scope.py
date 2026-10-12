import copy
import unittest
from unittest.mock import patch

from card_model import CardModel
from polars_indicator_flow import ensure_polars_indicator_flow
from polars_indicator_module import ensure_polars_indicator_module
import test_polars_indicator_module


class WorkspaceScopeTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_polars_indicator_module.PolarsIndicatorModuleTest()
        self.fixture.setUp()
        self.s = self.fixture.service
        ensure_polars_indicator_module(self.s)
        ensure_polars_indicator_flow(self.s)

    def tearDown(self):
        self.fixture.tearDown()

    def test_only_three_cards_are_shelved_and_restore_without_database_write(self):
        s=self.s
        before=copy.deepcopy(s.graph())
        targets={n['id'] for n in before['nodes'] if n['name'] in ('生成基础升温榜','生成基础最热榜','生成新发现榜')}
        scope={'version':'test','shelved_cards':[{'node_id':id} for id in targets]}
        saved=list(s.db.iterdump())
        with patch('workspace_scope.SCOPE',scope):
            g=s.graph()
            self.assertEqual({n['id'] for n in g['nodes']},{n['id'] for n in before['nodes']}-targets)
            self.assertEqual(g['nodes'],[n for n in before['nodes'] if n['id'] not in targets])
            self.assertEqual(g['edges'],[e for e in before['edges'] if e['upstream_id'] not in targets and e['downstream_id'] not in targets])
            node_ids={n['id'] for n in g['nodes']};edge_ids={e['id'] for e in g['edges']}
            self.assertTrue(all(p['node_id'] in node_ids for p in g['ports']))
            self.assertTrue(all(b['edge_id'] in edge_ids for b in g['bindings']))
            self.assertTrue(all(f['node_id'] in node_ids for f in g['fields']))
            self.assertTrue(all(u['edge_id'] in edge_ids for u in g['field_usages']))
            self.assertEqual(len(g['nodes']),len(before['nodes'])-3)
            package=CardModel(s).package()
            self.assertFalse(targets & {n['id'] for n in package['graph']['nodes']})
            self.assertFalse(targets & {p['node_id'] for p in package['graph']['ports']})
            self.assertEqual(package['graph']['workspace_scope'],scope)
            self.assertEqual(list(s.db.iterdump()),saved)
        self.assertEqual(s.graph(),before)


if __name__=='__main__':
    unittest.main()
