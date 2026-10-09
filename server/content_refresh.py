"""Install the approved Studio design only; never execute content generation."""
import json
from pathlib import Path

from leaderboard_algorithms import _fields
from graph_service import now

CATALOG = Path(__file__).resolve().parent.parent / 'catalog/content-refresh.v1.json'
MARKER = 'content_refresh_design_v1'
ACTOR = 'content-refresh-design-v1'


def _ensure_legacy_content_refresh(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    contract = json.loads(CATALOG.read_text())
    legacy = contract['legacy_node']
    names = [legacy['name'], contract['result']['name']]
    if any(service.find_name(name) for name in names):
        raise ValueError('Content refresh design conflicts with an existing card')
    sources = [(service.find_name(board['table_name']), board['consumed_fields'])
               for board in contract['boards']]
    sources.append((service.find_name('asset_identifiers'),
                    ['asset_id', 'source_namespace', 'external_identifier']))
    business = json.loads((CATALOG.parent / 'business-tables.v1.json').read_text())['tables']
    for node, columns in sources:
        declared = business.get(node['name'], {}).get('columns', []) if node else []
        known = {f['name'] for f in service.get_fields(node['id'])} if node else set()
        if node is None or not set(columns).issubset(known | {c['name'] for c in declared}):
            raise ValueError('Missing content refresh source card or consumed fields')
    with service.db:
        # Core table fields previously lived only in their catalog renderer.
        # Materialize only the consumed declarations for graph field usages;
        # they remain schema definitions, never observed database values.
        for source, columns in sources:
            declared = business.get(source['name'], {}).get('columns', [])
            _fields(service, source, [{**c, 'data_type': c['type']}
                                     for c in declared if c['name'] in columns])
        bottom = service.db.execute('SELECT COALESCE(MAX(position_y),0) FROM nodes').fetchone()[0] + 300
        engine = service.create_node({
            'name': names[0], 'type': 'Metric', 'workflow_lane': 'shared',
            'definition': legacy['description_zh'],
            'formula': legacy['algorithm_zh'],
            'caveats': contract['limitations_zh'],
            'validation_plan': '\n'.join(contract['acceptance_zh']),
            'notes': 'catalog/content-refresh.v1.json',
            'position_x': 440, 'position_y': bottom,
        }, actor=ACTOR, commit=False)
        result = service.create_node({
            'name': names[1], 'type': 'Ranking Table', 'workflow_lane': 'shared',
            'definition': contract['result']['label_zh'] + '；逻辑结构，物理存储及前端读取未绑定。',
            'caveats': contract['limitations_zh'], 'notes': 'catalog/content-refresh.v1.json',
            'position_x': 880, 'position_y': bottom,
        }, actor='system', commit=False)
        for node in (engine, result):
            _fields(service, node, contract['result']['columns'])
        service.db.execute('UPDATE nodes SET is_system_state=1 WHERE id=?', (result['id'],))

        def connect(source, target, columns, note):
            edge = service.create_edge({
                'upstream_id': source['id'], 'downstream_id': target['id'],
                'transport_kind': 'direct',
                'rationale': '已批准设计依赖；不表示运行接通。', 'transformation': note,
            }, actor=ACTOR, commit=False)
            targets = {f['name']: f['id'] for f in service.get_fields(target['id'])}
            for field in service.get_fields(source['id']):
                if field['name'] in columns:
                    service.create_field_usage(edge['id'], {
                        'source_field_id': field['id'], 'target_field_id': targets.get(field['name']),
                        'usage_note': note,
                    }, actor=ACTOR, commit=False)

        for source, columns in sources:
            connect(source, engine, columns, '只读候选选择/身份映射字段；完整记录到来源卡查看。')
        connect(result, engine, [c['name'] for c in contract['result']['columns']
                                if c['name'] not in ('source_refs_json', 'data_as_of', 'generator_version')],
                '读取成功内容是否存在、成功时间、活动任务和重试状态；不代表实际查询。')
        connect(engine, result, [c['name'] for c in contract['result']['columns']],
                '成功原子替换内容与状态；失败仅更新尝试状态，保留成功字段。')
        service.db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))


SPLIT_MARKER = 'content_refresh_design_four_stages_v2'
SPLIT_ACTOR = 'content-refresh-four-stages-v2'


