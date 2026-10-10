"""Install the approved three-board design, never execute its pending algorithms."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now

CATALOG = Path(__file__).resolve().parent.parent / 'catalog/leaderboard-trends.v1.json'
MARKER = 'leaderboard_trends_v1'
ACTOR = 'three-board-design'


def ensure_leaderboard_trends(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    catalog = json.loads(CATALOG.read_text())
    specs = catalog['nodes']
    original = {name: service.find_name(name) for name in catalog['previous_nodes']}
    if any(node is None for node in original.values()):
        raise ValueError('Three-board migration is missing an expected design card')
    # Refuse silently overwriting a concurrent or custom definition.
    for name, expected in catalog['previous_nodes'].items():
        node = original[name]
        variants = [expected] + catalog.get('previous_variants', {}).get(name, [])
        if not any(all(node[key] == value for key, value in variant.items()) for variant in variants):
            raise ValueError('Three-board design changed; review before migration: ' + name)
        fields = sorted([{k:f[k] for k in ('name','data_type','definition')}
                         for f in service.get_fields(node['id'])], key=lambda f:f['name'])
        if fields not in catalog['previous_field_variants'][name]:
            raise ValueError('Three-board fields changed; review before migration: ' + name)
    old_names = set(original)
    relevant_edges = [e for e in service.graph()['edges']
                      if service.get_node(e['upstream_id'])['name'] in old_names
                      or service.get_node(e['downstream_id'])['name'] in old_names]
    pairs = {(service.get_node(e['upstream_id'])['name'], service.get_node(e['downstream_id'])['name'])
             for e in relevant_edges}
    if pairs != {tuple(pair) for pair in catalog['previous_edges']}:
        raise ValueError('Three-board dependencies changed; review before migration')
    for spec in specs:
        conflict = service.find_name(spec['name'])
        if conflict and conflict['id'] != original[spec['old_name']]['id']:
            raise ValueError('Three-board name conflict: ' + spec['name'])
    model = CardModel(service)
    if not model.enabled():
        raise ValueError('Install the shared card model before the three-board design')
    module_ref = {'path': 'catalog/leaderboard-trends.v1.json',
                  'revision': hashlib.sha256(CATALOG.read_bytes()).hexdigest()}
    with service.db:
        # Archive full design identities in the existing audit log before removal.
        for name in catalog['retire_names']:
            node = original[name]
            service._event(ACTOR, 'retire_design', 'node', node['id'], before={
                'node': node, 'fields': service.get_fields(node['id']),
                'contract': model.contract(node['id']),
                'edges': [e for e in relevant_edges if node['id'] in (e['upstream_id'], e['downstream_id'])]})
            service.db.execute('DELETE FROM nodes WHERE id=?', (node['id'],))
        for spec in specs:
            node = original[spec['old_name']]
            service.db.execute('UPDATE nodes SET name=?,definition=?,formula=?,rationale=?,caveats=?,notes=?,validation_plan=?,updated_at=? WHERE id=?', (
                spec['name'], spec['description'], spec['algorithm'], catalog['purpose'],
                '产品方向已确认；公式、窗口和门槛仍待定。无Few后端执行或有效性证明。',
                'catalog/leaderboard-trends.v1.json · ' + spec['key'],
                '核验三榜可交叉、理由证据时间可追溯、缺覆盖不补零、低基数不夸大、新发现不重置、降温仅标签。',
                now(), node['id']))
            existing = {f['name']: f for f in service.get_fields(node['id'])}
            wanted = {f['name'] for f in spec['columns']}
            for name, field in existing.items():
                if name not in wanted:
                    service._event(ACTOR, 'delete', 'field', field['id'], before=field)
                    service.db.execute('DELETE FROM node_fields WHERE id=?', (field['id'],))
            service.db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?', (node['id'],))
            for index, column in enumerate(spec['columns']):
                if column['name'] in existing:
                    field = existing[column['name']]
                    service.db.execute('UPDATE node_fields SET data_type=?,definition=?,ordinal=?,updated_at=? WHERE id=?',
                        (column['data_type'], column['label_zh'], index, now(), field['id']))
                else:
                    service.create_field(node['id'], {'name': column['name'], 'data_type': column['data_type'],
                        'definition': column['label_zh']}, actor=ACTOR, commit=False)
            service.db.execute('UPDATE nodes SET is_system_state=? WHERE id=?', (node['is_system_state'], node['id']))
            old_contract = model.contract(node['id'])
            config = copy.deepcopy(old_contract['config'])
            config['definition_refs'] = [{**module_ref, 'selector': {'key': spec['key']}}]
            config['action'] = {'id': 'threeboards.' + spec['key'] if spec['role'] == 'process' else '',
                                'version': 1, 'implementation': 'unknown'}
            config['trigger'] = {'kind': 'unspecified', 'configuration_ref': module_ref}
            config['draft'] = True  # Product approval does not resolve numeric parameters.
            config['resource'] = {'design_key': spec['key'], 'parameter_status': 'pending'}
            service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?',
                               (encoded(config), node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
        by_name = {s['name']: service.find_name(s['name']) for s in specs}
        desired = {(source, spec['name']) for spec in specs for source in spec['sources']}
        # Evidence and coverage tables have external producers only when defined;
        # all installed leaderboard edges are explicitly accounted for above.
        for edge in service.graph()['edges']:
            source, target = (service.get_node(edge[key])['name'] for key in ('upstream_id', 'downstream_id'))
            if source not in by_name and target not in by_name:
                continue
            if source in by_name and target not in by_name:
                continue  # Keep unrelated downstream consumers and content stages.
            if (source, target) not in desired:
                service._event(ACTOR, 'delete', 'edge', edge['id'], before=edge)
                service.db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
        for source_name, target_name in sorted(desired):
            source, target = service.find_name(source_name), service.find_name(target_name)
            if source is None or target is None:
                raise ValueError('Missing three-board input: ' + source_name)
            edge = service.db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?',
                                      (source['id'], target['id'])).fetchone()
            if edge:
                edge = dict(edge)
                service.db.execute('DELETE FROM edge_field_usages WHERE edge_id=?', (edge['id'],))
                service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
                service.db.execute('UPDATE edges SET rationale=?,transformation=? WHERE id=?',
                    ('三榜设计依赖；非运行证明。', '读取可追溯记录；规则/参数待定处不得使用旧公式。', edge['id']))
                model.ensure_edge(edge, migrated=True)
            else:
                edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                    'rationale': '三榜设计依赖；非运行证明。', 'transport_kind': 'direct'}, actor=ACTOR, commit=False)
            targets = {f['name']: f['id'] for f in service.get_fields(target['id'])}
            source_mapping = {
                'assets': {'asset_id': 'asset_id', 'name': 'asset_name'},
                'asset_identifiers': {'source_namespace': 'source_id', 'external_identifier': None, 'asset_id': 'asset_id'},
                'rss.item': {'guid': 'source_record_id', 'link': 'url', 'title': 'text', 'description': 'text', 'pubDate': 'published_at', 'source': 'publisher_id'},
                'telegram.bot.message': {'message_id': 'source_record_id', 'date': 'published_at', 'chat.id': 'publisher_id', 'from.id': 'author_id', 'text': 'text', 'caption': 'text'},
                'telegram.telethon.message': {'id': 'source_record_id', 'date': 'published_at', 'peer_id': 'publisher_id', 'from_id': 'author_id', 'message': 'text', 'fwd_from': 'canonical_story_id'},
            }.get(source_name)
            for field in service.get_fields(source['id']):
                if target_name == '候选代币筛选' and field['name'] not in {'asset_id', 'score', 'calculated_at', 'algorithm_version'}:
                    continue
                if source_mapping is not None and field['name'] not in source_mapping:
                    continue
                target_name_field = source_mapping[field['name']] if source_mapping is not None else field['name']
                target_id = targets.get(target_name_field) or targets.get('input_records_json')
                service.create_field_usage(edge['id'], {'source_field_id': field['id'], 'target_field_id': target_id,
                    'usage_note': '同名字段直接保留；input_records_json存有依据的输入记录；其余输入须由本步明确推导，不凭名字猜值。'},
                    actor=ACTOR, commit=False)
        if service.db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Three-board migration foreign-key check failed')
        service.db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, catalog['revision']))
