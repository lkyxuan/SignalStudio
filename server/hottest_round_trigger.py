"""SS-105: guarded Studio trigger migration, not a live crawler scheduler."""
import hashlib
import json
from card_model import CardModel, encoded
from coingecko_hottest import ROOT, PATH
from graph_service import now

MARKER = 'hottest_round_trigger_ss105_v1'


def ensure_hottest_round_trigger(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='hottest_rvol_warmup_ss101_v1'").fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    previous = json.loads((ROOT / 'server/migration_snapshots/hottest-before-ss105.json').read_text())
    revision = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    model = CardModel(service)
    db.execute('BEGIN IMMEDIATE')
    try:
        nodes = {}
        for entry in spec['cards']:
            key = entry['key']
            if key not in previous['triggers']:
                continue
            node = service.find_name(entry['name'])
            if not node:
                raise ValueError('SS-105 missing card ' + key)
            cfg = model.contract(node['id'])['config']
            if cfg.get('read_only') or cfg['action']['implementation'] not in ('unknown', 'planned'):
                raise ValueError('SS-105 protected card ' + key)
            if node['trigger_rule'] not in (previous['triggers'][key], entry['trigger_zh']):
                raise ValueError('SS-105 edited trigger ' + key)
            if key == 'rank':
                if cfg['trigger'] not in ({'kind': 'schedule', 'interval_seconds': 300}, spec['trigger']):
                    raise ValueError('SS-105 edited rank contract trigger')
                cfg['trigger'] = spec['trigger']
                model.validate_config(cfg, model.contract(node['id'])['kind'])
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))
            nodes[key] = (node, entry)
        for row in db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            cfg = json.loads(row['config'])
            changed = False
            def refresh(obj):
                nonlocal changed
                if isinstance(obj, dict):
                    if obj.get('path') == PATH and 'revision' in obj:
                        if obj['revision'] not in (previous['digest'], revision):
                            raise ValueError('SS-105 unknown definition revision')
                        if obj['revision'] != revision:
                            obj['revision'] = revision
                            changed = True
                    for value in obj.values():
                        refresh(value)
                elif isinstance(obj, list):
                    for value in obj:
                        refresh(value)
            refresh(cfg)
            if changed:
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), row['node_id']))
        for node, entry in nodes.values():
            db.execute('UPDATE nodes SET trigger_rule=?,updated_at=? WHERE id=?', (entry['trigger_zh'], now(), node['id']))
            service._event('ss105-round-trigger', 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-105 invalid graph')
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, '1'))
        db.commit()
    except Exception:
        db.rollback()
        raise
