"""SS-95 guarded Studio migration. No business data or background tasks."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/coingecko-hottest.v1.json'
MARKER = 'coingecko_hottest_z_v1'
ACTOR = 'ss95-hottest-z'


def definition_ref(key):
    return {'path': PATH, 'revision': hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest(), 'selector': {'key': key}}


def ensure_coingecko_hottest(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='new_uuid_board_v1'").fetchone():
        raise ValueError('Hottest Z: requires SS-84')
    spec = json.loads((ROOT / PATH).read_text())
    expected = json.loads((ROOT / 'server/migration_snapshots/hottest-before-ss95.json').read_text())
    model = CardModel(service)
    managed = {name: service.find_name(name) for name in expected}
    if not all(managed.values()):
        raise ValueError('Hottest Z: missing existing card')
    for name, node in managed.items():
        old = expected[name]
        if (node['definition'], node['formula']) != (old['definition'], old['formula']):
            raise ValueError('Hottest Z: edited definition ' + name)
        fields = {f['name']: f for f in service.get_fields(node['id'])}
        for f in old['fields']:
            if f['name'] not in fields or any(fields[f['name']][k] != f[k] for k in ('data_type', 'definition')):
                raise ValueError('Hottest Z: edited field ' + name + '/' + f['name'])
    for row in db.execute('SELECT node_id,config FROM node_contracts'):
        cfg = json.loads(row['config'])
        # Only guard references of affected cards/consumers, not unrelated old drafts.
        if row['node_id'] not in {n['id'] for n in managed.values()} and 'metric_version' not in cfg.get('resource', {}):
            continue
        if cfg.get('read_only') or cfg['action']['implementation'] not in ('unknown', 'planned'):
            raise ValueError('Hottest Z: protected contract')
        for ref in cfg.get('definition_refs', []):
            path = ROOT / ref['path']
            if not path.is_file() or ref.get('revision') != hashlib.sha256(path.read_bytes()).hexdigest():
                raise ValueError('Hottest Z: unknown definition revision ' + ref['path'])
    cards = {c['key']: c for c in spec['cards']}
    for key in ('baseline', 'rvol', 'candidates'):
        if service.find_name(cards[key]['name']):
            raise ValueError('Hottest Z: new card name conflict')
    nodes = {'parent': managed['Polars · 计算 CoinGecko 量价指标'],
             'assembly': managed['Polars · 汇总指标并发布'], 'channel': managed['Few Understand · indicator.data'],
             'rank': managed[cards['rank']['name']], 'result': managed[cards['result']['name']],
             'history': service.find_name('coingecko_market_history'), 'coverage': service.find_name('leaderboard_coverage')}
    if not nodes['history'] or not nodes['coverage']:
        raise ValueError('Hottest Z: missing archive/coverage')
    # Existing calculator inputs are producer-owned and must not hide user edits.
    incoming = list(db.execute('SELECT e.*,n.name AS source_name FROM edges e JOIN nodes n ON n.id=e.upstream_id WHERE e.downstream_id=?', (nodes['rank']['id'],)))
    if {e['source_name'] for e in incoming} != {'Few Understand · indicator.data', 'market_scores_current', 'leaderboard_coverage', '量价评分 · 汇总Redis记分'}:
        raise ValueError('Hottest Z: changed calculator dependencies')
    old_rank = json.loads((ROOT / 'catalog/market-current.v1.json').read_text())
    old_rank = next(n for n in old_rank['nodes'] if n['key'] == 'hottest_calc')
    old_names = {c['name'] for c in old_rank['columns']}
    for edge in incoming:
        for usage in service.get_field_usages(edge['id']):
            if usage['target_field_id']:
                f = db.execute('SELECT name FROM node_fields WHERE id=?', (usage['target_field_id'],)).fetchone()
                if not f or f['name'] not in old_names:
                    raise ValueError('Hottest Z: edited calculator mapping')

    def add_fields(node, columns):
        known = {f['name']: f for f in service.get_fields(node['id'])}
        is_state = service.get_node(node['id'])['is_system_state']
        if is_state:
            db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?', (node['id'],))
        for col in columns:
            if col['name'] not in known:
                service.create_field(node['id'], {'name': col['name'], 'data_type': col['data_type'],
                    'definition': col['label_zh']}, actor=ACTOR, commit=False)
        if is_state:
            db.execute('UPDATE nodes SET is_system_state=? WHERE id=?', (is_state, node['id']))

    def save(node, cfg):
        if model.contract(node['id'])['config'].get('read_only'):
            raise ValueError('Hottest Z: protected consumer')
        model.validate_config(cfg, model.contract(node['id'])['kind'])
        db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?', (encoded(cfg), node['id']))

    def configure(key):
        node, entry = nodes[key], cards[key]
        cfg = copy.deepcopy(model.contract(node['id'])['config'])
        cfg['definition_refs'] = [definition_ref(key)]
        cfg['resource'].update(hottest_key=key, delivery='studio_design_only', physical_binding=None,
            observed_rows=[], algorithm_version=spec['version'])
        cfg['resource'].pop('indicator_dependency', None)
        cfg['action'] = {'id': 'hottest.' + key if entry['kind'] == 'process' else '', 'version': 1, 'implementation': 'planned'}
        cfg['trigger'] = spec['trigger'] if key == 'rank' else {'kind': 'unspecified'}
        if key in ('baseline', 'rvol'):
            cfg['resource'].update(parent_module={'node_id': nodes['parent']['id'], 'reference_number': nodes['parent']['reference_number']},
                nullable_identity_context=True, execution_scope='shared_polars_program')
        if key == 'candidates':
            cfg['resource'].update(owner_node_id=nodes['rank']['id'], input_topic='indicator.data',
                primary_key=['source_id', 'source_object_id'], rebuild_from='archived v2 metrics; binding unverified',
                retention='Unbound; latest state plus durable frozen batch recovery references required')
        save(node, cfg)
        before = service.get_node(node['id'])
        db.execute('UPDATE nodes SET definition=?,formula=?,trigger_rule=?,caveats=?,updated_at=? WHERE id=?',
            (entry['description_zh'], entry['algorithm_zh'], entry['trigger_zh'], spec['limitations_zh'], now(), node['id']))
        service._event(ACTOR, 'update', 'node', node['id'], before=before, after=service.get_node(node['id']))

    def connect(source, target, names, kind, role):
        existing = db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?', (source['id'], target['id'])).fetchone()
        edge = dict(existing) if existing else service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
            'transport_kind': 'direct', 'rationale': 'SS-95已批准数据依赖；不是运行证据。',
            'bindings': [{'kind':kind, 'branch':'', 'source_port_id':stable(source['id'],'output','out'),
                'target_port_id':stable(target['id'],'input','in'), 'config':{'trigger':'none','completion':'success','unresolved':[],'role':role}}]}, actor=ACTOR, commit=False)
        if not existing:
            db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            model.add_binding(edge, {'kind': kind, 'branch': '', 'source_port_id': stable(source['id'], 'output', 'out'),
                'target_port_id': stable(target['id'], 'input', 'in'), 'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [], 'role': role}})
        sf = {f['name']: f['id'] for f in service.get_fields(source['id'])}
        tf = {f['name']: f['id'] for f in service.get_fields(target['id'])}
        used = {(u['source_field_id'], u['target_field_id']) for u in service.get_field_usages(edge['id'])}
        for name in names:
            if name not in sf:
                raise ValueError('Hottest Z: missing producer field ' + name)
            pair = (sf[name], tf.get(name))
            if pair not in used:
                service.create_field_usage(edge['id'], {'source_field_id': pair[0], 'target_field_id': pair[1],
                    'usage_note': 'SS-95按同一观测传递；跨币统计仅在冻结批次内执行。'}, actor=ACTOR, commit=False)

    db.execute('BEGIN IMMEDIATE')
    try:
        for edge in incoming:
            service._event(ACTOR, 'delete', 'edge', edge['id'], before=dict(edge))
            db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
        # Retire only old managed result/calculator fields, refusing unknown external dependencies.
        for key in ('rank', 'result'):
            node = nodes[key]
            desired = {c['name'] for c in cards[key]['fields']}
            managed_fields = {c['name'] for c in expected[node['name']]['fields']}
            for f in service.get_fields(node['id']):
                if f['name'] in managed_fields - desired:
                    usages = list(db.execute('SELECT u.*,e.upstream_id,e.downstream_id FROM edge_field_usages u JOIN edges e ON e.id=u.edge_id WHERE u.source_field_id=? OR u.target_field_id=?', (f['id'], f['id'])))
                    if any(not ((u['upstream_id'] == nodes['rank']['id'] and u['downstream_id'] == nodes['result']['id']) or (key == 'result' and f['name'] in ('activity_score', 'score_event_refs_json') and u['downstream_id'] == service.find_name('候选代币筛选')['id'])) for u in usages):
                        raise ValueError('Hottest Z: external dependency on retired field ' + f['name'])
                    db.execute('DELETE FROM edge_field_usages WHERE source_field_id=? OR target_field_id=?', (f['id'], f['id']))
                    db.execute('DELETE FROM node_fields WHERE id=?', (f['id'],))
            add_fields(node, cards[key]['fields'])
        x = nodes['parent']['position_x']
        y = max(r[0] for r in db.execute('SELECT position_y FROM nodes')) + 360
        for key, dx, dy in [('baseline', 0, 0), ('rvol', 420, 0), ('candidates', 840, 280)]:
            entry = cards[key]
            nodes[key] = service.create_node({'name': entry['name'], 'kind': entry['kind'], 'workflow_lane': 'shared',
                'position_x': x+dx, 'position_y': y+dy}, actor=ACTOR, commit=False)
            add_fields(nodes[key], entry['fields'])
        for key in cards:
            configure(key)
        for key in ('parent', 'assembly', 'channel'):
            node = nodes[key]
            add_fields(node, spec['metric_fields'])
            cfg = copy.deepcopy(model.contract(node['id'])['config'])
            cfg['definition_refs'].append(definition_ref(key))
            cfg['resource'].update(metric_version='market_indicators_v2', metric_compatibility=spec['metric_compatibility'],
                hottest_metric_extension=definition_ref(key))
            if cfg['action']['id']:
                cfg['action']['version'] = 2
            if key == 'parent':
                for child_key, field in [('baseline', 'baseline_mean_volume_7d'), ('rvol', 'rvol_7d')]:
                    child = nodes[child_key]
                    descriptor = {'key': child_key, 'node_id': child['id'], 'reference_number': child['reference_number'], 'output_field': field}
                    cfg['resource']['module_children'].append(descriptor)
                    for f in cards[child_key]['output_fields']:
                        cfg['resource']['field_producers'][f] = descriptor
            if key == 'channel':
                cfg['resource'].setdefault('consumers', {})[cards['rank']['name']] = 'signalstudio.coingecko_hottest_v1'
                cfg['resource']['field_consumers'] = [r for r in cfg['resource'].get('field_consumers', []) if r['key'] != 'hottest_calc']
            save(node, cfg)
            db.execute('UPDATE nodes SET formula=formula||?,updated_at=? WHERE id=?',
                (' SS-95：新增7日基线/RVOL，明确发布market_indicators_v2；旧分项含义不变，消费者按版本显式适配，不改写v1冻结消息。', now(), node['id']))
        # Explicit old-reader compatibility metadata, without changing thresholds or score events.
        consumers = list(db.execute('SELECT n.id,c.config FROM nodes n JOIN node_contracts c ON c.node_id=n.id WHERE n.id IN (SELECT downstream_id FROM edges WHERE upstream_id=?)', (nodes['channel']['id'],)))
        for row in consumers:
            cfg = json.loads(row['config'])
            cfg['resource'].update(accepted_metric_versions=['market_indicators_v1', 'market_indicators_v2'],
                v2_adapter='Project legacy fields with unchanged values/IDs; never award RVOL as an extra contribution.')
            cfg['definition_refs'].append(definition_ref('legacy_compatibility'))
            save({'id': row['id']}, cfg)
        shared = ['observation_id', 'asset_id', 'identity_status', 'source_id', 'source_object_id', 'quote_currency', 'coverage_key',
                  'requested_at', 'collected_at', 'observed_at', 'quality_status', 'total_volume']
        for key in ('baseline', 'rvol'):
            connect(nodes['parent'], nodes[key], shared, 'data', 'module_shared_input')
            connect(nodes[key], nodes['assembly'], cards[key]['output_fields'] + ['observation_id', 'asset_id'], 'data', 'module_result')
        connect(nodes['history'], nodes['baseline'], shared, 'read', 'module_history_input')
        connect(nodes['baseline'], nodes['rvol'], cards['baseline']['output_fields'] + ['observation_id', 'asset_id'], 'data', 'module_result')
        connect(nodes['assembly'], nodes['channel'], [c['name'] for c in spec['metric_fields']], 'publish', 'module_publication')
        # A channel/state relation documents the intended stream; the owning program is explicit.
        connect(nodes['channel'], nodes['candidates'], [c['name'] for c in cards['candidates']['fields']], 'reference', 'candidate_state_input')
        connect(nodes['candidates'], nodes['rank'], [c['name'] for c in cards['candidates']['fields']], 'read', 'frozen_candidate_batch')
        connect(nodes['coverage'], nodes['rank'], ['coverage_key', 'status', 'record_count', 'requested_at', 'completed_at', 'run_id'], 'read', 'batch_coverage')
        connect(nodes['rank'], nodes['result'], [c['name'] for c in cards['result']['fields']], 'write', 'atomic_board_snapshot')
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Hottest Z: invalid graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'new_nodes': [nodes[k]['id'] for k in ('baseline', 'rvol', 'candidates')]})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, spec['version']))
        db.commit()
    except Exception:
        db.rollback()
        raise
