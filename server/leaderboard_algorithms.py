"""Migrate the existing design cards, not a scorer or a deployment."""
import json

from graph_service import now
from leaderboard_scaffolds import CATALOG, ensure_leaderboard_scaffolds

MARKER = 'leaderboard_algorithms_v1'
ACTOR = 'leaderboard-design-v1'


def ensure_leaderboard_algorithms(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    catalog = json.loads(CATALOG.read_text())
    new_items = catalog['data_nodes'] + catalog['preprocessors']
    if any(service.find_name(item['name']) for item in new_items):
        raise ValueError('Leaderboard v1 name conflicts with an existing card')
    # A missing prerequisite or a user-edited scaffold must never be overwritten.
    for board in catalog['boards']:
        for role in ('cache_name', 'calculator_name', 'table_name'):
            node = service.find_name(board[role])
            if node and (('设计骨架' not in node['definition']) or
                         (role == 'calculator_name' and not node['formula'].startswith('独立算法待定义'))):
                raise ValueError('Leaderboard scaffold has a custom design; migration requires review')
    with service.db:
        # Keep fresh installs and upgrades in the same transaction.
        ensure_leaderboard_scaffolds(service, transactional=False)
        bottom = service.db.execute('SELECT COALESCE(MAX(position_y),0) FROM nodes').fetchone()[0] + 300
        datasets = {}
        for index, item in enumerate(new_items):
            is_table = item['type'] == 'Ranking Table'
            node = service.create_node({
                'name': item['name'], 'type': item['type'], 'workflow_lane': 'signal',
                'definition': item.get('description', item.get('algorithm_zh', '')),
                'formula': item.get('algorithm_zh', ''),
                'caveats': 'v1 设计契约；尚无实际采集、标注、计算或部署验证。',
                'notes': 'catalog/leaderboard-scaffolds.v1.json · 2026-10-09-v1',
                'position_x': -850 if is_table else -1300,
                'position_y': bottom + index * 240,
            }, actor='system', commit=False)
            columns = item['columns'] if is_table else next(
                data['columns'] for data in catalog['data_nodes'] if data['key'] == item['output_dataset'])
            _fields(service, node, columns)
            if is_table:
                service.db.execute('UPDATE nodes SET is_system_state=1 WHERE id=?', (node['id'],))
                datasets[item['key']] = node

        def connect(source, target, note, mapping=None):
            edge = service.db.execute('SELECT id FROM edges WHERE upstream_id=? AND downstream_id=?',
                                      (source['id'], target['id'])).fetchone()
            if edge:
                edge_id = edge['id']
            else:
                edge_id = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                    'rationale': 'v1 规划依赖；非已观察的采集或执行。',
                    'transformation': note, 'transport_kind': 'direct'}, actor=ACTOR, commit=False)['id']
            target_fields = {field['name']: field for field in service.get_fields(target['id'])}
            for field in service.get_fields(source['id']):
                if mapping is not None and field['name'] not in mapping:
                    continue
                target_name = mapping.get(field['name']) if mapping else field['name']
                target_field = target_fields.get(target_name)
                target_id = target_field['id'] if target_field else None
                if service.db.execute('SELECT 1 FROM edge_field_usages WHERE edge_id=? AND source_field_id=? AND target_field_id IS ?',
                                      (edge_id, field['id'], target_id)).fetchone():
                    continue
                service.create_field_usage(edge_id, {'source_field_id': field['id'],
                    'target_field_id': target_id, 'usage_note': note}, actor=ACTOR, commit=False)

        source_fields = {
            'rss.item': {'guid': 'source_record_id', 'link': 'url', 'title': 'text', 'description': 'text', 'pubDate': 'published_at', 'source': 'publisher_id'},
            'telegram.bot.message': {'message_id': 'source_record_id', 'date': 'published_at', 'chat.id': 'publisher_id', 'from.id': 'author_id', 'text': 'text', 'caption': 'text'},
            'telegram.telethon.message': {'id': 'source_record_id', 'date': 'published_at', 'peer_id': 'publisher_id', 'from_id': 'author_id', 'message': 'text', 'fwd_from': 'canonical_story_id'},
            'assets': {'asset_id': 'asset_id', 'name': 'asset_name'},
            'asset_identifiers': {'source_namespace': 'source_id', 'external_identifier': None, 'asset_id': 'asset_id'},
        }
        for item in catalog['preprocessors']:
            node = service.find_name(item['name'])
            for name in item['sources']:
                source = service.find_name(name)
                if source:
                    connect(source, node, item['algorithm_zh'], source_fields.get(name))
                # Missing optional upstreams remain explicit requirements, never fake source nodes.
                else:
                    raise ValueError(f'Missing leaderboard input card: {name}')
            connect(node, datasets[item['output_dataset']], '保存生成字段；原文、时间及身份由本步骤校验，不表示已写入。')

        for board in catalog['boards']:
            cache, calc, table = [service.find_name(board[role]) for role in ('cache_name', 'calculator_name', 'table_name')]
            for node, columns in ((cache, board['cache_schema']), (calc, catalog['columns']), (table, catalog['columns'])):
                _fields(service, node, columns)
                before = service.get_node(node['id'])
                definition = f"{board['label_zh']}榜 v1 · {board['algorithm']['description_zh']}（设计已定义，真实数据待验证）"
                formula = board['algorithm']['formula'] if node['id'] == calc['id'] else ''
                service.db.execute('UPDATE nodes SET definition=?,formula=?,caveats=?,validation_plan=?,updated_at=? WHERE id=?',
                    (definition, formula, catalog['common']['quality_zh'], board['validation_zh'], now(), node['id']))
                service._event(ACTOR, 'update', 'node', node['id'], before, service.get_node(node['id']))
            for key in board['input_datasets']:
                source = datasets[key]
                connect(source, cache, '将本数据集完整记录装入版本化缓存；coverage不足标unavailable，不补零。',
                        {field['name']: key + '_records_json' for field in service.get_fields(source['id'])})
            connect(cache, calc, '读取本榜完整数据和质量状态，在一个UTC截止时间推导摘要与分数。')
            connect(calc, table, catalog['common']['result_rule_zh'])
        service.db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))


def _fields(service, node, columns):
    original_state = node['is_system_state']
    service.db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?', (node['id'],))
    existing = {field['name'] for field in service.get_fields(node['id'])}
    for column in columns:
        if column['name'] not in existing:
            service.create_field(node['id'], {'name': column['name'], 'data_type': column['data_type'],
                'definition': column['label_zh']}, actor=ACTOR, commit=False)
    service.db.execute('UPDATE nodes SET is_system_state=? WHERE id=?', (original_state, node['id']))
