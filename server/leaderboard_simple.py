"""Install four small design contracts; preserve the existing total_heat flow."""
import json
from pathlib import Path
from graph_service import now
from leaderboard_algorithms import ensure_leaderboard_algorithms, _fields

CATALOG = Path(__file__).resolve().parent.parent / 'catalog/leaderboard-simple.v1.json'
MARKER = 'leaderboard_simple_v1'
ACTOR = 'leaderboard-simple-v1'


def ensure_leaderboard_simple(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    ensure_leaderboard_algorithms(service)
    catalog = json.loads(CATALOG.read_text())
    old = json.loads((CATALOG.parent / 'leaderboard-scaffolds.v1.json').read_text())
    history = catalog['history']
    if any(service.find_name(name) for name in (history['name'], history['processor_name'])):
        raise ValueError('Simple leaderboard history name conflict')
    # Do not overwrite edits made since the previous design was installed.
    for board in catalog['boards']:
        previous = next(b for b in old['boards'] if b['key'] == board['key'])
        for role in ('cache_name', 'calculator_name', 'table_name'):
            node = service.find_name(board[role])
            expected = f"{previous['label_zh']}榜 v1 · {previous['algorithm']['description_zh']}（设计已定义，真实数据待验证）"
            if node['definition'] != expected or (role == 'calculator_name' and
                    node['formula'] != previous['algorithm']['formula']):
                raise ValueError('Simple leaderboard migration conflicts with an edited design')
    with service.db:
        bottom = service.db.execute('SELECT MAX(position_y) FROM nodes').fetchone()[0] + 300
        for name, kind, x in ((history['processor_name'], 'Metric', -440),
                              (history['name'], 'Ranking Table', 0)):
            node = service.create_node({'name': name, 'type': kind, 'workflow_lane': 'signal',
                'definition': history['description'],
                'formula': history['description'] if kind == 'Metric' else '',
                'caveats': catalog['limitations_zh'], 'notes': str(CATALOG.relative_to(CATALOG.parent.parent)),
                'position_x': x, 'position_y': bottom}, actor='system', commit=False)
            _fields(service, node, history['columns'])
            if kind == 'Ranking Table':
                service.db.execute('UPDATE nodes SET is_system_state=1 WHERE id=?', (node['id'],))

        def connect(source_name, target_name, names=None):
            source, target = service.find_name(source_name), service.find_name(target_name)
            if source is None or target is None:
                raise ValueError(f'Missing simple leaderboard input: {source_name}')
            edge = service.db.execute('SELECT id FROM edges WHERE upstream_id=? AND downstream_id=?',
                                      (source['id'], target['id'])).fetchone()
            edge_id = edge['id'] if edge else service.create_edge({
                'upstream_id': source['id'], 'downstream_id': target['id'],
                'transport_kind': 'direct', 'rationale': '四榜简版设计依赖，尚无执行验证。'},
                actor=ACTOR, commit=False)['id']
            targets = {f['name']: f['id'] for f in service.get_fields(target['id'])}
            for field in service.get_fields(source['id']):
                if names is not None and field['name'] not in names:
                    continue
                target_id = targets.get(field['name'])
                if not service.db.execute('SELECT 1 FROM edge_field_usages WHERE edge_id=? AND source_field_id=? AND target_field_id IS ?',
                                          (edge_id, field['id'], target_id)).fetchone():
                    service.create_field_usage(edge_id, {'source_field_id': field['id'],
                        'target_field_id': target_id, 'usage_note': '简版消费字段；数据缺失不补零。'},
                        actor=ACTOR, commit=False)

        connect('asset_scores_current', history['processor_name'])
        connect(history['processor_name'], history['name'])
        for board in catalog['boards']:
            previous = next(b for b in old['boards'] if b['key'] == board['key'])
            cache = service.find_name(board['cache_name'])
            # Remove only known old design dependencies, leaving other work intact.
            for key in previous['input_datasets']:
                source = service.find_name('leaderboard_' + key)
                edge = service.db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?',
                                          (source['id'], cache['id'])).fetchone()
                if edge:
                    service._event(ACTOR, 'delete', 'edge', edge['id'], dict(edge), None)
                    service.db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
            for role in ('cache_name', 'calculator_name', 'table_name'):
                node = service.find_name(board[role])
                before = service.get_node(node['id'])
                columns = board['input_schema'] if role == 'cache_name' else catalog['columns']
                old_columns = previous['cache_schema'] if role == 'cache_name' else old['columns']
                obsolete = {f['name'] for f in old_columns} - {f['name'] for f in columns}
                for name in obsolete:
                    field = service.db.execute('SELECT * FROM node_fields WHERE node_id=? AND name=?',
                                               (node['id'], name)).fetchone()
                    if field:
                        service._event(ACTOR, 'delete', 'field', field['id'], dict(field), None)
                        service.db.execute('DELETE FROM node_fields WHERE id=?', (field['id'],))
                _fields(service, node, columns)
                service.db.execute('UPDATE nodes SET definition=?,formula=?,caveats=?,notes=?,validation_plan=?,updated_at=? WHERE id=?',
                    (board['label_zh'] + '榜简版 · ' + board['description'],
                     board['formula'] if role == 'calculator_name' else '',
                     catalog['limitations_zh'], 'catalog/leaderboard-simple.v1.json',
                     board['eligibility'], now(), node['id']))
                service._event(ACTOR, 'update', 'node', node['id'], before, service.get_node(node['id']))
            for name in board['sources']:
                fields = {'assets': ['asset_id', 'name', 'created_at'],
                          'leaderboard_opinions': ['asset_id', 'asset_name', 'author_id', 'stance',
                              'topic_key', 'horizon', 'published_at', 'available_at', 'evidence_id', 'reason']}.get(name)
                connect(name, board['cache_name'], fields)
            connect(board['cache_name'], board['calculator_name'])
            connect(board['calculator_name'], board['table_name'])
        service.db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))
