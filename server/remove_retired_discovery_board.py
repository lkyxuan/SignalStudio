"""SS-86: remove only the retired #1010 Studio placeholder, after SS-84."""
import json
from pathlib import Path

from card_model import CardModel, stable

MARKER = 'remove_retired_discovery_board_v1'
ACTOR = 'ss86-remove-retired-board'
ROOT = Path(__file__).resolve().parent.parent


def ensure_remove_retired_discovery_board(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='new_uuid_board_v1'").fetchone():
        return
    # Check and delete under the same write lock; never cascade newly attached work.
    db.execute('BEGIN IMMEDIATE')
    try:
        node = db.execute('SELECT * FROM nodes WHERE reference_number=1010').fetchone()
        if node:
            node = dict(node)
            spec = json.loads((ROOT / 'server/migration_snapshots/market-ss80.json').read_text())
            expected = next(n for n in spec['nodes'] if n['key'] == 'discoveries_table')
            contract = CardModel(service).contract(node['id'])
            cfg = contract['config']
            if (node['name'] != 'leaderboard_emerging'
                    or node['definition'] != expected['description']
                    or node['formula'] != expected['algorithm']
                    or contract['kind'] != 'table'
                    or cfg.get('read_only')
                    or cfg.get('action') != {'id': '', 'version': 1, 'implementation': 'unknown'}
                    or cfg.get('trigger') != {'kind': 'unspecified'}
                    or cfg.get('resource', {}).get('status') != 'retired_placeholder'
                    or cfg['resource'].get('primary_key') != []
                    or cfg.get('technology') or cfg.get('environment') != 'unspecified'
                    or cfg.get('branches') or cfg.get('loop') or cfg.get('idempotency')):
                raise ValueError('Remove retired board: edited or protected #1010')
            for table in ('node_fields', 'data_requirements'):
                if db.execute('SELECT 1 FROM ' + table + ' WHERE node_id=?', (node['id'],)).fetchone():
                    raise ValueError('Remove retired board: new fields or requirements on #1010')
            if db.execute('SELECT 1 FROM edges WHERE upstream_id=? OR downstream_id=?',
                          (node['id'], node['id'])).fetchone():
                raise ValueError('Remove retired board: new dependency on #1010')
            schema_id = stable(node['id'], 'fields')
            schemas = [tuple(r) for r in db.execute(
                'SELECT id,version,field_ids FROM data_schemas WHERE node_id=?', (node['id'],))]
            ports = {tuple(r) for r in db.execute(
                'SELECT id,key,direction,schema_id FROM node_ports WHERE node_id=?', (node['id'],))}
            expected_ports = {(stable(node['id'], direction, key), key, direction, schema_id)
                              for direction, key in [('input', 'in'), ('output', 'out'), ('output', 'error')]}
            if schemas != [(schema_id, 1, '[]')] or ports != expected_ports:
                raise ValueError('Remove retired board: edited ports or schemas on #1010')
            if db.execute('SELECT 1 FROM edge_bindings WHERE source_port_id IN '
                          '(SELECT id FROM node_ports WHERE node_id=?) OR target_port_id IN '
                          '(SELECT id FROM node_ports WHERE node_id=?)', (node['id'], node['id'])).fetchone():
                raise ValueError('Remove retired board: new port dependency on #1010')
            # Contracts can refer to nodes without a visible edge (e.g. homepage sources).
            for row in db.execute('SELECT node_id,config FROM node_contracts WHERE node_id!=?', (node['id'],)):
                if node['id'] in row['config'] or 'leaderboard_emerging' in row['config']:
                    raise ValueError('Remove retired board: contract dependency on #1010')
            service._event(ACTOR, 'delete', 'node', node['id'], before=node)
            db.execute('DELETE FROM nodes WHERE id=?', (node['id'],))
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('Remove retired board: invalid graph')
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, '1'))
        db.commit()
    except Exception:
        db.rollback()
        raise
