import unittest
from copy import deepcopy
from graph_transport import GraphTransport, canvas, details, encoded


class GraphTransportTest(unittest.TestCase):
    def graph(self, revision='a'):
        return dict(revision=revision,workspace={'project_root':'/test','database_path':'/test/db'},
            nodes=[dict(id=str(i),notes='long note ' * 100,rationale='',caveats='',validation_plan='',validation_evidence='') for i in range(20)],
            edges=[],fields=[],field_usages=[],requirements=[],ports=[],bindings=[],data_schemas=[])

    def test_changes_deletions_and_expired_baseline(self):
        transport = GraphTransport(limit=2)
        first = self.graph(); transport.response(first)
        second = deepcopy(first); second['revision']='b'; second['nodes'][0]['notes']='new'; second['nodes'].pop(); second['nodes'].append(dict(first['nodes'][0],id='new'))
        delta = transport.response(second,'a')
        self.assertEqual(delta['transport'],'delta.v1')
        self.assertEqual(delta['changes']['nodes']['delete'],['19'])
        self.assertEqual([n['id'] for n in delta['changes']['nodes']['upsert']],['0','new'])
        self.assertNotEqual(delta['changes']['nodes']['upsert'][0]['detail_revision'],canvas(first)['nodes'][0]['detail_revision'])
        third = deepcopy(second); third['revision']='c'; transport.response(third)
        self.assertEqual(transport.response(third,'a')['transport'],'canvas.v1')
        self.assertEqual(GraphTransport().response(third,'b')['transport'],'canvas.v1')
        self.assertEqual(first['nodes'][0]['notes'],'long note ' * 100)

    def test_details_have_matching_hash_without_changing_canvas(self):
        graph=self.graph(); summary=canvas(graph); detail=details(graph,{'0'})
        self.assertLess(len(encoded(summary)),len(encoded(graph)))
        self.assertFalse(summary['nodes'][0]['detail_loaded'])
        self.assertEqual(summary['nodes'][0]['notes'],'')
        self.assertEqual(detail['nodes'][0]['notes'],graph['nodes'][0]['notes'])
        self.assertEqual(detail['nodes'][0]['detail_revision'],summary['nodes'][0]['detail_revision'])
        self.assertTrue(detail['nodes'][0]['detail_loaded'])

    def test_unchanged_delta_retains_revision_for_conditional_reads(self):
        transport = GraphTransport()
        graph = self.graph()
        transport.response(graph)
        delta = transport.response(graph, 'a')
        self.assertEqual(delta['transport'], 'delta.v1')
        self.assertEqual(delta['revision'], 'a')
        self.assertEqual(delta['base_revision'], 'a')
        self.assertTrue(all(not change['upsert'] and not change['delete']
                            for change in delta['changes'].values()))

    def test_memory_budget_evicts_old_snapshots(self):
        transport=GraphTransport(byte_limit=1)
        transport.response(self.graph()); transport.response(self.graph('b'))
        self.assertEqual(list(transport.history),['b'])