def _ensure_split_content_refresh(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (SPLIT_MARKER,)).fetchone():
        return
    contract = json.loads(CATALOG.read_text())
    engine = service.find_name(contract['legacy_node']['name'])
    result = service.find_name(contract['result']['name'])
    if not engine or not result:
        raise ValueError('Missing legacy content refresh cards; refusing to guess identity')
    if any(service.find_name(stage['name']) for stage in contract['stages']):
        raise ValueError('Split content refresh design conflicts with an existing card')
    external_names = {edge['source'] for edge in contract['connections']} - {
        stage['key'] for stage in contract['stages']}
    external = {name: service.find_name(name) for name in external_names}
    if any(node is None for node in external.values()):
        raise ValueError('Missing split content refresh source card')
    for edge in contract['connections']:
        if edge['source'] in external:
            known = {f['name'] for f in service.get_fields(external[edge['source']]['id'])}
            if not set(edge['fields']).issubset(known):
                raise ValueError('Missing split content refresh source fields')
    # Replace only the eight v1-owned dependencies. Extra user connections survive.
    pairs = {(external[board['table_name']]['id'], engine['id']) for board in contract['boards']}
    pairs |= {(external['asset_identifiers']['id'], engine['id']),
              (result['id'], engine['id']), (engine['id'], result['id'])}
    old_edges = [dict(row) for row in service.db.execute('SELECT * FROM edges')
                 if (row['upstream_id'], row['downstream_id']) in pairs]
    if len(old_edges) != 8 or any(not service.db.execute(
            "SELECT 1 FROM change_events WHERE actor=? AND action='create' AND entity='edge' AND entity_id=?",
            (ACTOR, edge['id'])).fetchone() for edge in old_edges):
        raise ValueError('Legacy dependencies changed or unowned; refusing to replace them')
    with service.db:
        for edge in old_edges:
            for usage in service.get_field_usages(edge['id']):
                service._event(SPLIT_ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
            service.db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
            service._event(SPLIT_ACTOR, 'delete', 'edge', edge['id'], before=edge)
        first = contract['stages'][0]
        service.db.execute('UPDATE nodes SET name=?, definition=?, formula=?, updated_at=? WHERE id=?',
                           (first['name'], first['description_zh'], first['algorithm_zh'], now(), engine['id']))
        service._event(SPLIT_ACTOR, 'update', 'node', engine['id'], before=engine,
                       after=service.get_node(engine['id']))
        # Drop only obsolete v1 declarations with no remaining uses. User fields and
        # fields referenced by other flows or requirements are retained.
        for column in contract['result']['columns']:
            if column['name'] in {f['name'] for f in first['fields']}:
                continue
            field = next((f for f in service.get_fields(engine['id'])
                          if f['name'] == column['name'] and f['definition'] == column['label_zh']
                          and f['data_type'] == column['data_type']), None)
            if field and not service.db.execute(
                    'SELECT 1 FROM edge_field_usages WHERE source_field_id=? OR target_field_id=?',
                    (field['id'], field['id'])).fetchone() and not service.db.execute(
                    'SELECT 1 FROM data_requirements WHERE source_field_id=?', (field['id'],)).fetchone():
                service.db.execute('DELETE FROM node_fields WHERE id=?', (field['id'],))
                service._event(SPLIT_ACTOR, 'delete', 'field', field['id'], before=field)
        nodes = {**external, first['key']: service.get_node(engine['id'])}
        bottom = service.db.execute('SELECT COALESCE(MAX(position_y),0) FROM nodes').fetchone()[0] + 240
        for index, stage in enumerate(contract['stages']):
            if index:
                nodes[stage['key']] = service.create_node({
                    'name': stage['name'], 'type': stage['type'], 'workflow_lane': 'shared',
                    'definition': stage['description_zh'], 'formula': stage['algorithm_zh'],
                    'caveats': contract['limitations_zh'],
                    'validation_plan': '\n'.join(contract['acceptance_zh']),
                    'notes': 'catalog/content-refresh.v1.json',
                    'position_x': engine['position_x'] + 432 * index, 'position_y': bottom,
                }, actor=SPLIT_ACTOR, commit=False)
            _fields(service, nodes[stage['key']], stage['fields'])
        for dependency in contract['connections']:
            source, target = nodes[dependency['source']], nodes[dependency['target']]
            edge = service.create_edge({
                'upstream_id': source['id'], 'downstream_id': target['id'],
                'transport_kind': 'direct', 'rationale': '已批准四阶段设计依赖；不表示运行接通。',
                'transformation': dependency['note_zh'],
            }, actor=SPLIT_ACTOR, commit=False)
            source_fields = {f['name']: f['id'] for f in service.get_fields(source['id'])}
            target_fields = {f['name']: f['id'] for f in service.get_fields(target['id'])}
            for name in dependency['fields']:
                service.create_field_usage(edge['id'], {
                    'source_field_id': source_fields[name], 'target_field_id': target_fields[name],
                    'usage_note': dependency['note_zh'],
                }, actor=SPLIT_ACTOR, commit=False)
        service.db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (SPLIT_MARKER, '1'))


def ensure_content_refresh(service):
    if not service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (SPLIT_MARKER,)).fetchone():
        contract = json.loads(CATALOG.read_text())
        if any(service.find_name(stage['name']) for stage in contract['stages']):
            raise ValueError('Split content refresh design conflicts with an existing card')
    _ensure_legacy_content_refresh(service)
    _ensure_split_content_refresh(service)
