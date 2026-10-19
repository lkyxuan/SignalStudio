"""SS-131: guarded Studio top-50 upgrade; no business data or layout writes."""
import hashlib
import json
from pathlib import Path
from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
MARKER = 'board_display_top50_ss131_v1'
ACTOR = 'ss131-top50'
SNAPSHOT = 'server/migration_snapshots/boards-before-ss131.json'


def ensure_board_display_limit(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='coingecko_warming_growth_ss102_v1'").fetchone():
        return
    previous = json.loads((ROOT / SNAPSHOT).read_text())
    model = CardModel(service)
    revisions, updates = {}, []
    for path, saved in previous.items():
        raw = (ROOT / path).read_bytes()
        spec, old = json.loads(raw), saved['spec']
        revisions[path] = (saved['digest'], hashlib.sha256(raw).hexdigest())
        if 'cards' in spec:
            old_cards = {c['key']: c for c in old['cards']}
            for card in spec['cards']:
                before = old_cards[card['key']]
                changes = {field: (before[source], card[source]) for field, source in
                           [('definition', 'description_zh'), ('formula', 'algorithm_zh')]
                           if before[source] != card[source]}
                if changes:
                    updates.append((card['name'], changes))
        else:
            updates.append((spec['calculator_name'], {'formula':
                            ('\n'.join(old['requirements_zh']), '\n'.join(spec['requirements_zh']))}))
    db.execute('BEGIN IMMEDIATE')
    try:
        for name, changes in updates:
            node = service.find_name(name)
            if not node:
                raise ValueError('SS-131 missing card: ' + name)
            contract = model.contract(node['id'])
            cfg = contract['config']
            if cfg.get('read_only') or cfg['action']['implementation'] not in ('unknown', 'planned'):
                raise ValueError('SS-131 protected card: ' + name)
            for field, (old, new) in changes.items():
                if node[field] not in (old, new):
                    raise ValueError('SS-131 edited ' + name + '/' + field)
                db.execute('UPDATE nodes SET ' + field + '=?,updated_at=? WHERE id=?', (new, now(), node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
        # Refresh every definition occurrence while preserving unrelated config and references.
        for row in db.execute('SELECT node_id,kind,config FROM node_contracts').fetchall():
            cfg = json.loads(row['config'])
            changed = False
            def refresh(obj):
                nonlocal changed
                if isinstance(obj, dict):
                    if obj.get('path') in revisions and 'revision' in obj:
                        old, new = revisions[obj['path']]
                        if obj['revision'] not in (old, new):
                            raise ValueError('SS-131 unknown definition revision: ' + obj['path'])
                        if obj['revision'] != new:
                            obj['revision'] = new
                            changed = True
                    for value in obj.values():
                        refresh(value)
                elif isinstance(obj, list):
                    for value in obj:
                        refresh(value)
            refresh(cfg)
            if changed:
                if cfg.get('read_only'):
                    raise ValueError('SS-131 protected definition reference')
                model.validate_config(cfg, row['kind'])
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?',
                           (encoded(cfg), row['node_id']))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-131 invalid graph')
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, '50'))
        db.commit()
    except Exception:
        db.rollback()
        raise
