"""SS-101 guarded Studio contract upgrade; never writes business snapshots."""
import hashlib
import json
from pathlib import Path
from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/coingecko-hottest.v1.json'
MARKER = 'hottest_rvol_warmup_ss101_v1'
ACTOR = 'ss101-rvol-warmup'


def ensure_hottest_warmup(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='coingecko_hottest_z_v1'").fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    previous = json.loads((ROOT / 'server/migration_snapshots/hottest-before-ss101.json').read_text())
    old_cards = {c['key']: c for c in previous['spec']['cards']}
    revision = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    inherited = json.loads((ROOT / 'server/migration_snapshots/hottest-before-ss95.json').read_text())
    model = CardModel(service)
    db.execute('BEGIN IMMEDIATE')
    try:
        nodes = {}
        for entry in spec['cards']:
            key = entry['key']; old = old_cards[key]
            node = service.find_name(entry['name'])
            if not node:
                raise ValueError('SS-101 missing card ' + key)
            nodes[key] = node
            cfg = model.contract(node['id'])['config']
            if cfg.get('read_only') or cfg['action']['implementation'] not in ('unknown', 'planned'):
                raise ValueError('SS-101 protected card ' + key)
            for field, source in [('definition', 'description_zh'), ('formula', 'algorithm_zh')]:
                if node[field] not in (old[source], entry[source]):
                    raise ValueError('SS-101 edited card ' + key + '/' + field)
            known = {f['name']: f for f in service.get_fields(node['id'])}
            old_fields = {f['name']: f for f in old['fields']}
            for col in entry['fields']:
                name = col['name']; existing = known.get(name)
                if name in old_fields and col == old_fields[name]:
                    continue  # Unchanged inherited fields are outside this migration's scope.
                if existing:
                    allowed = [col] + ([old_fields[name]] if name in old_fields else [])
                    legacy = next((f for f in inherited.get(entry['name'], {}).get('fields', []) if f['name'] == name), None)
                    if legacy:
                        allowed += [{'data_type': legacy['data_type'], 'label_zh': label} for label in (legacy['definition'], old_fields[name]['label_zh'], col['label_zh'])]
                    if not any(existing['data_type'] == c['data_type'] and existing['definition'] == c['label_zh'] for c in allowed):
                        raise ValueError('SS-101 edited field ' + key + '/' + name)
                    db.execute('UPDATE node_fields SET definition=? WHERE id=?', (col['label_zh'], existing['id']))
                elif name in old_fields:
                    raise ValueError('SS-101 missing field ' + key + '/' + name)
                else:
                    state = node['is_system_state']
                    if state:
                        db.execute('UPDATE nodes SET is_system_state=0 WHERE id=?', (node['id'],))
                    service.create_field(node['id'], {'name': name, 'data_type': col['data_type'], 'definition': col['label_zh']}, actor=ACTOR, commit=False)
                    if state:
                        db.execute('UPDATE nodes SET is_system_state=? WHERE id=?', (state, node['id']))
            cfg['resource']['algorithm_version'] = spec['version']
            if key == 'rank':
                if cfg['action']['version'] not in (1, 2):
                    raise ValueError('SS-101 unknown action version')
                cfg['action']['version'] = 2
            model.validate_config(cfg, model.contract(node['id'])['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))
            db.execute('UPDATE nodes SET definition=?,formula=?,updated_at=? WHERE id=?', (entry['description_zh'], entry['algorithm_zh'], now(), node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
        # Refresh every occurrence, including parent extension refs and legacy adapters.
        for row in db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            cfg = json.loads(row['config']); changed = False
            def refresh(obj):
                nonlocal changed
                if isinstance(obj, dict):
                    if obj.get('path') == PATH and 'revision' in obj:
                        if obj['revision'] not in (previous['digest'], revision):
                            raise ValueError('SS-101 unknown definition revision')
                        obj['revision'] = revision; changed = True
                    for value in obj.values():
                        refresh(value)
                elif isinstance(obj, list):
                    for value in obj:
                        refresh(value)
            refresh(cfg)
            resource = cfg.get('resource', {})
            if 'metric_compatibility' in resource:
                if resource['metric_compatibility'] not in (previous['spec']['metric_compatibility'], spec['metric_compatibility']):
                    raise ValueError('SS-101 edited compatibility')
                resource['metric_compatibility'] = spec['metric_compatibility']; changed = True
            if changed:
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), row['node_id']))
        edge = db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?', (nodes['rank']['id'], nodes['result']['id'])).fetchone()
        if not edge:
            raise ValueError('SS-101 missing snapshot edge')
        ids = {key: next(f['id'] for f in service.get_fields(nodes[key]['id']) if f['name'] == 'rvol_warmup') for key in ('rank', 'result')}
        usages = service.get_field_usages(edge['id'])
        if not any(u['source_field_id'] == ids['rank'] and u['target_field_id'] == ids['result'] for u in usages):
            service.create_field_usage(edge['id'], {'source_field_id': ids['rank'], 'target_field_id': ids['result'], 'usage_note': 'SS-101同批预热标记；全部合格候选无RVOL时为true。'}, actor=ACTOR, commit=False)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-101 invalid graph')
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, spec['version']))
        db.commit()
    except Exception:
        db.rollback()
        raise
