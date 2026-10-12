import copy
import unittest
from unittest.mock import patch
import test_application_interfaces
from application_interfaces import ensure_application_interfaces
from homepage_interface import ensure_homepage_interface, MARKER, PATH
from card_model import CardModel, stable

class HomepageTest(unittest.TestCase):
    def setUp(self):
        self.fixture = test_application_interfaces.ApplicationInterfacesTest()
        self.fixture.setUp()
        self.s = self.fixture.service
        for name,kind in [('leaderboard_warming','table'),('leaderboard_hottest','table'),('Few Understand · signal.data','channel')]:
            if not self.s.find_name(name): self.s.create_node({'name':name,'kind':kind})
        ensure_application_interfaces(self.s)
        self.model = CardModel(self.s)
    def tearDown(self): self.fixture.tearDown()
    def test_additive_reference_only_idempotent_and_exportable(self):
        before = copy.deepcopy(self.s.graph())
        ensure_homepage_interface(self.s)
        graph = self.s.graph()
        for old in before['nodes']:
            self.assertEqual(old, next(n for n in graph['nodes'] if n['id']==old['id']))
        ui = self.s.find_name('榜单与信号首页')
        self.assertEqual(ui['reference_number'],7003)
        edges = [e for e in graph['edges'] if e['downstream_id']==ui['id']]
        self.assertEqual(len(edges),3)
        bindings = [b for b in graph['bindings'] if b['edge_id'] in {e['id'] for e in edges}]
        self.assertEqual(len(bindings),3)
        self.assertTrue(all(b['kind']=='reference' and b['config']['trigger']=='none' for b in bindings))
        self.assertEqual({i['code'] for i in self.model.readiness([ui['id']])['issues']},{'interface_binding_unverified'})
        edge=edges[0]
        with self.assertRaises(ValueError):
            self.model.add_binding(edge,{'kind':'reference','source_port_id':stable(edge['upstream_id'],'output','out'),
                'target_port_id':stable(ui['id'],'input','in'),'config':{'role':'homepage_source_definition','trigger':'event'}})
        package = self.model.package()
        slots = package['definitions'][PATH]['body']['slots']
        self.assertEqual([s['position'] for s in slots],list(range(1,7)))
        self.assertEqual([s['kind'] for s in slots],['board']*3+['signal']*3)
        self.assertIsNone(slots[2]['source_name'])
        self.assertEqual({s['source_name'] for s in slots[3:]},{'Few Understand · signal.data'})
        self.assertTrue(all(s['api_endpoint'] is None for s in slots))
        other=self.model.contract(ui['id'])
        self.assertFalse(other['config']['action']['id'])
        ensure_homepage_interface(self.s)
        self.assertEqual(package,self.model.package())
        self.model.update_contract(ui['id'],{'revision':1,'config':{'environment':'user-edited'}})
        self.s.db.commit()
        ensure_homepage_interface(self.s)
        self.assertEqual(self.model.contract(ui['id'])['config']['environment'],'user-edited')
        imported=type(self.s)(self.fixture.path.parent/'import-home.db'); im=CardModel(imported); im.migrate()
        try:
            im.import_package(package)
            self.assertIsNotNone(imported.find_name(ui['name']))
        finally: imported.db.close()
    def test_missing_source_leaves_no_marker(self):
        n=self.s.find_name('Few Understand · signal.data')
        self.s.db.execute('DELETE FROM nodes WHERE id=?',(n['id'],));self.s.db.commit()
        ensure_homepage_interface(self.s)
        self.assertIsNone(self.s.find_name('榜单与信号首页'))
        self.assertFalse(self.s.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())
    def test_collision_and_failure_leave_no_partial_install(self):
        before=self.model.package()
        with patch.object(CardModel,'add_binding',side_effect=RuntimeError('interrupted')):
            with self.assertRaisesRegex(RuntimeError,'interrupted'): ensure_homepage_interface(self.s)
        self.assertEqual(before,self.model.package())
        self.s.create_node({'name':'榜单与信号首页','kind':'process'})
        before=self.model.package()
        with self.assertRaisesRegex(ValueError,'conflicts'): ensure_homepage_interface(self.s)
        self.assertEqual(before,self.model.package())

if __name__=='__main__': unittest.main()
