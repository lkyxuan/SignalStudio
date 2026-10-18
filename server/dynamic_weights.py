"""SS-113 design cards only: no business tables, scoring or updater are run."""
import hashlib
import json
from pathlib import Path
from card_model import CardModel, encoded, stable

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/dynamic-weights.v1.json'
MARKER = 'dynamic_weights_ss113_v1'
ACTOR = 'ss113-dynamic-weights-design'


def ensure_dynamic_weights(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    model = CardModel(service)
    if not model.enabled():
        raise ValueError('SS-113 requires card model')
    prerequisites = {name: service.find_name(name) for name in ('assets', 'asset_relationships')}
    if not all(prerequisites.values()):
        raise ValueError('SS-113 requires existing identity tables')
    if any(service.find_name(c['name']) for c in spec['cards']):
        raise ValueError('SS-113 card name conflict; review existing cards')
    digest = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    y = (db.execute('SELECT MAX(position_y) FROM nodes').fetchone()[0] or 0) + 800
    nodes = dict(prerequisites)
    db.execute('BEGIN IMMEDIATE')
    try:
        for index, card in enumerate(spec['cards']):
            name = card['name']
            node = service.create_node({'name': name, 'kind': 'table', 'workflow_lane': 'shared',
                'definition': card['description_zh'], 'formula': '\n'.join(card['rules_zh']),
                'caveats': spec['provenance_zh'], 'notes': PATH + ' · ' + name,
                'position_x': (index % 2) * 900, 'position_y': y + (index // 2) * 400},
                actor=ACTOR, commit=False)
            nodes[name] = node
            for column in spec['tables'][name]['columns']:
                service.create_field(node['id'], {'name': column['name'], 'data_type': column['type'],
                    'definition': column['label_zh']}, actor=ACTOR, commit=False)
            cfg = model.contract(node['id'])['config']
            cfg['definition_refs'] = [{'path': PATH, 'revision': digest, 'selector': {'name': name}}]
            cfg['resource'] = {'delivery': 'studio_design_only', 'observed_rows': [],
                'table_name': name, 'physical_binding': 'unconnected'}
            cfg['action'] = {'id': '', 'version': 1, 'implementation': 'unknown'}
            cfg['trigger'] = {'kind': 'unspecified'}
            model.validate_config(cfg, 'table')
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?',
                       (encoded(cfg), node['id']))
        for item in spec['edges']:
            source, target = nodes[item['source']], nodes[item['target']]
            edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                'transport_kind': 'direct', 'rationale': 'SS-113 设计引用；不执行或自动同步。',
                'transformation': item['note']}, actor=ACTOR, commit=False)
            db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            model.add_binding(edge, {'kind': 'reference', 'branch': '',
                'source_port_id': stable(source['id'], 'output', 'out'),
                'target_port_id': stable(target['id'], 'input', 'in'),
                'config': {'trigger': 'none', 'role': 'weight_design_reference'}})
            fields = {f['name']: f['id'] for f in service.get_fields(source['id'])}
            targets = {f['name']: f['id'] for f in service.get_fields(target['id'])}
            for field, mapped in item['fields'].items():
                service.create_field_usage(edge['id'], {'source_field_id': fields[field],
                    'target_field_id': targets[mapped], 'usage_note': item['note']},
                    actor=ACTOR, commit=False)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-113 invalid design graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER,
                       after={'nodes': [nodes[c['name']]['id'] for c in spec['cards']]})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, str(spec['version'])))
        db.commit()
    except Exception:
        db.rollback()
        raise
