"""SS-79 workspace definitions only. No identity DB writer or Few consumer runs here."""
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'catalog/coingecko-identity-handoff.v1.json'
MARKER = 'coingecko_identity_handoff_v1'
ACTOR = 'ss79-identity-handoff'


def ensure_coingecko_identity_handoff(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='polars_indicator_flow_v1'").fetchone():
        return
    spec = json.loads(CATALOG.read_text())
    model = CardModel(service)
    db.execute('BEGIN IMMEDIATE')
    try:
        nodes = {key: service.find_name(card['name']) for key, card in spec['cards'].items() if key not in ('gate', 'writer')}
        for key, name in [('raw', 'Few Understand · market.snapshot'), ('assets', 'assets'),
                          ('identifiers', 'asset_identifiers'), ('score', '确定资产起始评分'),
                          ('signals', 'Few Understand · signal.data')]:
            nodes[key] = service.find_name(name)
        if not all(nodes.values()):
            raise ValueError('Identity handoff: missing existing dependency')
        flow = json.loads((ROOT/'catalog/polars-indicator-flow.v1.json').read_text())
        old_signal = next(c for c in json.loads((ROOT/'catalog/coingecko-implemented-signals.v1.json').read_text())['cards'] if c['name']==nodes['signal']['name'])
        expected = {'entry': (flow['parent_description'], flow['parent_algorithm']),
                    'assembly': (flow['assembly']['description'], flow['assembly']['algorithm']),
                    'signal': (old_signal['condition'], old_signal['algorithm'])}
        for key in ('entry', 'assembly', 'signal', 'channel'):
            n=nodes[key]; config=model.contract(n['id'])['config']
            if config['read_only'] or config['action']['implementation'] not in ('unknown', 'planned'):
                raise ValueError('Identity handoff: protected card '+n['name'])
            if key in expected and (n['definition'], n['formula']) != expected[key]:
                raise ValueError('Identity handoff: edited card '+n['name'])
        for key in ('gate', 'writer'):
            if service.find_name(spec['cards'][key]['name']):
                raise ValueError('Identity handoff: card name conflict')
        old_edge = db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?',
                              (nodes['raw']['id'], nodes['signal']['id'])).fetchone()
        if not old_edge or service.get_field_usages(old_edge['id']):
            raise ValueError('Identity handoff: raw signal dependency changed')
        if len(list(db.execute('SELECT id FROM edges WHERE downstream_id=?', (nodes['signal']['id'],)))) != 1:
            raise ValueError('Identity handoff: signal has extra input')
        ref={'path':'catalog/coingecko-identity-handoff.v1.json', 'revision':hashlib.sha256(CATALOG.read_bytes()).hexdigest()}

        def save(node, config):
            model.validate_config(config, model.contract(node['id'])['kind'])
            db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?', (encoded(config), node['id']))

        def fields(node, definitions):
            current={f['name']:f for f in service.get_fields(node['id'])}
            for name, (kind, meaning) in definitions.items():
                if name in current:
                    db.execute('UPDATE node_fields SET data_type=?,definition=? WHERE id=?', (kind,meaning,current[name]['id']))
                else:
                    service.create_field(node['id'], {'name':name,'data_type':kind,'definition':meaning}, actor=ACTOR, commit=False)
            return {f['name']:f for f in service.get_fields(node['id'])}

        def connect(source, target, names, note, trigger='none', target_names=None):
            e=db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?',(source['id'],target['id'])).fetchone()
            if not e:
                e=service.create_edge({'upstream_id':source['id'],'downstream_id':target['id'],
                    'transport_kind':'direct','rationale':note},actor=ACTOR,commit=False)
            sf={f['name']:f for f in service.get_fields(source['id'])}; tf={f['name']:f for f in service.get_fields(target['id'])}
            used={u['source_field_id'] for u in service.get_field_usages(e['id'])}
            for name in names:
                if name not in sf: raise ValueError('Identity handoff: missing source field '+name)
                if sf[name]['id'] not in used:
                    dest=(target_names or {}).get(name,name)
                    service.create_field_usage(e['id'],{'source_field_id':sf[name]['id'],'target_field_id':tf.get(dest,{}).get('id'), 'usage_note':note},actor=ACTOR,commit=False)
            for b in db.execute('SELECT * FROM edge_bindings WHERE edge_id=?',(e['id'],)).fetchall():
                config=json.loads(b['config']);config.update(trigger=trigger,unresolved=[])
                db.execute('UPDATE edge_bindings SET config=? WHERE id=?',(encoded(config),b['id']))
            return e

        # Place only the two new cards in a free band; preserve every saved existing position.
        graph=service.graph(); x=nodes['signal']['position_x']-760; y=nodes['signal']['position_y']
        while any(abs(x+i*380-n['position_x'])<340 and abs(y-n['position_y'])<210 for i in (0,1) for n in graph['nodes']):
            y+=224
        for i,key in enumerate(('gate','writer')):
            item=spec['cards'][key]
            nodes[key]=service.create_node({'name':item['name'],'kind':'process','workflow_lane':'signal',
                'definition':item['description'],'formula':item['algorithm'],'position_x':x+i*380,'position_y':y,
                'caveats':'SS-79工作台设计；Few身份处理、事务、消息与运行未实现/核验。'},actor=ACTOR,commit=False)
        for key in ('entry','assembly','channel','gate','writer','signal'):
            node=nodes[key]; item=spec['cards'][key]; before=service.get_node(node['id'])
            db.execute('UPDATE nodes SET definition=?,formula=?,caveats=?,updated_at=? WHERE id=?',
                (item['description'],item['algorithm'],'SS-79已批准工作台定义；Few适配、部署和实际业务结果未核验。',now(),node['id']))
            config=model.contract(node['id'])['config']
            config['definition_refs']=[r for r in config['definition_refs'] if r['path']!=ref['path']]+[{**ref,'selector':{'key':key}}]
            config.setdefault('resource',{})['identity_handoff']={'key':key,'nullable_asset_id':True,'definition_ref':ref}
            if key in ('gate','writer','signal'):
                config.update(action={'id':'coingecko_identity.'+key,'version':1,'implementation':'planned'},draft=True,
                              trigger={'kind':'event','configuration_ref':ref})
                config['resource'].pop('legacy_settings_ref',None)
                config['resource']['delivery']='schema_and_connections_only'
            if key=='entry': config['resource']['identity_lookup_mode']='read_existing_only'
            if key=='gate':
                config['resource'].update(input_topic='indicator.data',consumer_group='signalstudio.identity.discovery',required_fields=spec['input_fields'],condition='asset_id is null and identity_status == source_only')
            if key=='writer':
                config['resource'].update(identity_key=['source_namespace','external_identifier'],creation_outcome='committed_created_only',cache_update_requirement='invalidate_or_refresh_all_3035_processes',cache_update_implementation='pending')
            if key=='assembly': config['resource']['assembly_key']=['observation_id']
            if key=='channel':
                config['resource'].setdefault('consumers',{})[spec['cards']['gate']['name']]='signalstudio.identity.discovery'
                config['resource']['rules']=spec['rules']
                config['resource']['message_key']=['observation_id']
            save(node,config)
            service._event(ACTOR,'update','node',node['id'],before=before,after=service.get_node(node['id']))
        shared={'asset_id':('string | null','已有内部UUID；确认无映射为null。3035不创建UUID。'),
                'identity_status':('resolved | source_only | conflict | lookup_error','resolved=已有有效映射；source_only=查权威库确认无映射；lookup_error=查询失败；conflict=冲突。'),
                'source_name':('string | null','CoinGecko来源name，供下游建档核实；不等于已有内部asset_name。')}
        for key in ('entry','assembly','channel'):
            fields(nodes[key],shared)
        # Nullable context is inherited by every metric card; the observation key is always required.
        for child in model.contract(nodes['entry']['id'])['config']['resource']['module_children']:
            n=service.get_node(child['node_id']);fields(n,{'asset_id':shared['asset_id']})
            cfg=model.contract(n['id'])['config'];cfg['resource']['nullable_identity_context']=True
            cfg['definition_refs'].append(ref);save(n,cfg)
        source_fields={f['name']:f for f in service.get_fields(nodes['channel']['id'])}
        handoff={name:(source_fields[name]['data_type'],source_fields[name]['definition']) for name in spec['input_fields']}
        for key in ('gate','writer'): fields(nodes[key],handoff)
        result={'action':('created | reused | pending | conflict | error','权威建档提交后的判定；只有created进入新信号与起始评分。'),
                'asset_id':('string | null','成功创建或复用的持久内部UUID，失败不得生成假ID。'),
                'identity_status':('resolved | source_only | conflict | lookup_error','created/reused输出resolved；其余保留未解决状态。原source_only身份快照保留在输入指标证据中，不回写5007。'),
                'asset_name':('string | null','成功建档后的内部展示名称。'),
                'source_namespace':('string','coingecko_coin_id；身份来源范围，不是评分来源source_id。'),
                'external_identifier':('string','CoinGecko稳定coin ID。'),
                'decision_ref':('string | null','持久建档结果引用；重试沿用，供通知与起始评分去重。')}
        fields(nodes['writer'],result)
        for key in ('signal',):
            fields(nodes[key],{name:('string','建档结果携带的指标追溯标识。') for name in ('metric_id','metric_version','observation_id')})
            fields(nodes[key],{'asset_id':('string','仅使用已提交created结果中的内部UUID。')})
        # Reuse the old raw->3016 edge identity as the new successful-writer->3016 handoff.
        before=dict(old_edge)
        db.execute('UPDATE edges SET upstream_id=?,rationale=? WHERE id=?',(nodes['writer']['id'],'仅已提交action=created的新资产结果触发发现信号。',old_edge['id']))
        db.execute('DELETE FROM edge_bindings WHERE edge_id=?',(old_edge['id'],));model.ensure_edge(service.get_edge(old_edge['id']))
        service._event(ACTOR,'update','edge',old_edge['id'],before=before,after=service.get_edge(old_edge['id']))
        connect(nodes['raw'],nodes['entry'],['name'],'保留来源name供下游核实建档。',target_names={'name':'source_name'})
        for a,b in [('entry','assembly'),('assembly','channel')]:
            connect(nodes[a],nodes[b],list(shared),'保留可空UUID、身份状态与来源名称；按observation_id组装。')
        gate_edge=connect(nodes['channel'],nodes['gate'],spec['input_fields'],'只筛选source_only且asset_id=null；失败与冲突不当新资产。','event')
        db.execute('UPDATE edges SET consumer_group=? WHERE id=?',('signalstudio.identity.discovery',gate_edge['id']))
        connect(nodes['gate'],nodes['writer'],spec['input_fields'],'确认无映射的观测进入核实与幂等建档。','event')
        connect(nodes['assets'],nodes['writer'],['asset_id','name'],'建档前再次核对已有内部资产；读取不触发。')
        connect(nodes['identifiers'],nodes['writer'],['source_namespace','external_identifier','asset_id'],'以来源稳定ID复核映射及并发复用；读取不触发。')
        connect(nodes['writer'],nodes['assets'],['asset_id','asset_name'],'仅事务建档成功写入；与来源映射原子一致。',target_names={'asset_name':'name'})
        connect(nodes['writer'],nodes['identifiers'],['source_namespace','external_identifier','asset_id'],'仅成功建档/补映射写入，稳定键唯一。')
        out_fields=[name for name in result if name != 'identity_status']+['source_id','source_object_id','symbol','metric_id','metric_version','observation_id','observed_at','snapshot_ref']
        connect(nodes['writer'],nodes['signal'],out_fields,'仅action=created且事务已提交后交发现信号；其余状态跳过。','event')
        connect(nodes['writer'],nodes['score'],['action','asset_id','asset_name','source_id','decision_ref'],'仅created交现有3009判断一次起始评分；建档decision_ref仅为输入依据，3009另存初始评分决定。缺CoinGecko来源配置待处理，不猜分值。','event',target_names={'decision_ref':None})
        connect(nodes['signal'],nodes['signals'],['metric_id','metric_version','observation_id'],'新资产通知保留原指标追溯；不回写5007。')
        raw_config=model.contract(nodes['raw']['id'])['config']
        raw_config['resource'].setdefault('consumers',{}).pop(nodes['signal']['name'],None)
        raw_config['definition_refs'].append(ref);save(nodes['raw'],raw_config)
        # Keep existing scoring configuration intact; add only the new handoff definition reference.
        score_config=model.contract(nodes['score']['id'])['config'];score_config['definition_refs'].append(ref);save(nodes['score'],score_config)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Identity handoff: invalid graph')
        db.execute('INSERT INTO schema_meta VALUES (?,?)',(MARKER,spec['version']))
        db.commit()
    except Exception:
        db.rollback()
        raise
