"""SS-138: local displays of existing cards; no business runtime changes."""
import hashlib
import json
from pathlib import Path
from urllib.parse import quote

from card_model import CardModel, encoded, stable

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/stocks-shared-pipeline.v1.json'
MARKER = 'stocks_shared_pipeline_ss138_v1'
ACTOR = 'ss138-stocks-shared-pipeline'


def ensure_stocks_shared_pipeline(service):
    db = service.db
    revision = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    installed = db.execute('SELECT value FROM schema_meta WHERE key=?', (MARKER,)).fetchone()
    if installed and installed['value'] == revision:
        return
    spec = json.loads((ROOT / PATH).read_text())
    nodes = [service.find_name(step['name']) for step in spec['steps']]
    if not all(nodes):
        raise ValueError('Stocks shared pipeline requires existing shared cards')
    model = CardModel(service)
    if installed:
        # This catalog contains presentation prose only. Refresh its reference
        # without reinstalling links or resetting any local display position.
        config = model.contract(nodes[0]['id'])['config']
        refs = [ref for ref in config['definition_refs'] if ref['path'] == PATH]
        if len(refs) != 1 or refs[0]['revision'] != installed['value']:
            raise ValueError('Stocks shared pipeline presentation reference edited')
        refs[0]['revision'] = revision
        model.validate_config(config, 'source')
        with db:
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?',
                       (encoded(config), nodes[0]['id']))
            db.execute('UPDATE schema_meta SET value=? WHERE key=?', (revision, MARKER))
        return
    graph = service.graph()
    pairs = {(edge['upstream_id'], edge['downstream_id']) for edge in graph['edges']}
    # Only the Stocks -> raw Topic reference is new. Shared downstream links
    # must already exist; never fabricate a second processing chain.
    if any((a['id'], b['id']) not in pairs for a, b in zip(nodes[1:], nodes[2:])):
        raise ValueError('Stocks shared pipeline is missing an existing shared link')
    if (nodes[0]['id'], nodes[1]['id']) in pairs:
        raise ValueError('Stocks shared pipeline reference already edited')
    left = max(n['position_x'] for n in graph['nodes']) + 700
    db.execute('BEGIN IMMEDIATE')
    try:
        source, target = nodes[:2]
        edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
            'rationale': 'SS-138：Stocks 原始行情复用 market.snapshot；仅设计引用，未启动发布。'},
            actor=ACTOR, commit=False)
        db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
        model.add_binding(edge, {'kind': 'reference', 'branch': '',
            'source_port_id': stable(source['id'], 'output', 'out'),
            'target_port_id': stable(target['id'], 'input', 'in'),
            'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [],
                       'role': 'stocks_shared_pipeline_design_only'}})
        # Nested local references give each existing card a nearby display.
        # Canonical positions, all saved displays and downstream bindings stay intact.
        anchor = source['id']
        for index, node in enumerate(nodes[1:]):
            display = 'local-reference:' + quote(json.dumps([anchor, node['id']], separators=(',', ':')), safe='')
            db.execute('INSERT OR IGNORE INTO node_display_positions VALUES (?,?,?,?)',
                       (node['id'], display, left, source['position_y'] + index * 420))
            anchor = display
        config = model.contract(source['id'])['config']
        config['definition_refs'].append({'path': PATH, 'revision': revision})
        model.validate_config(config, 'source')
        db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?',
                   (encoded(config), source['id']))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Invalid Stocks shared pipeline graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER,
                       after={'new_nodes': [], 'new_reference': edge['id'], 'shared_displays': 5,
                              'runtime_enabled': False})
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, revision))
        db.commit()
    except Exception:
        db.rollback()
        raise
