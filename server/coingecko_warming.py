"""SS-102 atomic, guarded Studio design migration. No Few runtime writes."""
import copy
import hashlib
import json
from pathlib import Path
from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/coingecko-warming.v1.json'
MARKER = 'coingecko_warming_growth_ss102_v1'
ACTOR = 'ss102-warming-growth'


def ensure_coingecko_warming(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='hottest_rvol_warmup_ss101_v1'").fetchone():
        return
    spec = json.loads((ROOT / 'server/migration_snapshots/warming-before-v3.json').read_text())['spec']
    previous = json.loads((ROOT / 'server/migration_snapshots/warming-before-ss102.json').read_text())
    cards = {c['key']: c for c in spec['cards']}
    model = CardModel(service)
    nodes = {k: service.find_name(c['name']) for k, c in cards.items() if k in ('rank', 'result')}
    nodes.update(history=service.find_name('coingecko_market_history'), channel=service.find_name('Few Understand · indicator.data'),
                 coverage=service.find_name('leaderboard_coverage'))
    if not all(nodes.values()):
        raise ValueError('SS-102 missing existing card')
    if any(service.find_name(cards[k]['name']) for k in ('baseline', 'candidates')):
        raise ValueError('SS-102 new card name conflict')
    for k in ('rank', 'result'):
        node, old = nodes[k], previous[nodes[k]['name']]
        if (node['definition'], node['formula']) != (old['definition'], old['formula']):
            raise ValueError('SS-102 edited definition ' + k)
        cfg = model.contract(node['id'])['config']
        if cfg.get('read_only') or cfg['action']['implementation'] not in ('unknown', 'planned'):
            raise ValueError('SS-102 protected contract ' + k)
        if cfg['resource'].get('design_key') != ('warming_calc' if k == 'rank' else 'warming_table'):
            raise ValueError('SS-102 unknown warming contract')
        for ref in cfg.get('definition_refs', []):
            f = ROOT / ref['path']
            if not f.is_file() or ref.get('revision') != hashlib.sha256(f.read_bytes()).hexdigest():
                raise ValueError('SS-102 unknown definition revision')
        known = {f['name']: f for f in service.get_fields(node['id'])}
        for f in old['fields']:
            if f['name'] not in known or any(known[f['name']][key] != f[key] for key in ('data_type', 'definition')):
                raise ValueError('SS-102 edited field ' + k + '/' + f['name'])
    incoming = list(db.execute('SELECT e.*,n.name AS source_name FROM edges e JOIN nodes n ON n.id=e.upstream_id WHERE e.downstream_id=?', (nodes['rank']['id'],)))
    if {e['source_name'] for e in incoming} != {'Few Understand · indicator.data', 'leaderboard_coverage', 'market_score_history', 'market_scores_current', '量价评分 · 汇总Redis记分'}:
        raise ValueError('SS-102 edited rank dependencies')
    if {r[0] for r in db.execute('SELECT downstream_id FROM edges WHERE upstream_id=?', (nodes['rank']['id'],))} != {nodes['result']['id']}:
        raise ValueError('SS-102 edited rank destinations')
    mappings = [list(r) for r in db.execute('SELECT sn.name,dn.name,sf.name,tf.name FROM edge_field_usages u '
        'JOIN edges e ON e.id=u.edge_id JOIN nodes sn ON sn.id=e.upstream_id JOIN nodes dn ON dn.id=e.downstream_id '
        'JOIN node_fields sf ON sf.id=u.source_field_id LEFT JOIN node_fields tf ON tf.id=u.target_field_id '
        'WHERE e.upstream_id IN (?,?) OR e.downstream_id=? ORDER BY sn.name,dn.name,sf.name,tf.name',
        (nodes['rank']['id'], nodes['result']['id'], nodes['rank']['id']))]
    # Fresh historical installations still have the ten known rollup mappings;
    # the current shared graph has already removed those dead references.
    legacy_mappings = sorted(previous['_mappings'] + previous['_legacy_rollup_mappings'], key=lambda r: tuple(v or '' for v in r))
    if mappings not in (previous['_mappings'], legacy_mappings):
        raise ValueError('SS-102 edited warming mappings or external dependency')
    for edge in incoming:
        names = {f['name'] for f in previous[nodes['rank']['name']]['fields']}
        for usage in service.get_field_usages(edge['id']):
            if usage['target_field_id']:
                f = db.execute('SELECT name FROM node_fields WHERE id=?', (usage['target_field_id'],)).fetchone()
                if not f or f['name'] not in names:
                    raise ValueError('SS-102 edited rank mapping')

    def fields(node, columns):
        known = {f['name']: f for f in service.get_fields(node['id'])}
        state = service.get_node(node['id'])['is_system_state']
        if state:
            db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?', (node['id'],))
        for col in columns:
            if col['name'] in known:
                db.execute('UPDATE node_fields SET data_type=?,definition=? WHERE id=?', (col['data_type'], col['label_zh'], known[col['name']]['id']))
            else:
                service.create_field(node['id'], {'name': col['name'], 'data_type': col['data_type'], 'definition': col['label_zh']}, actor=ACTOR, commit=False)
        if state:
            db.execute('UPDATE nodes SET is_system_state=? WHERE id=?', (state, node['id']))

    def configure(key):
        n, entry = nodes[key], cards[key]
        cfg = copy.deepcopy(model.contract(n['id'])['config'])
        cfg['definition_refs'] = [{'path': PATH, 'revision': json.loads((ROOT / 'server/migration_snapshots/warming-before-v3.json').read_text())['digest'], 'selector': {'key': key}}]
        cfg['resource'] = {'warming_key': key, 'delivery': 'studio_design_only', 'observed_rows': [], 'physical_binding': None,
                           'algorithm_version': spec['version'], 'primary_key': ['asset_id'], 'hottest_overlap': True,
                           'owner_node_id': nodes['rank']['id'], 'accepted_metric_versions': [spec['metric_version']]}
        if key == 'baseline':
            cfg['resource'].update(execution_scope='inside_warming_program', daily_cache_key=['source_id', 'source_object_id', 'quote_currency', 'coverage_key', 'warming_baseline_at', 'algorithm_version'],
                                   freeze_missing_results=True, recovery='Durable first daily result and seven references; binding unverified')
        if key == 'candidates':
            cfg['resource'].update(input_topic='indicator.data', retention='Latest observations plus frozen round references; physical TTL unverified',
                                   recovery='Archived v2 observations and round coverage; binding unverified')
        cfg['action'] = {'id': 'warming.'+key if entry['kind'] == 'process' else '', 'version': 1, 'implementation': 'planned'}
        cfg['trigger'] = spec['trigger'] if key == 'rank' else {'kind': 'unspecified'}
        cfg['idempotency'] = None
        model.validate_config(cfg, entry['kind'])
        db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), n['id']))
        db.execute('UPDATE nodes SET definition=?,formula=?,trigger_rule=?,caveats=?,notes=?,updated_at=? WHERE id=?',
                   (entry['description_zh'], entry['algorithm_zh'], entry['trigger_zh'], spec['limitations_zh'], PATH+' · '+key, now(), n['id']))
        service._event(ACTOR, 'update', 'node', n['id'], before=n, after=service.get_node(n['id']))

    def connect(source, target, names, kind, role):
        edge = db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?', (source['id'], target['id'])).fetchone()
        if edge is None:
            edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'], 'transport_kind': 'direct',
                                        'rationale': 'SS-102 approved design dependency; not runtime evidence.',
                                        'bindings': [{'kind': kind, 'branch': '',
                                            'source_port_id': stable(source['id'], 'output', 'out'),
                                            'target_port_id': stable(target['id'], 'input', 'in'),
                                            'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [], 'role': role}}]}, actor=ACTOR, commit=False)
        edge = dict(edge)
        db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
        model.add_binding(edge, {'kind': kind, 'branch': '', 'source_port_id': stable(source['id'], 'output', 'out'),
                                'target_port_id': stable(target['id'], 'input', 'in'),
                                'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [], 'role': role}})
        sf = {f['name']: f['id'] for f in service.get_fields(source['id'])}
        tf = {f['name']: f['id'] for f in service.get_fields(target['id'])}
        used = {(u['source_field_id'], u['target_field_id']) for u in service.get_field_usages(edge['id'])}
        for name in names:
            if name not in sf:
                raise ValueError('SS-102 missing producer field '+name)
            pair = (sf[name], tf.get(name))
            if pair not in used:
                service.create_field_usage(edge['id'], {'source_field_id': pair[0], 'target_field_id': pair[1],
                    'usage_note': 'SS-102 frozen observations; growth is not a new score-ledger contribution.'}, actor=ACTOR, commit=False)

    db.execute('BEGIN IMMEDIATE')
    try:
        for e in incoming:
            service._event(ACTOR, 'delete', 'edge', e['id'], before=dict(e))
            db.execute('DELETE FROM edges WHERE id=?', (e['id'],))
        downstream = service.find_name('候选代币筛选')
        for key in ('rank', 'result'):
            n = nodes[key]
            desired = {c['name'] for c in cards[key]['fields']}
            old_names = {f['name'] for f in previous[n['name']]['fields']}
            for f in service.get_fields(n['id']):
                if f['name'] in old_names - desired:
                    usages = list(db.execute('SELECT u.*,e.upstream_id,e.downstream_id FROM edge_field_usages u JOIN edges e ON e.id=u.edge_id WHERE u.source_field_id=? OR u.target_field_id=?', (f['id'], f['id'])))
                    for u in usages:
                        owned = u['upstream_id'] == nodes['rank']['id'] and u['downstream_id'] == nodes['result']['id']
                        legacy_reference = key == 'result' and downstream and u['downstream_id'] == downstream['id'] and u['target_field_id'] is None
                        if not owned and not legacy_reference:
                            raise ValueError('SS-102 external dependency on retired field '+f['name'])
                    db.execute('DELETE FROM edge_field_usages WHERE source_field_id=? OR target_field_id=?', (f['id'], f['id']))
                    db.execute('DELETE FROM node_fields WHERE id=?', (f['id'],))
                elif f['name'] not in old_names and f['name'] in desired:
                    raise ValueError('SS-102 new field name conflict '+f['name'])
            fields(n, cards[key]['fields'])
        y = max(r[0] for r in db.execute('SELECT position_y FROM nodes')) + 360
        for key, dx in [('candidates', 0), ('baseline', 600)]:
            entry = cards[key]
            nodes[key] = service.create_node({'name': entry['name'], 'kind': entry['kind'], 'workflow_lane': 'shared',
                                             'position_x': nodes['rank']['position_x']+dx, 'position_y': y}, actor=ACTOR, commit=False)
            fields(nodes[key], entry['fields'])
        for key in cards:
            configure(key)
        raw = cards['candidates']['output_fields']
        shared = ['observation_id','asset_id','source_id','source_object_id','quote_currency','coverage_key','requested_at','collected_at','observed_at','quality_status','total_volume']
        connect(nodes['channel'], nodes['candidates'], raw, 'reference', 'warming_candidate_input')
        connect(nodes['candidates'], nodes['baseline'], raw, 'read', 'daily_baseline_context')
        connect(nodes['history'], nodes['baseline'], shared, 'read', 'daily_historical_targets')
        connect(nodes['baseline'], nodes['rank'], cards['baseline']['output_fields'], 'data', 'frozen_daily_baseline')
        connect(nodes['candidates'], nodes['rank'], raw, 'read', 'frozen_warming_batch')
        connect(nodes['history'], nodes['rank'], shared, 'read', 'one_and_two_hour_history')
        connect(nodes['coverage'], nodes['rank'], ['coverage_key','status','record_count','requested_at','completed_at','run_id'], 'read', 'complete_round_coverage')
        connect(nodes['rank'], nodes['result'], cards['result']['input_fields'], 'write', 'atomic_warming_snapshot')
        # Correct only inherited warming copy on the existing homepage; layout is unchanged.
        home_path = 'catalog/homepage-layout.v1.json'
        old_home = json.loads((ROOT / 'server/migration_snapshots/homepage-before-ss102.json').read_text())
        new_home = json.loads((ROOT / home_path).read_text())
        digest = hashlib.sha256((ROOT / home_path).read_bytes()).hexdigest()
        for row in db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            cfg = json.loads(row['config'])
            changed = False
            def refresh(obj):
                nonlocal changed
                if isinstance(obj, dict):
                    if obj.get('path') == home_path and 'revision' in obj:
                        if obj['revision'] not in (old_home['digest'], digest):
                            raise ValueError('SS-102 unknown homepage revision')
                        obj['revision'] = digest
                        changed = True
                    for v in obj.values():
                        refresh(v)
                elif isinstance(obj, list):
                    for v in obj:
                        refresh(v)
            refresh(cfg)
            if 'interface' in cfg and cfg['interface'].get('name') == new_home['interface']['name']:
                for field in ('display_zh','display_en','limitations_zh','limitations_en'):
                    replacement = dict(zip(old_home['spec']['interface'][field], new_home['interface'][field]))
                    values = cfg['interface'].get(field, [])
                    updated = [replacement.get(v, v) for v in values]
                    if updated != values:
                        cfg['interface'][field] = updated
                        changed = True
            if changed:
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), row['node_id']))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-102 invalid graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'new_nodes': [nodes[k]['id'] for k in ('baseline', 'candidates')]})
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, spec['version']))
        db.commit()
    except Exception:
        db.rollback()
        raise

