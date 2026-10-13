"""SS-84 Studio migration. Installs definitions only; never reads business assets."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/new-uuid-board.v1.json'
MARKER = 'new_uuid_board_v1'
ACTOR = 'ss84-new-uuid-board'
SNAPSHOTS = {
    'catalog/content-refresh.v1.json': 'content-refresh-20261010.json',
    'catalog/homepage-layout.v1.json': 'homepage-ss81.json',
    'catalog/market-current.v1.json': 'market-ss80.json',
}


def load(path):
    return json.loads((ROOT / path).read_text())


def ref(path, key):
    return {'path': path, 'revision': hashlib.sha256((ROOT / path).read_bytes()).hexdigest(),
            'selector': {'key': key}}


def ensure_new_uuid_board(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='homepage_interface_v1'").fetchone():
        return
    spec = load(PATH)
    refresh = load('catalog/content-refresh.v1.json')
    homepage = load('catalog/homepage-layout.v1.json')
    previous = load('server/migration_snapshots/market-ss80.json')
    expected = next(n for n in previous['nodes'] if n['key'] == 'candidates')
    model = CardModel(service)
    candidate = service.find_name('候选代币筛选')
    ui = service.find_name(homepage['interface']['name'])
    if not candidate or not ui or any(not service.find_name(name) for name in
            ('assets', 'asset_identifiers', 'leaderboard_warming', 'leaderboard_hottest')):
        raise ValueError('New UUID board: missing prerequisite')
    if candidate['definition'] != expected['description'] or candidate['formula'] != expected['algorithm']:
        raise ValueError('New UUID board: edited candidate definition')
    if any(service.find_name(name) for name in (spec['calculator_name'], spec['table_name'])):
        raise ValueError('New UUID board: name conflict')
    old_ui = load('server/migration_snapshots/homepage-ss81.json')['interface']
    if model.contract(ui['id'])['config']['interface'] != old_ui:
        raise ValueError('New UUID board: edited homepage definition')
    for node in (candidate, ui):
        cfg = model.contract(node['id'])['config']
        if cfg.get('read_only') or cfg['action']['implementation'] not in ('unknown', 'planned'):
            raise ValueError('New UUID board: protected contract')
    revisions = {path: {hashlib.sha256((ROOT / 'server/migration_snapshots' / old).read_bytes()).hexdigest(),
                        hashlib.sha256((ROOT / path).read_bytes()).hexdigest()}
                 for path, old in SNAPSHOTS.items()}

    def rewrite(value):
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if not isinstance(value, dict):
            return value
        result = {k: rewrite(v) for k, v in value.items()}
        if value.get('path') in revisions:
            if value.get('revision') not in revisions[value['path']]:
                raise ValueError('New UUID board: unrecognized definition revision ' + value['path'])
            result['revision'] = hashlib.sha256((ROOT / value['path']).read_bytes()).hexdigest()
        return result

    def fields(node, columns):
        existing = {f['name']: f for f in service.get_fields(node['id'])}
        original_state = node['is_system_state']
        if original_state:
            db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?', (node['id'],))
        for col in columns:
            if col['name'] not in existing:
                service.create_field(node['id'], {'name': col['name'], 'data_type': col['data_type'],
                    'definition': col['label_zh']}, actor=ACTOR, commit=False)
                existing[col['name']] = True
        if original_state:
            db.execute('UPDATE nodes SET is_system_state=? WHERE id=?', (original_state, node['id']))

    def configure(node, path, key, resource=None):
        cfg = copy.deepcopy(model.contract(node['id'])['config'])
        cfg['definition_refs'] = [ref(path, key)]
        if resource:
            cfg['resource'].update(resource)
        model.validate_config(cfg, model.contract(node['id'])['kind'])
        db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))

    def connect(source, target, names=(), reference=False):
        edge = db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?',
                          (source['id'], target['id'])).fetchone()
        if edge:
            # Existing board field mappings and user connections stay intact.
            return
        edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
            'rationale': 'SS-84已批准设计依赖；非运行证明。',
            'transformation': '按首次建档时间选择；无发现奖励。' if not reference else '首页来源引用，不触发执行。'},
            actor=ACTOR, commit=False)
        if reference:
            db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            model.add_binding(edge, {'kind': 'reference', 'branch': '',
                'source_port_id': stable(source['id'], 'output', 'out'),
                'target_port_id': stable(target['id'], 'input', 'in'),
                'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [], 'role': 'homepage_source_definition'}})
        else:
            sf = {f['name']: f['id'] for f in service.get_fields(source['id'])}
            tf = {f['name']: f['id'] for f in service.get_fields(target['id'])}
            for name in names:
                service.create_field_usage(edge['id'], {'source_field_id': sf[name],
                    'target_field_id': tf.get(name), 'usage_note': '只读本步骤需要的字段；实际来源读取待绑定。'},
                    actor=ACTOR, commit=False)

    db.execute('BEGIN IMMEDIATE')
    try:
        # Materialize already-declared asset columns, not business rows or new runtime fields.
        assets = service.find_name('assets')
        asset_cols = load('catalog/business-tables.v1.json')['tables']['assets']['columns']
        fields(assets, [{'name': c['name'], 'data_type': c['type'], 'label_zh': c['label_zh']} for c in asset_cols])
        x, y = candidate['position_x'] - 840, candidate['position_y'] + 720
        occupied = [(r['position_x'], r['position_y']) for r in db.execute('SELECT * FROM nodes')]
        while any(abs(x - px) < 800 and abs(y - py) < 220 for px, py in occupied):
            y += 240
        process = service.create_node({'name': spec['calculator_name'], 'kind': 'process', 'workflow_lane': 'shared',
            'definition': '从统一建档对象中选出最新UUID；不要求项目本身刚上线。',
            'formula': '\n'.join(spec['requirements_zh']), 'caveats': spec['limitations_zh'],
            'notes': PATH, 'position_x': x, 'position_y': y}, actor=ACTOR, commit=False)
        table = service.create_node({'name': spec['table_name'], 'kind': 'table', 'workflow_lane': 'shared',
            'definition': '新发现UUID结果；按首次建档时间倒序，不是项目上线时间。',
            'caveats': spec['limitations_zh'], 'notes': PATH, 'position_x': x + 420, 'position_y': y},
            actor=ACTOR, commit=False)
        inputs = [{'name': c['name'], 'data_type': c['type'], 'label_zh': c['label_zh']} for c in asset_cols]
        fields(process, inputs + spec['columns'])
        fields(table, spec['columns'])
        configure(process, PATH, 'calculator', {'delivery': 'studio_design_only', 'bindings': spec['bindings']})
        configure(table, PATH, 'result', {'primary_key': ['asset_id'], 'observed_rows': [], 'delivery': 'studio_design_only'})
        connect(assets, process, [c['name'] for c in asset_cols])
        connect(process, table, [c['name'] for c in spec['columns']])
        stage = refresh['stages'][0]
        fields(candidate, stage['fields'])
        db.execute('UPDATE nodes SET definition=?,formula=?,trigger_rule=?,caveats=?,updated_at=? WHERE id=?',
            (stage['description_zh'], stage['algorithm_zh'], stage['trigger_zh'], spec['limitations_zh'], now(), candidate['id']))
        configure(candidate, 'catalog/content-refresh.v1.json', 'candidates',
            {'candidate_boards': [b['table_name'] for b in refresh['boards']], 'content_asset_kinds': ['coin']})
        connect(table, candidate, next(b['consumed_fields'] for b in refresh['boards'] if b['key'] == 'new_uuid'))
        # No retired or legacy board may continue feeding this stage.
        for edge in db.execute('SELECT e.*,n.name AS source_name FROM edges e JOIN nodes n ON n.id=e.upstream_id WHERE e.downstream_id=?', (candidate['id'],)).fetchall():
            if edge['source_name'] in {'asset_scores_current', 'leaderboard_cooling', 'leaderboard_divergence', 'leaderboard_emerging'}:
                service._event(ACTOR, 'delete', 'edge', edge['id'], before=dict(edge))
                db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
        cfg = copy.deepcopy(model.contract(ui['id'])['config'])
        cfg['interface'] = homepage['interface']
        cfg['definition_refs'] = [ref('catalog/homepage-layout.v1.json', homepage['interface']['key'])]
        model.validate_config(cfg, 'interface')
        db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), ui['id']))
        db.execute('UPDATE nodes SET caveats=?,updated_at=? WHERE id=?',
            ('六框结构：升温、最热、新发现及三类待分组信号；业务页面/API未接入。', now(), ui['id']))
        connect(table, ui, reference=True)
        for row in db.execute('SELECT node_id,kind,config FROM node_contracts').fetchall():
            before = json.loads(row['config'])
            after = rewrite(before)
            if after != before:
                if before.get('read_only'):
                    raise ValueError('New UUID board: protected definition reference')
                model.validate_config(after, row['kind'])
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(after), row['node_id']))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('New UUID board: invalid graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'new_nodes': [process['id'], table['id']]})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, spec['revision']))
        db.commit()
    except Exception:
        db.rollback()
        raise
