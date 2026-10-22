"""SS-139 logical field/mapping contract. Never publishes or runs a consumer."""
import hashlib
import json
from pathlib import Path
from card_model import CardModel, encoded

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/market-collector-routing.v1.json'
MARKER = 'market_collector_routing_ss139_v1'
ACTOR = 'ss139-market-collector-routing'
NAMES = {2010:'coingecko.coins_markets',2051:'coingecko.stocks.token_markets',
         5004:'Few Understand · market.snapshot',3035:'Polars · 计算 CoinGecko 量价指标',
         3041:'Polars · 汇总指标并发布',5007:'Few Understand · indicator.data',1014:'leaderboard_coverage'}


def ensure_market_collector_routing(service):
    db = service.db
    spec = json.loads((ROOT/PATH).read_text())
    revision = hashlib.sha256((ROOT/PATH).read_bytes()).hexdigest()
    installed=db.execute('SELECT value FROM schema_meta WHERE key=?',(MARKER,)).fetchone()
    if installed and installed['value']==revision:
        return
    model = CardModel(service)
    nodes = {ref:service.find_name(name) for ref,name in NAMES.items()}
    if not all(nodes.values()):
        raise ValueError('Collector routing requires existing cards')
    graph = service.graph()
    edges = {(e['upstream_id'],e['downstream_id']):e for e in graph['edges']}
    links = [(2010,5004),(2051,5004),(5004,3035),(3035,3041),(3041,5007)]
    if any((nodes[a]['id'],nodes[b]['id']) not in edges for a,b in links):
        raise ValueError('Collector routing requires existing pipeline links')
    for node in nodes.values():
        config=model.contract(node['id'])['config']
        if config.get('read_only'):
            raise ValueError('Collector routing protects read-only cards')
        if installed:
            refs=[r for r in config['definition_refs'] if r['path']==PATH]
            if len(refs)!=1 or refs[0]['revision']!=installed['value']:
                raise ValueError('Collector routing definition reference edited')
    db.execute('BEGIN IMMEDIATE')
    try:
        fields = {ref:{f['name']:f for f in service.get_fields(n['id'])} for ref,n in nodes.items()}
        def field(ref,path,typ,rule):
            if path in fields[ref]:
                return
            # Follow the existing guarded table-definition migration pattern.
            # This flag protects interactive edits and is restored inside the lock.
            state=nodes[ref]['is_system_state']
            try:
                if state: db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?',(nodes[ref]['id'],))
                fields[ref][path] = service.create_field(nodes[ref]['id'],{'name':path,'data_type':typ,
                    'definition':rule,'notes':'SS-139 logical contract; no physical runtime binding.'},actor=ACTOR,commit=False)
            finally:
                if state: db.execute('UPDATE nodes SET is_system_state=? WHERE id=?',(state,nodes[ref]['id']))
        for item in spec['fields']:
            field(5004,item['path'],item['type']+(' | null' if item['nullable'] else ''),item['rule_zh'])
            for ref in (3035,3041,5007):
                field(ref,item['normalized'],item['type']+(' | null' if item['nullable'] else ''),item['rule_zh'])
        for item in spec['coverage_fields']:
            field(1014,item['path'],item['type'],item['rule_zh'])
        def mapping(a,b,source,target,note):
            edge=edges[(nodes[a]['id'],nodes[b]['id'])]
            if source not in fields[a] or target not in fields[b]:
                raise ValueError('Collector routing field mapping missing: '+source+' -> '+target)
            pair=(fields[a][source]['id'],fields[b][target]['id'])
            if pair not in {(u['source_field_id'],u['target_field_id']) for u in service.get_field_usages(edge['id'])}:
                service.create_field_usage(edge['id'],{'source_field_id':pair[0],'target_field_id':pair[1],
                    'usage_note':note},actor=ACTOR,commit=False)
        for ref in (2010,2051):
            # Native response paths own native fields only. Generated meta belongs
            # to the publisher contract on the binding, never a fabricated API field.
            for name in fields[ref]:
                target=name.removeprefix('[].')
                if target in fields[5004]:
                    mapping(ref,5004,name,target,'SS-139：单coin原始字段；采集器生成meta另见发布合同。')
            edge=edges[(nodes[ref]['id'],nodes[5004]['id'])]
            for binding in db.execute('SELECT id,config FROM edge_bindings WHERE edge_id=?',(edge['id'],)).fetchall():
                config=json.loads(binding['config'])
                config['publisher_contract']={'path':PATH,'revision':revision,'collector_id':NAMES[ref],
                    'generated_fields':[f['path'] for f in spec['fields'] if f['owner']=='collector'],
                    'runtime_status':'required_not_verified'}
                db.execute('UPDATE edge_bindings SET config=? WHERE id=?',(encoded(config),binding['id']))
        for item in spec['fields']:
            mapping(5004,3035,item['path'],item['normalized'],'SS-139：共享接口语义、独立任务/运行与共同轮次，不能按Header猜任务。')
            for a,b in ((3035,3041),(3041,5007)):
                mapping(a,b,item['normalized'],item['normalized'],'SS-139：保留观测、任务、范围、轮次与覆盖追溯；按observation_id组装。')
        for ref,node in nodes.items():
            contract=model.contract(node['id'])
            config=contract['config']
            config['definition_refs']=[r for r in config['definition_refs'] if r['path']!=PATH]
            config['definition_refs'].append({'path':PATH,'revision':revision,'selector':{'reference_number':ref}})
            config['resource']['collector_routing_contract']={'path':PATH,'revision':revision,
                'status':'approved_design_not_runtime_verified'}
            if ref==5004:
                config['resource']['headers']=[{'name':k,'meaning':v,'consumer_reads':True} for k,v in spec['headers'].items()]
            model.validate_config(config,contract['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?',(encoded(config),node['id']))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Invalid collector routing graph')
        service._event(ACTOR,'extend_contract','graph',MARKER,after={'references':list(nodes),'runtime_enabled':False})
        db.execute('INSERT OR REPLACE INTO schema_meta VALUES (?,?)',(MARKER,revision))
        db.commit()
    except Exception:
        db.rollback()
        raise
