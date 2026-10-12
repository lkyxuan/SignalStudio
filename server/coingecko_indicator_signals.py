"""SS-74 workspace migration only; never starts Few consumers or publishes messages."""
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'catalog/coingecko-indicator-signals.v1.json'
MARKER = 'coingecko_indicator_signals_v1'
ACTOR = 'ss74-indicator-alerts'


def ensure_coingecko_indicator_signals(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not service.db.execute("SELECT 1 FROM schema_meta WHERE key='market_polars_v1'").fetchone():
        return
    spec = json.loads(CATALOG.read_text())
    market_spec = json.loads((ROOT / 'catalog/market-polars.v1.json').read_text())
    model = CardModel(service)
    service.db.execute('BEGIN IMMEDIATE')
    try:
        market = service.find_name('Few Understand · market.snapshot')
        channel = service.find_name(spec['input'])
        polars = service.find_name('Polars · 计算 CoinGecko 量价指标')
        output = service.find_name(spec['output'])
        if not all((market, channel, polars, output)):
            raise ValueError('Indicator alerts: missing input')
        graph = service.graph()
        edges = {(e['upstream_id'], e['downstream_id']): e for e in graph['edges']}
        cards = []
        for item in spec['cards']:
            node = service.find_name(item['name'])
            if not node or node['definition'] != item['previous']['condition'] or node['formula'] != item['previous']['algorithm']:
                raise ValueError('Indicator alerts: definition changed: ' + item['name'])
            config = model.contract(node['id'])['config']
            if config['read_only'] or config['action']['implementation'] not in ('unknown', 'planned'):
                raise ValueError('Indicator alerts: protected card: ' + item['name'])
            incoming = {e['upstream_id'] for e in graph['edges'] if e['downstream_id'] == node['id']}
            if incoming != {market['id']}:
                raise ValueError('Indicator alerts: dependencies changed: ' + item['name'])
            old_edge = edges[(market['id'], node['id'])]
            if service.get_field_usages(old_edge['id']):
                raise ValueError('Indicator alerts: edited input mapping: ' + item['name'])
            cards.append((item, node, config, old_edge))
        for key, node in (('polars', polars), ('indicators', channel)):
            config = model.contract(node['id'])['config']
            if config['read_only'] or config['action']['implementation'] not in ('unknown', 'planned'):
                raise ValueError('Indicator alerts: protected metric card')
            item = next(n for n in market_spec['nodes'] if n['key'] == key)
            allowed = [(item['description'], item['algorithm'])]
            if key == 'polars':
                allowed.append((spec['previous_polars']['description'], spec['previous_polars']['algorithm']))
            if (node['definition'], node['formula']) not in allowed:
                raise ValueError('Indicator alerts: metric definition changed')
            actual = {(f['name'],f['data_type'],f['definition']) for f in service.get_fields(node['id'])}
            desired = {(f['name'],f['data_type'],f['label_zh']) for f in item['columns']}
            if actual not in (desired, {f for f in desired if f[0]!='ath_change_percentage'}):
                raise ValueError('Indicator alerts: metric fields changed')
        ref = {'path':'catalog/coingecko-indicator-signals.v1.json', 'revision':hashlib.sha256(CATALOG.read_bytes()).hexdigest()}
        metric_ref = {'path':'catalog/market-polars.v1.json', 'revision':hashlib.sha256((ROOT/'catalog/market-polars.v1.json').read_bytes()).hexdigest()}
        for key, node in (('polars',polars),('indicators',channel)):
            item = next(n for n in market_spec['nodes'] if n['key']==key)
            fields = {f['name']:f for f in service.get_fields(node['id'])}
            if 'ath_change_percentage' not in fields:
                f = next(f for f in item['columns'] if f['name']=='ath_change_percentage')
                service.create_field(node['id'], {'name':f['name'],'data_type':f['data_type'],'definition':f['label_zh']},actor=ACTOR,commit=False)
            if key=='polars':
                service.db.execute('UPDATE nodes SET definition=?,formula=?,updated_at=? WHERE id=?', (item['description'],item['algorithm'],now(),node['id']))
        for name in ('metric_id','metric_version','observation_id'):
            if not any(f['name']==name for f in service.get_fields(output['id'])):
                service.create_field(output['id'], {'name':name,'data_type':'string | null',
                    'definition':'指标驱动的五类提醒必须携带；其他既有信号可为空。'},actor=ACTOR,commit=False)
        output_config = model.contract(output['id'])['config']
        output_config['definition_refs'].append(ref)
        output_config['resource']['indicator_alert_lineage'] = ['metric_id','metric_version','observation_id']
        service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?',(encoded(output_config),output['id']))
        for item,node,config,edge in cards:
            service.db.execute('UPDATE nodes SET definition=?,formula=?,notes=?,caveats=?,updated_at=? WHERE id=?',
                (item['description'],item['algorithm'],ref['path']+' · '+item['key'],
                 'SS-74已批准工作台设计；Few适配、部署和运行未核验。',now(),node['id']))
            config.update(definition_refs=[{**ref,'selector':{'key':item['key']}}],
                action={'id':'coingecko_alerts.'+item['key'],'version':1,'implementation':'planned'},
                trigger={'kind':'event','configuration_ref':ref},
                resource={'input_topic':'indicator.data','metric_version':spec['metric_version'],
                          'consumer_group':spec['consumer_group'],'required_fields':item['input_fields']+spec['envelope_fields'],
                          'condition':item['condition'],'delivery':'schema_and_connections_only'},draft=True)
            model.validate_config(config,'process')
            service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?',(encoded(config),node['id']))
            for name in ('metric_id','metric_version','observation_id'):
                if not any(f['name']==name for f in service.get_fields(node['id'])):
                    service.create_field(node['id'],{'name':name,'data_type':'string','definition':'信号携带的指标追溯字段；不是重新计算。'},actor=ACTOR,commit=False)
            service.db.execute('UPDATE edges SET upstream_id=?,rationale=?,consumer_group=? WHERE id=?',
                (channel['id'],'SS-74：消费Polars指标，只判断条件，不读行情历史。',spec['consumer_group'],edge['id']))
            service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?',(edge['id'],))
            model.ensure_edge(service.get_edge(edge['id']))
            channel_fields={f['name']:f for f in service.get_fields(channel['id'])}
            for name in item['input_fields']+spec['envelope_fields']:
                service.create_field_usage(edge['id'],{'source_field_id':channel_fields[name]['id'],'target_field_id':None,
                    'usage_note':'消费已发布指标及追溯元数据，不在判断层计算。'},actor=ACTOR,commit=False)
            publish_edge=edges.get((node['id'],output['id']))
            if not publish_edge:
                raise ValueError('Indicator alerts: missing signal publication')
            output_fields={f['name']:f for f in service.get_fields(output['id'])}
            for f in service.get_fields(node['id']):
                if f['name'] in ('metric_id','metric_version','observation_id'):
                    service.create_field_usage(publish_edge['id'],{'source_field_id':f['id'],
                        'target_field_id':output_fields[f['name']]['id'],'usage_note':'发布指标追溯标识。'},actor=ACTOR,commit=False)
            service._event(ACTOR,'update','node',node['id'],before=node,after=service.get_node(node['id']))
        for node in (market,channel):
            config=model.contract(node['id'])['config']
            consumers=config['resource'].setdefault('consumers',{})
            for item in spec['cards']:
                consumers.pop(item['name'],None)
                if node['id']==channel['id']:
                    consumers[item['name']]=spec['consumer_group']
            config['resource']['rules']=market_spec['rules'] if node['id']==market['id'] else spec['rules']
            config['definition_refs'].append(ref)
            service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?',(encoded(config),node['id']))
        service.db.execute('UPDATE nodes SET definition=?,notes=?,updated_at=? WHERE id=?',
            ('CoinGecko唯一原始行情通道；供Polars统一计算、历史归档及身份候选消费。五类行情提醒改从指标通道消费。',
             encoded(model.contract(market['id'])['config']['resource']),now(),market['id']))
        # Complete the raw ATH -> Polars -> indicator topic mappings, preserving other mappings.
        for source,target in ((market,polars),(polars,channel)):
            edge=edges[(source['id'],target['id'])]
            sf=next(f for f in service.get_fields(source['id']) if f['name']=='ath_change_percentage')
            tf=next(f for f in service.get_fields(target['id']) if f['name']=='ath_change_percentage')
            if not any(u['source_field_id']==sf['id'] for u in service.get_field_usages(edge['id'])):
                service.create_field_usage(edge['id'],{'source_field_id':sf['id'],'target_field_id':tf['id'],
                    'usage_note':'保留来源全历史ATH百分比口径；缺失保持null。'},actor=ACTOR,commit=False)
        for node in service.graph()['nodes']:
            config=model.contract(node['id'])['config']; touched=False
            for r in config['definition_refs']:
                if r['path']==metric_ref['path']:
                    r['revision']=metric_ref['revision']; touched=True
            trigger=config.get('trigger',{}).get('configuration_ref')
            if trigger and trigger.get('path')==metric_ref['path']:
                trigger['revision']=metric_ref['revision']; touched=True
            if touched:
                service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?',(encoded(config),node['id']))
        if service.db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Indicator alerts: invalid graph')
        service.db.execute('INSERT INTO schema_meta VALUES (?,?)',(MARKER,spec['version']))
        service.db.commit()
    except Exception:
        service.db.rollback()
        raise
