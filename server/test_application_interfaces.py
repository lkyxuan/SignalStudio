"""Interface installation and execution boundaries on isolated databases."""
import tempfile
import unittest
from pathlib import Path
from application_interfaces import ensure_application_interfaces
from card_model import CardModel, stable
from graph_service import GraphService

class ApplicationInterfacesTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / 'graph.db'
        self.service = GraphService(self.path)
        self.service.ensure_system_tables()
        self.review = self.service.create_node({'name':'人工审核资产纠错建议','kind':'decision'})
        self.service.group_node_references_once()
        self.model = CardModel(self.service)
        self.model.migrate()
    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()
    def test_additive_install_preserves_old_rows_and_repeat_restart_and_user_edits(self):
        before = {name: [dict(row) for row in self.service.db.execute('SELECT * FROM '+name)] for name in ('nodes','edges','node_fields','edge_field_usages','node_contracts','node_ports')}
        ensure_application_interfaces(self.service)
        new = [n for n in self.service.graph()['nodes'] if n['kind']=='interface']
        self.assertEqual([n['reference_number'] for n in new], [7001,7002])
        self.assertEqual(len(self.service.graph()['edges']),len(before['edges'])+2)
        for table, rows in before.items():
            for row in rows:
                key = 'node_id' if table=='node_contracts' else 'id'
                self.assertEqual(dict(self.service.db.execute('SELECT * FROM '+table+' WHERE '+key+'=?',(row[key],)).fetchone()),row)
        ids = {n['id'] for n in new}
        target = next(n for n in new if n['name']=='资产得分页面')
        self.model.update_contract(target['id'],{'revision':1,'config':{'environment':'user-edited'}})
        self.service.db.commit()
        self.service.db.close()
        self.service=GraphService(self.path); self.model=CardModel(self.service)
        self.model.migrate(); ensure_application_interfaces(self.service)
        self.assertEqual({n['id'] for n in self.service.graph()['nodes'] if n['kind']=='interface'}, ids)
        self.assertEqual(self.model.contract(target['id'])['config']['environment'],'user-edited')
        self.assertEqual(self.service.create_node({'name':'Another UI','kind':'interface'})['reference_number'],7003)
    def test_read_and_review_reference_do_not_invent_execution(self):
        ensure_application_interfaces(self.service)
        graph=self.service.graph()
        ui=[n for n in graph['nodes'] if n['kind']=='interface']
        edges=[e for e in graph['edges'] if e['upstream_id'] in {n['id'] for n in ui} or e['downstream_id'] in {n['id'] for n in ui}]
        bindings=[b for b in graph['bindings'] if b['edge_id'] in {e['id'] for e in edges}]
        self.assertEqual({b['kind'] for b in bindings},{'read','reference'})
        self.assertTrue(all(b['config']['trigger']=='none' for b in bindings))
        self.assertEqual(next(b for b in bindings if b['kind']=='reference')['config']['role'],'human_review_surface')
        findings=self.model.readiness([n['id'] for n in ui])['issues']
        self.assertEqual({f['code'] for f in findings},{'interface_binding_unverified'})
        self.assertFalse(self.model.cycles())
        for n in ui:
            self.assertEqual(n['card_contract']['config']['action']['id'],'')
            with self.assertRaisesRegex(ValueError,'not a scheduled'):
                self.model.update_contract(n['id'],{'revision':1,'config':{'trigger':{'kind':'schedule','interval_seconds':60}}})
        edge=next(e for e in edges if e['upstream_id'] in {n['id'] for n in ui})
        for relation in ['control','data','error','write','publish','consume']:
            with self.assertRaises(ValueError):
                self.model.add_binding(edge,{'kind':relation,'branch':'','source_port_id':stable(edge['upstream_id'],'output','out'),'target_port_id':stable(edge['downstream_id'],'input','in'),'config':{'trigger':'none'}})
        with self.assertRaisesRegex(ValueError,'without triggering'):
            self.model.add_binding(edge,{'kind':'reference','branch':'','source_port_id':stable(edge['upstream_id'],'output','out'),'target_port_id':stable(edge['downstream_id'],'input','in'),'config':{'role':'human_review_surface','trigger':'event'}})
    def test_module_delivery_round_trip_and_single_read_policy(self):
        ensure_application_interfaces(self.service)
        package=self.model.package()
        self.assertIn('catalog/application-interfaces.v1.json',package['definitions'])
        self.assertIn('catalog/supabase-score-sync.v1.json',package['definitions'])
        page=next(n for n in package['graph']['nodes'] if n['name']=='资产得分页面')
        self.assertEqual(page['card_contract']['config']['interface']['read_contract_ref'],'catalog/supabase-score-sync.v1.json#/frontend_read')
        other=GraphService(Path(self.temp.name)/'import.db'); model=CardModel(other); model.migrate()
        try:
            model.import_package(package); other.db.commit()
            self.assertEqual([n['name'] for n in other.graph()['nodes'] if n['kind']=='interface'],['资产得分页面','资产纠错审核页面'])
        finally: other.db.close()
    def test_missing_targets_no_invented_graph_or_marker(self):
        self.service.db.execute('DELETE FROM nodes WHERE id=?',(self.review['id'],)); self.service.db.commit()
        ensure_application_interfaces(self.service)
        self.assertFalse([n for n in self.service.graph()['nodes'] if n['kind']=='interface'])
        self.assertFalse(self.service.db.execute("SELECT 1 FROM schema_meta WHERE key='application_interface_cards_v1'").fetchone())
    def test_collision_rolls_back_without_adopting_user_card(self):
        user=self.service.create_node({'name':'资产得分页面','kind':'process'})
        before=self.model.legacy_checksum()
        with self.assertRaisesRegex(ValueError,'conflicts'):
            ensure_application_interfaces(self.service)
        self.assertEqual(self.model.legacy_checksum(),before)
        self.assertEqual(self.model.contract(user['id'])['kind'],'process')

    def test_interface_config_rejects_malformed_requirements_and_execution_claims(self):
        ensure_application_interfaces(self.service)
        ui = next(n for n in self.service.graph()['nodes'] if n['kind']=='interface')
        for config in [{'action':None}, {'action':{'id':'run.job','version':1,'implementation':'planned'}},
                       {'interface':{'actions_zh':'not a list'}}, {'interface':{'implementation':'verified'}}]:
            with self.assertRaises(ValueError):
                self.model.update_contract(ui['id'],{'revision':1,'config':config})
        edge=next(e for e in self.service.graph()['edges'] if e['downstream_id']==ui['id'])
        with self.assertRaises(ValueError):
            self.model.add_binding(edge,{'kind':'read','source_port_id':stable(edge['upstream_id'],'output','out'),
                'target_port_id':stable(edge['downstream_id'],'input','in'),'config':{'trigger':'change'}})

if __name__=='__main__': unittest.main()
