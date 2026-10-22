import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from card_model import CardModel
from graph_service import GraphService
from market_collector_routing import ensure_market_collector_routing, MARKER, PATH, NAMES
from market_collector_reference import SPEC, validate_market_message, history_key, semantic_event_key, quote_fingerprint, coverage_ready


class CollectorMessageTest(unittest.TestCase):
    def test_healthy_rows_do_not_prove_complete_coverage_or_allow_wrong_rounds(self):
        message=copy.deepcopy(SPEC['examples'][1]['message']);meta=message['meta']
        report=dict(source_id=meta['operation_id'],collector_id=meta['collector_id'],run_id=meta['source_run_id'],
                    round_id=meta['round_id'],coverage_key=meta['coverage_key'],status='healthy',round_status='complete',
                    requested_at=meta['requested_at'],completed_at='2026-10-22T00:00:25Z',page_count=1,record_count=1,snapshot_ref='fixture://manifest')
        manifest=dict(reference='fixture://manifest',conflict_count=0,page_size=250,terminal='short_page',
                      pages=[dict(page=1,http_status=200,ids=[message['id']])])
        self.assertTrue(coverage_ready(message,report,manifest))
        for values in [{'round_status':'pending'},{'round_status':'partial'},{'round_status':'failed'},
                       {'status':'unknown'},{'round_id':'previous-round'},{'page_count':2},{'record_count':0},
                       {'completed_at':'2026-10-22T00:00:16Z'}]:
            with self.subTest(values=values):self.assertFalse(coverage_ready(message,{**report,**values},manifest))
        self.assertFalse(coverage_ready(message,report,{**manifest,'conflict_count':1}))
        self.assertFalse(coverage_ready(message,report,{**manifest,'pages':[dict(page=1,http_status=429,ids=[])]}))
        self.assertFalse(coverage_ready(message,report,{**manifest,'terminal':'unknown'}))

    def test_tasks_share_route_and_identity_but_not_history_or_transport_id(self):
        a,b=[copy.deepcopy(e['message']) for e in SPEC['examples']]
        ca,cb=validate_market_message(a),validate_market_message(b)
        self.assertEqual(ca['source_id'],cb['source_id'])
        self.assertEqual(ca['round_id'],cb['round_id'])
        self.assertNotEqual(ca['collector_id'],cb['collector_id'])
        self.assertNotEqual(ca['observation_id'],cb['observation_id'])
        self.assertNotEqual(history_key(a),history_key(b))
        self.assertEqual(semantic_event_key(a,'price_up','v1'),semantic_event_key(b,'price_up','v1'))
        self.assertEqual(quote_fingerprint(a),quote_fingerprint(b))
        b['total_volume']+=1
        self.assertEqual(semantic_event_key(a,'price_up','v1'),semantic_event_key(b,'price_up','v1'))
        self.assertNotEqual(quote_fingerprint(a),quote_fingerprint(b))

    def test_missing_unknown_conflicting_or_invalid_provenance_cannot_default_to_healthy(self):
        base=SPEC['examples'][1]['message']
        changes=[lambda m:m['meta'].pop('collector_id'),
                 lambda m:m['meta'].update(collector_id='unknown'),
                 lambda m:m['meta'].update(collection_scope='default_market'),
                 lambda m:m['meta'].update(coverage_key='coingecko.default_market.v1'),
                 lambda m:m['meta'].update(quote_currency='eur'),
                 lambda m:m['meta'].update(source_observation_id='00000000-0000-0000-0000-000000000000'),
                 lambda m:m.update(collected_at='2026-10-22T00:00:21Z'),
                 lambda m:m.update(last_updated='2026-10-22T00:01:00Z'),
                 lambda m:m.update(last_updated=None),
                 lambda m:m.update(current_price=float('nan')),
                 lambda m:m['meta'].update(requested_at='2026-10-21T23:59:00Z')]
        for change in changes:
            message=copy.deepcopy(base);change(message)
            with self.subTest(message=message),self.assertRaises(ValueError):validate_market_message(message)
        missing=copy.deepcopy(base);missing.update(last_updated=None);missing['meta']['quality_status']='missing'
        validate_market_message(missing)
        with self.assertRaises(ValueError):semantic_event_key(missing,'price_up','v1')


class RoutingMigrationTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.service=GraphService(Path(self.temp.name)/'graph.db')
        CardModel(self.service).migrate()
        self.nodes={ref:self.service.create_node({'name':name,'kind':'source' if ref in (2010,2051) else 'channel' if ref in (5004,5007) else 'table' if ref==1014 else 'process','position_x':ref,'position_y':77}) for ref,name in NAMES.items()}
        for ref in (2010,2051):
            for item in SPEC['fields']:
                if item['owner']=='upstream':self.service.create_field(self.nodes[ref]['id'],{'name':('[].' if ref==2051 else '')+item['path'],'data_type':item['type']})
        for a,b in [(2010,5004),(2051,5004),(5004,3035),(3035,3041),(3041,5007)]:
            self.service.create_edge({'upstream_id':self.nodes[a]['id'],'downstream_id':self.nodes[b]['id']})
        self.service.db.execute('UPDATE nodes SET is_system_state=1 WHERE id=?',(self.nodes[1014]['id'],));self.service.db.commit()

    def tearDown(self):
        self.service.db.close();self.temp.cleanup()

    def test_adds_complete_mapping_preserves_nodes_bindings_and_is_restart_safe(self):
        before=copy.deepcopy(self.service.graph());ensure_market_collector_routing(self.service);after=self.service.graph()
        self.assertEqual(len(before['nodes']),len(after['nodes']))
        self.assertEqual(before['edges'],after['edges'])
        for old in before['nodes']:
            new=next(n for n in after['nodes'] if n['id']==old['id'])
            for key,value in old.items():
                if key!='card_contract':self.assertEqual(value,new[key],key)
        for old in before['bindings']:
            new=next(b for b in after['bindings'] if b['id']==old['id'])
            self.assertEqual(old['kind'],new['kind']);self.assertEqual(old['config']['trigger'],new['config']['trigger'])
        fields={f['name'] for f in after['fields'] if f['node_id']==self.nodes[5004]['id']}
        self.assertTrue({f['path'] for f in SPEC['fields']}<=fields)
        stock_fields={f['name'] for f in after['fields'] if f['node_id']==self.nodes[2051]['id']}
        self.assertFalse(any(name.startswith('meta.') for name in stock_fields))
        self.assertIn(PATH,CardModel(self.service).package()['definitions'])
        self.assertEqual(self.service.get_node(self.nodes[1014]['id'])['is_system_state'],1)
        ensure_market_collector_routing(self.service);self.assertEqual(after,self.service.graph())

    def test_failure_rolls_back_all_fields_contracts_and_protected_flag(self):
        before=CardModel(self.service).package()
        with patch.object(self.service,'create_field_usage',side_effect=RuntimeError('interrupted')):
            with self.assertRaises(RuntimeError):ensure_market_collector_routing(self.service)
        self.assertEqual(before,CardModel(self.service).package())
        self.assertIsNone(self.service.db.execute('SELECT 1 FROM schema_meta WHERE key=?',(MARKER,)).fetchone())
