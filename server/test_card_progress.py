import tempfile
import unittest
from pathlib import Path
from card_model import CardModel
from graph_service import GraphService
from live_state import snapshot


class CardProgressTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        self.model = CardModel(self.service)
        self.model.migrate()
        self.node = self.service.create_node({'name':'first','kind':'process'})

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def progress(self):
        return snapshot(self.service)['card_progress'][self.node['id']]

    def report(self, status='implemented', **extra):
        return self.model.report({'node_id':self.node['id'],
            'package_revision':self.model.package()['package_revision'],
            'code_revision':'abc123','evidence_ref':'https://example.com/test',
            'reported_by':'few_understand','summary':'Only the mapped rule is covered.',
            'observations':{'implementation':status}, **extra})

    def test_no_report_is_unknown_and_graph_report_is_not_per_card_evidence(self):
        self.assertIsNone(self.progress()['report'])
        self.report(node_id=None)
        self.assertIsNone(self.progress()['report'])

    def test_report_refreshes_ui_without_invalidating_package_or_behavior(self):
        before=snapshot(self.service);package=self.model.package()['package_revision']
        self.report()
        after=snapshot(self.service)
        self.assertNotEqual(before['revision'],after['revision'])
        self.assertEqual(before['semantic_revision'],after['semantic_revision'])
        self.assertEqual(package,self.model.package()['package_revision'])
        self.assertEqual(self.progress()['report']['claims_are'], 'reported_observation_not_independent_verification')

    def test_title_layout_do_not_invalidate_but_behavior_does(self):
        self.report()
        self.service.update_node(self.node['id'],{'name':'renamed'})
        self.service.update_layout({'positions':[{'id':self.node['id'],'position_x':20,'position_y':30}]})
        self.assertIsNotNone(self.progress()['report'])
        self.service.update_node(self.node['id'],{'formula':'different calculation'})
        self.assertIsNone(self.progress()['report'])
        self.assertTrue(self.progress()['stale'])
        self.report('mismatch')
        self.assertEqual(self.progress()['report']['observations']['implementation'],'mismatch')
        self.assertFalse(self.progress()['stale'])

    def test_statuses_and_legacy_reports_keep_attribution(self):
        for status in ('implemented','not_implemented','disputed','mismatch','verified','in_progress'):
            self.report(status)
            self.assertEqual(self.progress()['report']['observations']['implementation'],status)
        for extra in ({'observations':{'implementation':[]}}, {'code_revision':42},
                      {'reported_by':''},{'summary':''}, {'definition_revision':'wrong'}):
            with self.assertRaises(ValueError):
                self.report('disputed',**extra)

    def test_unrelated_cards_do_not_lose_report_but_changed_input_schema_does(self):
        upstream=self.service.create_node({'name':'input','kind':'table'})
        self.service.create_edge({'upstream_id':upstream['id'],'downstream_id':self.node['id']})
        self.report()
        self.service.create_node({'name':'unrelated','kind':'source'})
        self.assertIsNotNone(self.progress()['report'])
        self.service.create_field(upstream['id'],{'name':'new_required_input'})
        self.assertIsNone(self.progress()['report'])

    def test_new_report_does_not_inherit_old_runtime_claims(self):
        self.report(observations={'implementation':'implemented','health':'healthy','deployment':'deployed'})
        self.report('disputed')
        latest=self.progress()['report']['observations']
        self.assertNotIn('health',latest)
        self.assertNotIn('deployment',latest)


if __name__=='__main__':
    unittest.main()
