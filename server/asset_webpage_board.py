"""SS-124: install nine design cards and one minimal Few/Grokbot handoff.

This migration never calls a provider or starts a business scheduler.
"""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/asset-webpage-board.v1.json'
PREVIOUS = 'catalog/asset-grokbot-flow.v1.json'
MARKER = 'asset_webpage_board_ss124_v1'
ACTOR = 'ss124-webpage-board'


def ensure_asset_webpage_board(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    old = json.loads((ROOT / PREVIOUS).read_text())
    model = CardModel(service)
    db.execute('BEGIN IMMEDIATE')
    try:
        originals = {c['key']: service.find_name(c['name']) for c in old['cards']}
        if not model.enabled() or not all(originals.values()):
            raise ValueError('SS-124 requires the consolidated webpage design')
        parent = originals['grokbot']
        changed = {n['id'] for n in originals.values()}
        expected_revision = hashlib.sha256((ROOT / PREVIOUS).read_bytes()).hexdigest()
        for card in old['cards']:
            node = originals[card['key']]
            cfg = model.contract(node['id'])['config']
            if (node['definition'] != card['description_zh'] or node['formula'] != card['algorithm_zh']
                    or cfg.get('read_only') or not cfg.get('draft')
                    or cfg['action']['implementation'] not in ('unknown', 'planned')
                    or not any(r['path'] == PREVIOUS and r['revision'] == expected_revision for r in cfg['definition_refs'])
                    or cfg['resource'].get('physical_binding') not in (None, 'unconnected')
                    or cfg['resource'].get('observed_rows')):
                raise ValueError('SS-124 changed/protected design; preserve for review')
            actual = {(f['name'], f['data_type']) for f in service.get_fields(node['id'])}
            expected = {(f['name'], f['type']) for f in card['fields']}
            # Historical candidate fields retained nullable types during SS-116/120.
            # Preserve them; do not broaden this exception to the rewritten boundary.
            nullable_candidate = {'calculated_at': 'UTC timestamp | null', 'score': 'number | null',
                                  'algorithm_version': 'string | null'} if card['key'] == 'candidates' else {}
            normalized = {(name, next((f['type'] for f in card['fields'] if f['name'] == name), typ))
                          if nullable_candidate.get(name) == typ else (name, typ) for name, typ in actual}
            if normalized != expected:
                raise ValueError('SS-124 changed fields; preserve for review')
            if card['key'] == 'grokbot':
                labels = {f['name']: f['definition'] for f in service.get_fields(node['id'])}
                if labels != {f['name']: f['label_zh'] for f in card['fields']}:
                    raise ValueError('SS-124 changed boundary field description; preserve for review')
        names = {e[k] for e in old['connections'] for k in ('source', 'target')}
        nodes = {name: service.find_name(name) for name in names}
        if not all(nodes.values()):
            raise ValueError('SS-124 missing boundary resource')
        known_pairs = {(nodes[e['source']]['id'], nodes[e['target']]['id']) for e in old['connections']}
        touching = [dict(e) for e in db.execute('SELECT * FROM edges') if parent['id'] in (e['upstream_id'], e['downstream_id'])]
        expected_parent_pairs = {p for p in known_pairs if parent['id'] in p}
        if {(e['upstream_id'], e['downstream_id']) for e in touching} != expected_parent_pairs:
            raise ValueError('SS-124 unrelated or missing boundary connection; preserve for review')
        original_field_ids = {f['id'] for n in originals.values() for f in service.get_fields(n['id'])}
        for req in db.execute('SELECT * FROM data_requirements'):
            if req['node_id'] in changed or req['source_field_id'] in original_field_ids:
                raise ValueError('SS-124 user requirements; preserve for review')
        parent_field_ids = {f['id'] for f in service.get_fields(parent['id'])}
        for usage in db.execute('SELECT u.*,e.upstream_id,e.downstream_id FROM edge_field_usages u JOIN edges e ON e.id=u.edge_id'):
            if ({usage['source_field_id'], usage['target_field_id']} & parent_field_ids
                    and (usage['upstream_id'], usage['downstream_id']) not in known_pairs):
                raise ValueError('SS-124 unrelated field reference; preserve for review')
        # Keep version-pinned reports unchanged. Changed definitions make old reports
        # stale through CardProgress; old aggregate-card claims never verify the new steps.
        for card in spec['cards'][2:]:
            if service.find_name(card['name']):
                raise ValueError('SS-124 new card name conflict')
        # Only replace the old boundary edges. Upstream reads and all other graph data remain intact.
        for edge in touching:
            for usage in service.get_field_usages(edge['id']):
                service._event(ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
            service._event(ACTOR, 'delete', 'edge', edge['id'], before=edge)
            db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
        by_key = {}
        revision = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
        occupied = service.graph()['nodes']
        for index, card in enumerate(spec['cards']):
            node = originals.get(card['key']) or (parent if card['key'] == 'identity' else None)
            if not node:
                x, y = parent['position_x'] + 420, parent['position_y'] + (index - 3) * 230
                while any(abs(n['position_x'] - x) < 350 and abs(n['position_y'] - y) < 180 for n in occupied):
                    x += 420
                node = service.create_node({'name': card['name'], 'kind': card['kind'], 'workflow_lane': 'knowledge',
                                            'position_x': x, 'position_y': y}, actor=ACTOR, commit=False)
                occupied.append(node)
            before = copy.deepcopy(node)
            db.execute('UPDATE nodes SET name=?,definition=?,formula=?,trigger_rule=?,notes=?,caveats=?,updated_at=? WHERE id=?',
                       (card['name'], card['description_zh'], card['algorithm_zh'], card['trigger_zh'], PATH,
                        spec['provenance_zh'], now(), node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=before, after=service.get_node(node['id']))
            wanted = {f['name'] for f in card['fields']}
            for field in service.get_fields(node['id']):
                if field['name'] not in wanted:
                    service._event(ACTOR, 'delete', 'field', field['id'], before=field)
                    db.execute('DELETE FROM node_fields WHERE id=?', (field['id'],))
            existing = {f['name']: f for f in service.get_fields(node['id'])}
            for field in card['fields']:
                if field['name'] not in existing:
                    service.create_field(node['id'], {'name': field['name'], 'data_type': field['type'],
                                                      'definition': field['label_zh']}, actor=ACTOR, commit=False)
                elif existing[field['name']]['definition'] != field['label_zh']:
                    previous = existing[field['name']]
                    db.execute('UPDATE node_fields SET definition=?,updated_at=? WHERE id=?', (field['label_zh'], now(), previous['id']))
                    service._event(ACTOR, 'update', 'field', previous['id'], before=previous, after=service.get_field(previous['id']))
            before_cfg = model.contract(node['id'])['config']
            cfg = copy.deepcopy(before_cfg)
            ref = {'path': PATH, 'revision': revision, 'selector': {'key': card['key']}}
            cfg['definition_refs'] = [ref]
            cfg['resource'] = {'asset_webpage_flow': card['key'], 'delivery': 'studio_design_only',
                               'owner': card['owner_zh'], 'physical_binding': None, 'board_handoff': spec['handoff']}
            cfg['trigger'] = {'kind': 'unspecified', 'configuration_ref': ref}
            cfg['action'] = {'id': '', 'version': 1, 'implementation': 'unknown'}
            cfg['branches'] = card['branches']
            if model.contract(node['id'])['kind'] == 'decision':
                cfg['actor'] = 'automatic'
            model.validate_config(cfg, model.contract(node['id'])['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))
            model.ensure_node(service.get_node(node['id']))
            service._event(ACTOR, 'update', 'node_contract', node['id'], before=before_cfg, after=cfg)
            nodes[card['name']] = node
            by_key[card['key']] = node
        # Update/recreate only explicitly defined webpage relations.
        for relation in spec['connections']:
            source, target = nodes[relation['source']], nodes[relation['target']]
            edge = db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?', (source['id'], target['id'])).fetchone()
            if edge:
                # Existing upstream reads were not changed by this migration.
                continue
            kind = relation.get('kind', 'read' if model.contract(source['id'])['kind'] == 'table' else 'control' if model.contract(source['id'])['kind'] == 'decision' else 'data')
            config = copy.deepcopy(relation.get('config', {}))
            config['trigger'] = 'none' if kind in ('read', 'reference') else 'event'
            config.update(guard=relation.get('guard', {}))
            if relation.get('internal_retry_limit'):
                config.update(role='bounded_internal_revision_reference', max_iterations=relation['internal_retry_limit'])
            bindings = [{'kind': kind, 'branch': branch, 'source_port_id': stable(source['id'], 'output', 'out'),
                         'target_port_id': stable(target['id'], 'input', 'in'), 'config': config}
                        for branch in relation.get('branches', [relation.get('branch', '')])]
            edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                                        'rationale': relation['note_zh'], 'transformation': relation['note_zh'],
                                        'bindings': bindings}, actor=ACTOR, commit=False)
            sf = {f['name']: f for f in service.get_fields(source['id'])}
            tf = {f['name']: f for f in service.get_fields(target['id'])}
            for name in relation['fields']:
                target_name = relation.get('mapping', {}).get(name, name)
                service.create_field_usage(edge['id'], {'source_field_id': sf[name]['id'], 'target_field_id': tf[target_name]['id'],
                                                       'usage_note': relation['note_zh']}, actor=ACTOR, commit=False)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-124 invalid webpage board')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'cards': {k: n['id'] for k, n in by_key.items()},
                                                                   'handoff': spec['handoff']['input_fields']})
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, '1'))
        db.commit()
    except Exception:
        db.rollback()
        raise
