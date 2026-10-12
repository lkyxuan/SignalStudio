"""SS-72: install the approved indicator-first design; no Few runtime writes."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'catalog/market-polars.v1.json'
MARKER = 'market_polars_v1'
ACTOR = 'ss72-polars-design'


def ensure_market_polars(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        ensure_final_bindings(service)
        return
    if not service.db.execute("SELECT 1 FROM schema_meta WHERE key='market_channel_v1'").fetchone():
        return
    spec = json.loads(CATALOG.read_text())
    previous = json.loads((ROOT / 'catalog/leaderboard-foundation.v1.json').read_text())
    old = {item['key']: item for item in previous['nodes']}
    model = CardModel(service)
    service.db.execute('BEGIN IMMEDIATE')
    try:
        existing = {}
        for item in previous['nodes']:
            node = service.find_name(item['name'])
            if not node or node['definition'] != item['description'] or node['formula'] != item['algorithm']:
                raise ValueError('Polars upgrade: definition changed: ' + item['name'])
            actual = sorted((f['name'], f['data_type'], f['definition']) for f in service.get_fields(node['id']))
            if actual != sorted((f['name'], f['data_type'], f['label_zh']) for f in item['columns']):
                raise ValueError('Polars upgrade: fields changed: ' + item['name'])
            contract = model.contract(node['id'])['config']
            if contract.get('read_only') or contract['action']['implementation'] not in ('unknown', 'planned'):
                raise ValueError('Polars upgrade: protected implementation: ' + item['name'])
            expected_resource = {'design_key': item['key'], 'parameter_status': 'initial_defined',
                                 'primary_key': item['primary_key'], 'delivery': 'schema_and_connections_only'}
            expected_action = {'id': 'foundation.' + item['key'] if item['role']=='process' else '',
                               'version': 1, 'implementation': 'unknown'}
            if contract.get('resource') != expected_resource or contract.get('action') != expected_action or not contract.get('draft'):
                raise ValueError('Polars upgrade: configuration changed: ' + item['name'])
            expected_sources = set(item['sources'])
            if item['key'] == 'normalize':
                expected_sources.discard('coingecko.coins_markets')
                expected_sources.add('Few Understand · market.snapshot')
            actual_sources = {service.get_node(e['upstream_id'])['name'] for e in service.graph()['edges'] if e['downstream_id'] == node['id']}
            if actual_sources != expected_sources:
                raise ValueError('Polars upgrade: dependencies changed: ' + item['name'])
            existing[item['key']] = node
        managed = {node['id'] for node in existing.values()}
        retired = {existing[item['key']]['id'] for item in spec['retired']}
        # Refuse to remove any new downstream work attached to the retired cards.
        for edge in service.graph()['edges']:
            if edge['upstream_id'] in retired and edge['downstream_id'] not in managed:
                raise ValueError('Polars upgrade: retired card has unrelated downstream dependency')
        for item in spec['nodes']:
            if item['key'] not in existing and service.find_name(item['name']):
                raise ValueError('Polars upgrade: new card name conflict: ' + item['name'])
        names = {item['name'] for item in spec['nodes']}
        for name in {name for item in spec['nodes'] for name in item['sources']} - names:
            if not service.find_name(name):
                raise ValueError('Polars upgrade: input missing: ' + name)
        ref = {'path': 'catalog/market-polars.v1.json', 'revision': hashlib.sha256(CATALOG.read_bytes()).hexdigest()}
        rules_ref = {'path': spec['rules_ref'], 'revision': hashlib.sha256((ROOT / spec['rules_ref']).read_bytes()).hexdigest()}
        anchor = existing['normalize']
        nodes = {}
        for index, item in enumerate(spec['nodes']):
            node = existing.get(item['key'])
            if node is None:
                node = service.create_node({'name': item['name'], 'kind': item['role'], 'workflow_lane': 'shared',
                    'position_x': anchor['position_x'] + (index % 3) * 380,
                    'position_y': anchor['position_y'] + (index // 3) * 300}, actor=ACTOR, commit=False)
            nodes[item['name']] = node
            before = copy.deepcopy(node)
            service.db.execute('UPDATE nodes SET name=?,definition=?,formula=?,rationale=?,caveats=?,notes=?,updated_at=? WHERE id=?',
                (item['name'], item['description'], item['algorithm'], spec['purpose'],
                 'SS-72已批准设计；Few适配、部署和实际结果尚未核验。',
                 'catalog/market-polars.v1.json · ' + item['key'], now(), node['id']))
            fields = {f['name']: f for f in service.get_fields(node['id'])}
            desired = {f['name'] for f in item['columns']}
            for name, field in fields.items():
                if name not in desired:
                    service._event(ACTOR, 'delete', 'field', field['id'], before=field)
                    service.db.execute('DELETE FROM node_fields WHERE id=?', (field['id'],))
            for ordinal, field in enumerate(item['columns']):
                if field['name'] in fields:
                    identifier = fields[field['name']]['id']
                    service.db.execute('UPDATE node_fields SET data_type=?,definition=?,ordinal=? WHERE id=?',
                        (field['data_type'], field['label_zh'], ordinal, identifier))
                else:
                    identifier = service.create_field(node['id'], {'name': field['name'], 'data_type': field['data_type'],
                        'definition': field['label_zh']}, actor=ACTOR, commit=False)['id']
                    service.db.execute('UPDATE node_fields SET ordinal=? WHERE id=?', (ordinal, identifier))
            config = model.contract(node['id'])['config']
            config.update(definition_refs=[{**ref, 'selector': {'key': item['key']}}, rules_ref],
                action={'id': 'market_polars.' + item['key'] if item['role'] == 'process' else '', 'version': 1, 'implementation': 'planned'},
                trigger={'kind': 'event' if item['role'] == 'process' else 'unspecified', 'configuration_ref': ref},
                resource={'design_key': item['key'], 'primary_key': item['primary_key'], 'delivery': 'schema_and_connections_only'},
                draft=True, read_only=False)
            if item['key'] == 'indicators':
                config['resource'].update(topic='indicator.data', metric_version='market_indicators_v1',
                    consumers={'量价评分 · 生成贡献': 'signalstudio.market_v1.scorer'}, retention='unknown')
            if item['key'] == 'evidence':
                config['resource'].update(technology='Delta/Parquet', physical_binding='existing_archive_requires_adaptation')
            if item['key'] == 'redis_rollup':
                config['trigger'] = {'kind': 'event', 'configuration_ref': ref, 'also_schedule_seconds': 60}
            model.validate_config(config, item['role'])
            service.db.execute('UPDATE node_contracts SET kind=?,revision=revision+1,config=? WHERE node_id=?',
                (item['role'], encoded(config), node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=before, after=service.get_node(node['id']))
        for item in spec['retired']:
            node = existing[item['key']]
            service._event(ACTOR, 'delete', 'node', node['id'], before=node)
            service.db.execute('DELETE FROM nodes WHERE id=?', (node['id'],))
        # Replace only managed incoming edges; external downstream uses of surviving cards remain.
        surviving = {node['id'] for node in nodes.values()}
        desired = {(source, item['name']) for item in spec['nodes'] for source in item['sources']}
        desired.update((e['source'], e['target']) for e in spec['additional_edges'])
        for edge in service.graph()['edges']:
            pair = tuple(service.get_node(edge[k])['name'] for k in ('upstream_id', 'downstream_id'))
            if edge['downstream_id'] in surviving and pair not in desired:
                service._event(ACTOR, 'delete', 'edge', edge['id'], before=edge)
                service.db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
        for source_name, target_name in sorted(desired):
            source, target = service.find_name(source_name), service.find_name(target_name)
            edge = service.db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?', (source['id'], target['id'])).fetchone()
            if edge:
                edge = dict(edge)
                service.db.execute('DELETE FROM edge_field_usages WHERE edge_id=?', (edge['id'],))
                service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
                model.ensure_edge(edge)
            else:
                edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                    'rationale': 'SS-72指标先行：历史供计算，指标供筛选，评分供榜单。', 'transport_kind': 'direct'}, actor=ACTOR, commit=False)
            target_fields = {f['name']: f['id'] for f in service.get_fields(target['id'])}
            for field in service.get_fields(source['id']):
                if field['name'] in target_fields or model.contract(target['id'])['kind']=='process':
                    service.create_field_usage(edge['id'], {'source_field_id': field['id'], 'target_field_id': target_fields.get(field['name']),
                        'usage_note': '读取已声明输入；同名输出保留映射，其余为计算/筛选使用，不声称直接复制。'}, actor=ACTOR, commit=False)
        # The existing market channel must no longer advertise the deleted normalizer.
        market = service.find_name('Few Understand · market.snapshot')
        config = model.contract(market['id'])['config']
        config['definition_refs'] = [ref]
        config['resource']['consumers'].pop('归一结构化榜单观测', None)
        config['resource']['consumers'].update({'Polars · 计算 CoinGecko 量价指标': 'signalstudio.market_indicators',
                                               '归档 CoinGecko 行情': 'delta-lake-writer-group'})
        config['resource']['contract_ref'] = ref['path']
        config['resource']['rules'] = spec['rules']
        service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?', (encoded(config), market['id']))
        service.db.execute('UPDATE nodes SET definition=?,notes=?,updated_at=? WHERE id=?',
            ('CoinGecko唯一行情通道；Polars计算指标、既有历史归档与独立提醒各自消费。', encoded(config['resource']), now(), market['id']))
        candidate = service.find_name('市场交易活跃候选')
        if candidate:
            config = model.contract(candidate['id'])['config']
            config['definition_refs'] = [r for r in config['definition_refs'] if r['path'] != 'catalog/market-channel.v1.json']
            config['definition_refs'].append(ref)
            service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?', (encoded(config), candidate['id']))
        if service.db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Polars upgrade: invalid graph')
        service.db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, spec['revision']))
        ensure_final_bindings(service)
        service.db.commit()
    except Exception:
        service.db.rollback()
        raise


def ensure_input_bindings(service):
    """Complete declared process inputs for early SS-72 snapshots, once only."""
    marker = MARKER + '_inputs'
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (marker,)).fetchone():
        return
    owned = not service.db.in_transaction
    if owned:
        service.db.execute('BEGIN IMMEDIATE')
    try:
        spec = json.loads(CATALOG.read_text())
        processes = {item['name'] for item in spec['nodes'] if item['role']=='process'}
        for edge in service.graph()['edges']:
            target = service.get_node(edge['downstream_id'])
            if target['name'] not in processes:
                continue
            used = {row['source_field_id'] for row in service.get_field_usages(edge['id'])}
            for field in service.get_fields(edge['upstream_id']):
                if field['id'] not in used:
                    service.create_field_usage(edge['id'], {'source_field_id':field['id'], 'target_field_id':None,
                        'usage_note':'该字段作为处理输入使用，不声称复制到输出。'}, actor=ACTOR, commit=False)
        service.db.execute('INSERT INTO schema_meta VALUES (?,?)', (marker, spec['revision']))
        if owned:
            service.db.commit()
    except Exception:
        if owned:
            service.db.rollback()
        raise


def ensure_final_bindings(service):
    """Finish the collector coverage branch and pin the current approved catalog."""
    marker = MARKER + '_final'
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (marker,)).fetchone():
        return
    owned = not service.db.in_transaction
    if owned:
        service.db.execute('BEGIN IMMEDIATE')
    try:
        spec = json.loads(CATALOG.read_text())
        model = CardModel(service)
        source, coverage = service.find_name('coingecko.coins_markets'), service.find_name('leaderboard_coverage')
        if not service.db.execute('SELECT 1 FROM edges WHERE upstream_id=? AND downstream_id=?', (source['id'], coverage['id'])).fetchone():
            service.create_edge({'upstream_id':source['id'], 'downstream_id':coverage['id'],
                'rationale':'采集端必须记录每次运行的覆盖、失败和初始基线；不是从成功币种推断。',
                'transport_kind':'direct'}, actor=ACTOR, commit=False)
        revision = hashlib.sha256(CATALOG.read_bytes()).hexdigest()
        for node in service.graph()['nodes']:
            config = model.contract(node['id'])['config']
            touched = False
            for ref in config['definition_refs']:
                if ref['path']=='catalog/market-polars.v1.json':
                    ref['revision'] = revision
                    touched = True
            trigger_ref = config.get('trigger',{}).get('configuration_ref')
            if trigger_ref and trigger_ref.get('path')=='catalog/market-polars.v1.json':
                trigger_ref['revision']=revision
            if touched:
                service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?', (encoded(config),node['id']))
        ensure_input_bindings(service)
        service.db.execute('INSERT INTO schema_meta VALUES (?,?)', (marker, spec['revision']))
        if owned:
            service.db.commit()
    except Exception:
        if owned:
            service.db.rollback()
        raise
