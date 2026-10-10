"""Definition semantics, lossless upgrades, imports and compatibility boundaries."""
import copy
import sqlite3
import tempfile
import unittest
from pathlib import Path

from card_model import CardModel, MODEL, VERSION, package_digest, stable
from graph_service import GraphService
from live_state import snapshot


class CardModelTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.service = GraphService(Path(self.temp.name)/'graph.db')
        self.model = CardModel(self.service)

    def tearDown(self):
        self.service.db.close()
        self.temp.cleanup()

    def node(self,name,kind='process'):
        return self.service.create_node({'name':name,'kind':kind})

    def binding(self,edge,kind='data',branch='',**config):
        return {'kind':kind,'branch':branch,
                'source_port_id':stable(edge['upstream_id'],'branch',branch) if branch else stable(edge['upstream_id'],'output','error' if kind=='error' else 'out'),
                'target_port_id':stable(edge['downstream_id'],'input','in'),
                'config':{'trigger':'event','completion':'error' if kind=='error' else 'success',**config}}

    def test_additive_repeat_safe_migration_and_field_identity(self):
        a=self.node('original'); f=self.service.create_field(a['id'],{'name':'asset_id'})
        before=self.model.legacy_checksum()
        self.model.migrate()
        self.assertEqual(before,self.model.legacy_checksum())
        contract=self.model.contract(a['id'])
        self.model.update_contract(a['id'],{'revision':1,'config':{'environment':'testnet'}})
        self.service.db.commit()
        original=self.model.contract(a['id'])
        self.model.migrate()
        self.assertEqual(original,self.model.contract(a['id']))
        self.assertEqual(self.service.graph()['data_schemas'][0]['field_ids'],[f['id']])
        self.assertEqual(contract['model_version'],VERSION)

    def test_semantic_migration_matches_business_identity_not_number(self):
        # Fresh installers and historical databases need not allocate equal numbers.
        cases=[('新账号建立待识别资产','Asset Resolution','process'),('执行获批资产纠错','Asset Resolution','process'),
               ('市场账号查询内部资产','Asset Resolution','decision'),('定期 AI 检查资产地图','Evidence Check','process'),
               ('刷新判断','Metric','decision')]
        nodes=[self.service.create_node({'name':name,'type':old}) for name,old,kind in cases]
        self.model.migrate()
        for node,(_,_,kind) in zip(nodes,cases):
            self.assertEqual(self.model.contract(node['id'])['kind'],kind)
            self.assertEqual(self.service.get_node(node['id'])['reference_number'],node['reference_number'])

    def test_exclusive_inputs_merge_and_failure_handler(self):
        names=['新账号建立待识别资产','已有 X 账号资产结果','确定资产起始评分','提交评分事件',
               'CoinGecko · 热榜上榜加分','数据采集与内容生成','验证与保存']
        nodes={name:self.node(name) for name in names}
        for a,b in [(names[0],names[2]),(names[1],names[2]),(names[2],names[3]),(names[4],names[3]),(names[5],names[6])]:
            self.service.create_edge({'upstream_id':nodes[a]['id'],'downstream_id':nodes[b]['id']})
        self.model.migrate()
        self.assertEqual(self.model.contract(nodes[names[2]]['id'])['config']['join']['mode'],'one_of')
        self.assertEqual(self.model.contract(nodes[names[3]]['id'])['config']['join']['mode'],'merge')
        self.assertEqual([b['kind'] for b in self.model.bindings()].count('error'),1)
        self.assertFalse(self.model.cycles())

    def test_all_six_kinds_are_creatable_without_new_business_types(self):
        self.service.group_node_references_once()
        self.model.migrate()
        for kind,spec in [(k['id'],k) for k in MODEL['kinds']]:
            node=self.node('new '+kind,kind)
            self.assertEqual(self.model.contract(node['id'])['kind'],kind)
            self.assertEqual(node['reference_number']//1000,spec['number_group'])
        with self.assertRaisesRegex(ValueError,'silently changed'):
            self.service.update_node(node['id'],{'type':'Score'})

    def test_existing_proposal_entry_uses_canonical_kinds(self):
        self.model.migrate()
        proposal=self.service._propose_locally('创建 结果数据表，用来保存结果')
        self.assertEqual(proposal['node']['kind'],'table')
        created=self.service.apply_proposal(proposal)
        self.assertEqual(self.model.contract(created['id'])['kind'],'table')

    def test_resource_access_is_not_an_execution_cycle(self):
        self.model.migrate()
        table,process=self.node('records','table'),self.node('writer')
        read=self.service.create_edge({'upstream_id':table['id'],'downstream_id':process['id']})
        write=self.service.create_edge({'upstream_id':process['id'],'downstream_id':table['id']})
        self.assertEqual({b['kind'] for b in self.model.bindings()},{'read','write'})
        self.assertFalse(self.model.cycles())
        self.service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?',(read['id'],))
        with self.assertRaisesRegex(ValueError,'not an execution event'):
            self.model.add_binding(read,self.binding(read,'read'))
        with self.assertRaisesRegex(ValueError,'invalid for these'):
            self.model.add_binding(write,self.binding(write,'consume'))

    def test_channel_does_not_exempt_immediate_cycles(self):
        self.model.migrate()
        a,channel=self.node('compute'),self.node('events','channel')
        publish=self.service.create_edge({'upstream_id':a['id'],'downstream_id':channel['id']})
        with self.assertRaisesRegex(ValueError,'Immediate execution cycle'):
            self.service.create_edge({'upstream_id':channel['id'],'downstream_id':a['id']})
        boundary={'next_trigger':'next scheduled tick','dedupe_key':'event_key','deadline_seconds':60}
        endpoints={'upstream_id':channel['id'],'downstream_id':a['id']}
        consume=self.service.create_edge({**endpoints,'bindings':[self.binding(endpoints,'consume',temporal_boundary=boundary)]})
        self.service.db.execute('DELETE FROM edge_bindings')
        self.model.add_binding(publish,self.binding(publish,'publish'))
        with self.assertRaisesRegex(ValueError,'Immediate execution cycle'):
            self.model.add_binding(consume,self.binding(consume,'consume'))
        self.model.add_binding(consume,self.binding(consume,'consume',temporal_boundary={'next_trigger':'next scheduled tick','dedupe_key':'event_key','deadline_seconds':60}))
        self.assertFalse(self.model.cycles())

    def test_branch_identity_ports_and_removal_protection(self):
        self.model.migrate()
        a,b=self.node('choose','decision'),self.node('do')
        self.model.update_contract(a['id'],{'revision':1,'config':{'branches':[{'id':'yes','condition':'eligible'}]}})
        edge=self.service.create_edge({'upstream_id':a['id'],'downstream_id':b['id']})
        self.service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?',(edge['id'],))
        with self.assertRaisesRegex(ValueError,'explicit decision branch'):
            self.model.add_binding(edge,self.binding(edge,'control'))
        self.model.add_binding(edge,self.binding(edge,'control','yes'))
        with self.assertRaisesRegex(ValueError,'cannot be removed'):
            self.model.update_contract(a['id'],{'revision':2,'config':{'branches':[]}})
        invalid=self.binding(edge,'data'); invalid['target_port_id']=stable(a['id'],'input','in')
        with self.assertRaisesRegex(ValueError,'endpoint'):
            self.model.add_binding(edge,invalid)

    def test_bounded_loops_correlated_joins_and_runtime_claims(self):
        self.model.migrate(); node=self.node('loop')
        invalid=[{'loop':{'max_iterations':0}}, {'join':{'mode':'all'}},
                 {'trigger':{'kind':'schedule','interval_seconds':0}}, {'action':{'id':'x','version':1,'implementation':'verified'}}]
        for config in invalid:
            with self.assertRaises(ValueError):
                self.model.update_contract(node['id'],{'revision':1,'config':config})
        self.model.update_contract(node['id'],{'revision':1,'config':{'loop':{'max_iterations':10,'exit_condition':'no next page','deadline_seconds':300}}})

    def test_layout_changes_do_not_change_semantic_package(self):
        self.model.migrate(); node=self.node('stable')
        self.service.db.commit()
        before=snapshot(self.service); package=self.model.package()
        self.service.update_layout({'positions':[{'id':node['id'],'position_x':500,'position_y':600}]})
        after=snapshot(self.service)
        self.assertNotEqual(before['revision'],after['revision'])
        self.assertNotEqual(before['presentation_revision'],after['presentation_revision'])
        self.assertEqual(before['semantic_revision'],after['semantic_revision'])
        self.assertEqual(package['package_revision'],self.model.package()['package_revision'])
        self.service.update_node(node['id'],{'definition':'changed behavior'})
        self.assertNotEqual(package['package_revision'],self.model.package()['package_revision'])

    def test_package_roundtrip_and_invalid_lineage_roll_back(self):
        self.model.migrate(); a,b=self.node('a'),self.node('b')
        f=self.service.create_field(a['id'],{'name':'id'});g=self.service.create_field(b['id'],{'name':'id'})
        edge=self.service.create_edge({'upstream_id':a['id'],'downstream_id':b['id']})
        self.service.create_field_usage(edge['id'],{'source_field_id':f['id'],'target_field_id':g['id']})
        package=self.model.package()
        self.assertFalse(self.model.import_package(package)['quarantined'])
        self.service.db.commit()
        other=GraphService(Path(self.temp.name)/'import.db'); model=CardModel(other); model.migrate()
        try:
            model.import_package(package);other.db.commit()
            self.assertEqual(model.legacy_checksum(),self.model.legacy_checksum())
            # A new isolated receiver must roll back the whole invalid import.
            other.db.close();other=GraphService(Path(self.temp.name)/'bad.db');model=CardModel(other);model.migrate()
            invalid=copy.deepcopy(package); invalid['graph']['field_usages'][0]['source_field_id']=g['id'];invalid['package_revision']=package_digest(invalid)
            with self.assertRaisesRegex(ValueError,'lineage'):
                with other.db:
                    model.import_package(invalid)
            self.assertEqual(len(other.graph()['nodes']),0)
        finally:
            other.db.close()

    def test_migrated_resources_do_not_invent_execution_actions(self):
        self.service.ensure_system_tables()
        self.model.migrate()
        package=self.model.package()
        self.assertTrue(all(not node['card_contract']['config']['action']['id'] for node in package['graph']['nodes']))
        self.assertFalse(self.model.import_package(package)['quarantined'])

    def test_unknown_model_preserves_raw_read_only_and_no_runtime_claim(self):
        self.model.migrate()
        raw={'model_version':'future.v99','graph':{'new_semantics':{'x':123}}}
        result=self.model.import_package(raw)
        contract=self.model.contract(result['node_id'])
        self.assertEqual(contract['config']['original_package'],raw)
        self.assertEqual(contract['kind'],'unknown')
        with self.assertRaisesRegex(ValueError,'read-only'):
            self.service.update_node(result['node_id'],{'definition':'guess'})
        self.assertEqual(self.model.readiness()['structure'],'incomplete')

    def test_reports_require_current_package_and_independent_evidence(self):
        self.model.migrate();self.node('reported');self.service.db.commit()
        package=self.model.package()
        report={'package_revision':package['package_revision'],'code_revision':'abcdef','evidence_ref':'run://sample',
                'observations':{'implementation':'implemented','deployment':'not_deployed','health':'unknown'}}
        self.assertEqual(self.model.report(report)['observations']['deployment'],'not_deployed')
        with self.assertRaisesRegex(ValueError,'outdated'):
            self.model.report({**report,'package_revision':'stale'})
        self.assertEqual(self.model.readiness()['deployment'],'unknown')


if __name__ == '__main__':
    unittest.main()
