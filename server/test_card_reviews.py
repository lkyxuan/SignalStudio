import tempfile
import unittest
from pathlib import Path
from card_model import CardModel
from card_reviews import STANDARD, material, history
from graph_service import GraphService
from live_state import snapshot


class CardReviewsTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name) / 'test.db')
        self.model = CardModel(self.service)
        self.model.migrate()
        self.node = self.service.create_node({'name':'reviewed card','kind':'process'})

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def progress(self):
        return snapshot(self.service)['card_progress'][self.node['id']]

    def submit(self, **changes):
        p = material(self.model, self.node['id'])
        data = {'schema_version':'card-review.v1','node_id':self.node['id'],
            'definition_revision':p['definition_revision'],'package_revision':p['package_revision'],
            'code_repository':'example/implementation','code_revision':'a'*40,
            'reporter_role':'implementer','reported_by':'builder','status':'pending_review',
            'summary':'Fixed-version test, not production evidence','evidence_ref':'fixture://suite',
            'checks':[{'requirement':'example requirement','result':'pass','evidence_ref':'fixture://case'}],
            'differences':[],'unverified_items':[],
            'base_implementation_report_id':self.progress().get('active_implementation_report_id'),**changes}
        return self.model.report(data)

    def review(self, implementation, **changes):
        return self.submit(**{'reporter_role':'reviewer','reported_by':'auditor','status':'passed',
            'implementation_report_id':implementation['id'],'code_revision':implementation['code_revision'],**changes})

    def test_new_cards_share_standard_and_do_not_invent_reports(self):
        self.assertEqual([len(s['label_zh']) for s in STANDARD['statuses']], [3]*6)
        self.assertEqual(self.progress()['status'], 'unknown')
        self.assertEqual(self.progress()['history'], [])
        self.assertEqual(material(self.model,self.node['id'])['node']['id'],self.node['id'])
        self.assertEqual(history(self.model,self.node['id']), [])

    def test_material_has_explicit_requirements_and_adjacent_schema(self):
        upstream=self.service.create_node({'name':'input','kind':'table'})
        f=self.service.create_field(upstream['id'],{'name':'required_input'})
        edge=self.service.create_edge({'upstream_id':upstream['id'],'downstream_id':self.node['id']})
        p=material(self.model,self.node['id'])
        self.assertIn(f['id'],[x['id'] for x in p['fields']])
        self.assertIn(edge['id'],[x['id'] for x in p['edges']])
        self.assertEqual(p['requirements'],[])

    def test_legacy_verified_does_not_become_passed(self):
        self.model.report({'node_id':self.node['id'],'package_revision':self.model.package()['package_revision'],
            'code_revision':'old','evidence_ref':'fixture://old','observations':{'implementation':'verified'}})
        self.assertEqual(self.progress()['status'],'pending_review')

    def test_implementation_then_independent_declared_reviewer_passes(self):
        implementation=self.submit()
        self.assertEqual(self.progress()['status'],'pending_review')
        self.review(implementation)
        self.assertEqual(self.progress()['status'],'passed')
        self.assertEqual(len(self.progress()['history']),2)
        self.assertFalse(self.progress()['conflict'])

    def test_conflicting_reviews_are_not_last_writer_wins(self):
        implementation=self.submit()
        negative=self.review(implementation,status='mismatch',reported_by='auditor-one',differences=['wrong output'])
        self.review(implementation,reported_by='auditor-two')
        self.assertEqual(self.progress()['status'],'discussion')
        self.assertTrue(self.progress()['conflict'])
        # A reviewer can explicitly correct their own report; history is preserved.
        self.review(implementation,reported_by='auditor-one',supersedes_report_ids=[negative['id']])
        self.assertEqual(self.progress()['status'],'passed')
        self.assertEqual(len(history(self.model,self.node['id'])),4)

    def test_other_agent_cannot_supersede_report(self):
        implementation=self.submit()
        negative=self.review(implementation,status='mismatch',differences=['wrong output'])
        with self.assertRaisesRegex(ValueError,'own report'):
            self.review(implementation,reported_by='other',supersedes_report_ids=[negative['id']])

    def test_new_commit_requires_new_review_and_late_old_review_cannot_restore_pass(self):
        old=self.submit()
        self.review(old)
        self.submit(code_revision='b'*40)
        self.assertEqual(self.progress()['status'],'pending_review')
        self.review(old,reported_by='late-auditor')
        self.assertEqual(self.progress()['status'],'pending_review')
        self.assertEqual(self.progress()['active_code_revision'],'b'*40)

    def test_old_implementation_cannot_silently_change_active_target(self):
        first=self.submit()
        second=self.submit(code_revision='b'*40)
        with self.assertRaisesRegex(ValueError,'base_implementation_report_id'):
            self.submit(base_implementation_report_id=first['id'])
        self.assertEqual(self.progress()['active_implementation_report_id'],second['id'])

    def test_design_changes_exclude_reports_and_preserve_history(self):
        implementation=self.submit()
        self.review(implementation)
        self.service.update_node(self.node['id'],{'formula':'changed behavior'})
        self.assertEqual(self.progress()['status'],'unknown')
        self.assertTrue(self.progress()['stale'])
        self.assertEqual(len(self.progress()['history']),2)
        with self.assertRaisesRegex(ValueError,'same card and versions'):
            self.review(implementation)

    def test_invalid_review_cannot_claim_pass(self):
        implementation=self.submit()
        cases=[{'reported_by':'builder'}, {'unverified_items':['not run']},
            {'differences':['wrong output']}, {'checks':[]},
            {'checks':[{'requirement':'x','result':'unverified','evidence_ref':'fixture'}]},
            {'code_repository':'wrong/repository'}, {'implementation_report_id':'absent'}]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.review(implementation,**changes)
        with self.assertRaises(ValueError):
            self.submit(status='passed')
        with self.assertRaises(ValueError):
            self.submit(code_revision='branch-name')

    def test_new_states_cannot_bypass_review_validation(self):
        for changes in ({'schema_version':'future'}, {'schema_version':None}, {'definition_revision':'old'},
                {'status':'made_up'}, {'status':[]}, {'node_id':[]}, {'reporter_role':'admin'}):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                self.submit(**changes)
        with self.assertRaisesRegex(ValueError,'require schema_version'):
            self.model.report({'node_id':self.node['id'],'package_revision':self.model.package()['package_revision'],
                'code_revision':'old','evidence_ref':'fixture://old','observations':{'implementation':'passed'}})

    def test_later_legacy_report_does_not_override_modern_audit(self):
        implementation=self.submit()
        self.review(implementation)
        self.model.report({'node_id':self.node['id'],'package_revision':self.model.package()['package_revision'],
                'code_revision':'old','evidence_ref':'fixture://old','observations':{'implementation':'implemented'}})
        self.assertEqual(self.progress()['status'],'passed')

    def test_version_and_evidence_reports_do_not_change_execution_package(self):
        package=self.model.package()['package_revision']
        self.submit()
        self.assertEqual(self.model.package()['package_revision'],package)


if __name__=='__main__':
    unittest.main()