V3_MARKER = 'coingecko_warming_growth_ss102_v3'


def ensure_warming_v3(service):
    """Upgrade only the owned warming definitions; preserve identities and user edits."""
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (V3_MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='board_display_top50_ss131_v1'").fetchone():
        return
    saved = json.loads((ROOT / 'server/migration_snapshots/warming-before-v3.json').read_text())
    spec = json.loads((ROOT / PATH).read_text())
    digest = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    model = CardModel(service)
    nodes = {}
    db.execute('BEGIN IMMEDIATE')
    try:
        for old, new in zip(saved['spec']['cards'], spec['cards']):
            if old['key'] != new['key']:
                raise ValueError('SS-102 v3 card identity mismatch')
            node = service.find_name(old['name'])
            if not node or new['name'] != old['name'] and service.find_name(new['name']):
                raise ValueError('SS-102 v3 missing card or name conflict')
            nodes[new['key']] = node
            cfg = copy.deepcopy(model.contract(node['id'])['config'])
            if cfg.get('read_only') or cfg['action']['implementation'] not in ('unknown', 'planned') or cfg['resource'].get('warming_key') != new['key']:
                raise ValueError('SS-102 v3 protected contract')
            for field, source in [('definition','description_zh'), ('formula','algorithm_zh'), ('trigger_rule','trigger_zh')]:
                if node[field] != old[source]:
                    raise ValueError('SS-102 v3 edited definition ' + old['key'] + '/' + field)
            refs = cfg.get('definition_refs', [])
            owned = [r for r in refs if r.get('path') == PATH]
            if len(owned) != 1 or owned[0].get('revision') != saved['digest']:
                raise ValueError('SS-102 v3 unknown definition revision')
            owned[0]['revision'] = digest
            known = {f['name']: f for f in service.get_fields(node['id'])}
            for col in old['fields']:
                field = known.get(col['name'])
                if not field or (field['data_type'], field['definition']) != (col['data_type'], col['label_zh']):
                    raise ValueError('SS-102 v3 edited field ' + col['name'])
            old_names = {col['name'] for col in old['fields']}
            if any(col['name'] in known and col['name'] not in old_names for col in new['fields']):
                raise ValueError('SS-102 v3 new field name conflict')
            system_state = node['is_system_state']
            if system_state:
                db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?', (node['id'],))
            for col in new['fields']:
                if col['name'] in known:
                    db.execute('UPDATE node_fields SET data_type=?,definition=? WHERE id=?',
                               (col['data_type'], col['label_zh'], known[col['name']]['id']))
                else:
                    service.create_field(node['id'], {'name': col['name'], 'data_type': col['data_type'], 'definition': col['label_zh']}, actor=ACTOR, commit=False)
            if system_state:
                db.execute('UPDATE nodes SET is_system_state=? WHERE id=?', (system_state,node['id']))
            resource = cfg['resource']
            resource['algorithm_version'] = spec['version']
            if new['key'] == 'baseline':
                for key in ('daily_cache_key', 'freeze_missing_results'):
                    resource.pop(key, None)
                resource.update(execution_scope='inside_warming_program', recompute='each_request',
                                recovery='Retain published snapshot references; recompute later requests from available hourly history; no daily cache writes')
            if new['key'] == 'candidates':
                resource['metadata_enrichment'] = 'Read asset_core.assets.created_at by resolved asset_id as asset_created_at; Studio does not bind a live reader'
            model.validate_config(cfg, new['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))
            db.execute('UPDATE nodes SET name=?,definition=?,formula=?,trigger_rule=?,updated_at=? WHERE id=?',
                       (new['name'],new['description_zh'],new['algorithm_zh'],new['trigger_zh'],now(),node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
        # Extend owned producer/consumer mappings without changing existing edges or positions.
        for source, target, names in [('baseline','rank',['baseline_hours']),
                                      ('candidates','baseline',['asset_created_at']),
                                      ('candidates','rank',['asset_created_at']),
                                      ('rank','result',['baseline_hours','asset_created_at','is_new_asset','is_new'])]:
            edge = db.execute('SELECT id FROM edges WHERE upstream_id=? AND downstream_id=?', (nodes[source]['id'],nodes[target]['id'])).fetchone()
            if not edge:
                raise ValueError('SS-102 v3 missing dependency')
            sf = {f['name']:f['id'] for f in service.get_fields(nodes[source]['id'])}
            tf = {f['name']:f['id'] for f in service.get_fields(nodes[target]['id'])}
            for name in names:
                service.create_field_usage(edge['id'], {'source_field_id':sf[name], 'target_field_id':tf[name],
                    'usage_note':'SS-102 v3 hourly baseline and asset registration metadata; no ranking bonus'}, actor=ACTOR, commit=False)
        home_path = 'catalog/homepage-layout.v1.json'
        home = json.loads((ROOT / home_path).read_text())
        home_digest = hashlib.sha256((ROOT / home_path).read_bytes()).hexdigest()
        old_home = saved['homepage']
        for row in db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            cfg = json.loads(row['config'])
            changed = False
            def refresh(obj):
                nonlocal changed
                if isinstance(obj, dict):
                    if obj.get('path') == home_path and 'revision' in obj:
                        if obj['revision'] not in (old_home['digest'], home_digest):
                            raise ValueError('SS-102 v3 unknown homepage revision')
                        if obj['revision'] != home_digest:
                            obj['revision'] = home_digest
                            changed = True
                    for value in obj.values():
                        refresh(value)
                elif isinstance(obj, list):
                    for value in obj:
                        refresh(value)
            refresh(cfg)
            if cfg.get('interface', {}).get('name') == home['interface']['name']:
                for key in ('display_zh', 'display_en'):
                    replacements = dict(zip(old_home['spec']['interface'][key],home['interface'][key]))
                    values = cfg['interface'].get(key, [])
                    updated = [replacements.get(value,value) for value in values]
                    if values != updated:
                        cfg['interface'][key] = updated
                        changed = True
            if changed:
                if cfg.get('read_only'):
                    raise ValueError('SS-102 v3 protected homepage reference')
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg),row['node_id']))
        # Rename obsolete daily roles on the same dependency bindings.
        for row in db.execute('SELECT id,config FROM edge_bindings').fetchall():
            cfg = json.loads(row['config'])
            roles = {'daily_baseline_context':'hourly_baseline_context', 'daily_historical_targets':'hourly_historical_targets', 'frozen_daily_baseline':'request_hourly_baseline'}
            if cfg.get('role') in roles:
                cfg['role'] = roles[cfg['role']]
                db.execute('UPDATE edge_bindings SET config=? WHERE id=?', (encoded(cfg),row['id']))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-102 v3 invalid graph')
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (V3_MARKER,spec['version']))
        db.commit()
    except Exception:
        db.rollback()
        raise
