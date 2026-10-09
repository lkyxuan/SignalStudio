"""Install the approved Studio design only; never execute content generation."""
import json
from pathlib import Path

from leaderboard_algorithms import _fields

CATALOG = Path(__file__).resolve().parent.parent / 'catalog/content-refresh.v1.json'
MARKER = 'content_refresh_design_v1'
ACTOR = 'content-refresh-design-v1'


def ensure_content_refresh(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    contract = json.loads(CATALOG.read_text())
    names = [contract['node']['name'], contract['result']['name']]
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
            'definition': contract['node']['description_zh'],
            'formula': contract['node']['algorithm_zh'],
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
