"""Install approved table/connection definitions, without processing source data."""
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now
from source_contract_store import SourceContractStore

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'catalog/leaderboard-foundation.v1.json'
MARKER = 'leaderboard_foundation_v1'
ACTOR = 'three-board-foundation-design'


def ensure_leaderboard_foundation(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    catalog = json.loads(CATALOG.read_text())
    previous_path = ROOT / catalog['migration']['previous_catalog']
    previous = json.loads(previous_path.read_text())
    model = CardModel(service)
    previous_revision = hashlib.sha256(previous_path.read_bytes()).hexdigest()
    expected = {spec['key']: spec for spec in previous['nodes']}
    nodes = {}
    connections = {(e['source'],e['target']):e for e in catalog['migration']['previous_connections']}
    # Preflight everything before changing fields, dependencies or definitions.
    for spec in catalog['nodes']:
        if spec['key'] not in expected:
            if service.find_name(spec['name']):
                raise ValueError('Foundation name conflict: ' + spec['name'])
            continue
        old = expected[spec['key']]
        node = service.find_name(old['name'])
        if not node or any(node[key] != value for key, value in {
                'definition': old['description'], 'formula': old['algorithm']}.items()):
            raise ValueError('Foundation definition changed; review: ' + old['name'])
        fields = sorted((f['name'], f['data_type'], f['definition']) for f in service.get_fields(node['id']))
        if fields != sorted((f['name'], f['data_type'], f['label_zh']) for f in old['columns']):
            raise ValueError('Foundation fields changed; review: ' + old['name'])
        config = model.contract(node['id'])['config']
        if (config['definition_refs'] != [{'path': catalog['migration']['previous_catalog'],
                'revision': previous_revision, 'selector': {'key': spec['key']}}]
                or config['action'] != {'id': 'threeboards.' + spec['key'] if old['role'] == 'process' else '',
                                        'version': 1, 'implementation': 'unknown'}
                or config['trigger'] != {'kind': 'unspecified', 'configuration_ref': {
                    'path': catalog['migration']['previous_catalog'], 'revision': previous_revision}}
                or config['resource'] != {'design_key': spec['key'], 'parameter_status': 'pending'}
                or config.get('draft') is not True or config.get('read_only')):
            raise ValueError('Foundation configuration changed; review: ' + old['name'])
        incoming = [e for e in service.graph()['edges'] if e['downstream_id'] == node['id']]
        if {service.get_node(e['upstream_id'])['name'] for e in incoming} != set(old['sources']):
            raise ValueError('Foundation dependencies changed; review: ' + old['name'])
        for edge in incoming:
            connection = connections[(service.get_node(edge['upstream_id'])['name'],old['name'])]
            if any(edge[k] != v for k,v in connection['transport'].items()):
                raise ValueError('Foundation transport changed; review: ' + old['name'])
            bindings = [{'kind':b['kind'],'branch':b['branch'],'config':json.loads(b['config'])}
                        for b in service.db.execute('SELECT * FROM edge_bindings WHERE edge_id=?', (edge['id'],))]
            if sorted(bindings,key=encoded) != sorted(connection['bindings'],key=encoded):
                raise ValueError('Foundation binding changed; review: ' + old['name'])
        conflict = service.find_name(spec['name'])
        if conflict and conflict['id'] != node['id']:
            raise ValueError('Foundation name conflict: ' + spec['name'])
        nodes[spec['name']] = node
    # A new empty workspace has no user-authored shared scoring chain to reuse.
    # Leave its existing draft intact; a partially deleted chain remains a conflict.
    if not service.find_name('Redis 近期评分窗口') and not service.find_name('提交评分事件'):
        print('market_v1 design not installed: shared scoring chain absent; no upgrade marker written.')
        return
    prospective = {spec['name'] for spec in catalog['nodes']}
    for source in {source for spec in catalog['nodes'] for source in spec['sources']} - prospective:
        if not service.find_name(source):
            raise ValueError('Foundation input missing: ' + source)
    for edge in catalog.get('additional_edges', []):
        if not service.find_name(edge['target']):
            raise ValueError('Foundation publisher missing: ' + edge['target'])
    source_contracts = {entry['id']: entry for entry in SourceContractStore().contract['operations']}
    business_tables = json.loads((ROOT/'catalog/business-tables.v1.json').read_text())['tables']
    module_ref = {'path': 'catalog/leaderboard-foundation.v1.json',
                  'revision': hashlib.sha256(CATALOG.read_bytes()).hexdigest()}
    with service.db:
        graph = service.graph()
        origin_x = max(n['position_x'] for n in graph['nodes']) + 650
        origin_y = min(n['position_y'] for n in graph['nodes'])
        for index, spec in enumerate(n for n in catalog['nodes'] if n['key'] not in expected):
            nodes[spec['name']] = service.create_node({'name':spec['name'],
                'kind':'table' if spec['role']=='table' else 'process',
                'workflow_lane':'shared', 'position_x':origin_x, 'position_y':origin_y+index*300}, actor=ACTOR,commit=False)
        # Source fields are declared/observed schemas, never imported live rows.
        for name, mapping in catalog['source_field_mappings'].items():
            source = service.find_name(name)
            existing = {f['name'] for f in service.get_fields(source['id'])}
            declared = {f['path']: f for f in source_contracts.get(name, {}).get('fields', [])}
            if name in ('assets','asset_identifiers'):
                declared = {f['name']:{'type':f['type'],'label_zh':f['label_zh']}
                            for f in business_tables[name]['columns']}
            if name == 'Redis 近期评分窗口':
                declared = {f['name']:{'type':f['type'],'label_zh':f['label_zh']}
                            for f in business_tables['asset_score_events']['columns']}
                declared.update(decay_policy_ref={'type':'string','label_zh':'冻结的衰减规则版本'},
                                half_life_minutes={'type':'number','label_zh':'冻结的每笔半衰期'})
            service.db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?',(source['id'],))
            for field_name in mapping.keys() - existing:
                if field_name not in declared:
                    raise ValueError('Undeclared structured source field: ' + name + '.' + field_name)
                field = declared[field_name]
                service.create_field(source['id'], {'name': field_name, 'data_type': field['type'],
                    'definition': field['label_zh']}, actor=ACTOR, commit=False)
            service.db.execute('UPDATE nodes SET is_system_state=? WHERE id=?',(source['is_system_state'],source['id']))
        for spec in catalog['nodes']:
            node = nodes[spec['name']]
            service.db.execute('UPDATE nodes SET name=?,definition=?,formula=?,rationale=?,caveats=?,notes=?,validation_plan=?,updated_at=? WHERE id=?', (
                spec['name'], spec['description'], spec['algorithm'], catalog['purpose'],
                '用户授权AI制定market_v1初版评分；参数/规则已定义，无Few后台执行或真实榜单写入证明。',
                'catalog/leaderboard-foundation.v1.json · ' + spec['key'],
                '核对结构化输入、身份边界、首次基线、NULL分数、来源与时间；不依赖正文理解。', now(), node['id']))
            existing = {f['name']: f for f in service.get_fields(node['id'])}
            wanted = {f['name'] for f in spec['columns']}
            for name, field in existing.items():
                if name not in wanted:
                    service._event(ACTOR, 'delete', 'field', field['id'], before=field)
                    service.db.execute('DELETE FROM node_fields WHERE id=?', (field['id'],))
            service.db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?', (node['id'],))
            for index, field in enumerate(spec['columns']):
                if field['name'] in existing:
                    service.db.execute('UPDATE node_fields SET data_type=?,definition=?,ordinal=?,updated_at=? WHERE id=?',
                        (field['data_type'], field['label_zh'], index, now(), existing[field['name']]['id']))
                else:
                    created = service.create_field(node['id'], {'name': field['name'], 'data_type': field['data_type'],
                        'definition': field['label_zh']}, actor=ACTOR, commit=False)
                    service.db.execute('UPDATE node_fields SET ordinal=? WHERE id=?',(index,created['id']))
            service.db.execute('UPDATE nodes SET is_system_state=? WHERE id=?', (node['is_system_state'], node['id']))
            config = model.contract(node['id'])['config']
            rules_path = ROOT / catalog['rules_ref']
            rules_ref = {'path':catalog['rules_ref'],'revision':hashlib.sha256(rules_path.read_bytes()).hexdigest()}
            config.update(definition_refs=[{**module_ref, 'selector': {'key': spec['key']}},rules_ref],
                          action={'id': 'foundation.' + spec['key'] if spec['role'] == 'process' else '',
                                  'version': 1, 'implementation': 'unknown'},
                          trigger={'kind': 'unspecified', 'configuration_ref': module_ref}, draft=True,
                          resource={'design_key': spec['key'], 'parameter_status': 'initial_defined',
                                    'primary_key': spec['primary_key'], 'delivery': 'schema_and_connections_only'})
            service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?', (encoded(config), node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
        desired = {(source, spec['name']) for spec in catalog['nodes'] for source in spec['sources']}
        desired.update((e['source'],e['target']) for e in catalog.get('additional_edges',[]))
        managed_ids = {node['id'] for node in nodes.values()}
        # Preserve every external downstream edge and every unrelated input.
        for edge in service.graph()['edges']:
            if edge['downstream_id'] in managed_ids:
                pair = (service.get_node(edge['upstream_id'])['name'], service.get_node(edge['downstream_id'])['name'])
                if pair not in desired:
                    service._event(ACTOR, 'delete', 'edge', edge['id'], before=edge)
                    service.db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
        for source_name, target_name in sorted(desired):
            source, target = service.find_name(source_name), service.find_name(target_name)
            row = service.db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?', (source['id'], target['id'])).fetchone()
            if row:
                edge = dict(row)
                service.db.execute('DELETE FROM edge_field_usages WHERE edge_id=?', (edge['id'],))
                service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
                service.db.execute("UPDATE edges SET transport_kind='direct',transport_topic='',transport_key='',payload_schema='',transport_headers='[]',consumer_group='',branch_label='',rationale=?,transformation=? WHERE id=?",
                    ('基础表结构化依赖；非自动采集或写入证明。', '读取已声明结构化字段和原始引用；不推测文本、身份或分数。', edge['id']))
                model.ensure_edge(service.get_edge(edge['id']), migrated=True)
            else:
                edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                    'rationale': '基础表结构化依赖；非自动采集或写入证明。', 'transport_kind': 'direct'}, actor=ACTOR, commit=False)
            targets = {f['name']: f['id'] for f in service.get_fields(target['id'])}
            mapping = catalog['source_field_mappings'].get(source_name)
            extra_edge = next((e for e in catalog.get('additional_edges',[]) if (e['source'],e['target'])==(source_name,target_name)),None)
            for field in service.get_fields(source['id']):
                if extra_edge and field['name'] not in extra_edge['fields']:
                    continue
                target_field = mapping.get(field['name']) if mapping is not None else field['name']
                if target_field is None:
                    continue
                target_id = targets.get(target_field) or targets.get('input_records_json')
                if target_id:
                    service.create_field_usage(edge['id'], {'source_field_id': field['id'], 'target_field_id': target_id,
                        'usage_note': '来源字段映射或同名保留；身份、基线、采集元数据须由明确处理步骤提供，不能猜值。'}, actor=ACTOR, commit=False)
        if service.db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Foundation foreign-key check failed')
        service.db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, catalog['revision']))
