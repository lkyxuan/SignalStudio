"""SS-135: guarded, transactional three-round board design upgrade; no business IO."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/asset-webpage-board.v2.json'
PREVIOUS = 'catalog/asset-webpage-board.v1.json'
MARKER = 'asset_webpage_rounds_ss135_v1'
ACTOR = 'ss135-three-round-webpages'


def ensure_asset_webpage_rounds(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    old = json.loads((ROOT / PREVIOUS).read_text())
    spec = json.loads((ROOT / PATH).read_text())
    model = CardModel(service)
    db.execute('BEGIN IMMEDIATE')
    try:
        originals = {c['key']: service.find_name(c['name']) for c in old['cards']}
        if not model.enabled() or not all(originals.values()):
            raise ValueError('SS-135 requires the nine-card webpage design')
        revision = hashlib.sha256((ROOT / PREVIOUS).read_bytes()).hexdigest()
        for c in old['cards']:
            n = originals[c['key']]
            cfg = model.contract(n['id'])['config']
            expected_resource = {'asset_webpage_flow': c['key'], 'delivery': 'studio_design_only',
                                 'owner': c['owner_zh'], 'physical_binding': None, 'board_handoff': old['handoff']}
            ref = {'path': PREVIOUS, 'revision': revision, 'selector': {'key': c['key']}}
            if (model.contract(n['id'])['kind'] != c['kind']
                    or n['definition'] != c['description_zh'] or n['formula'] != c['algorithm_zh']
                    or n['trigger_rule'] != c['trigger_zh'] or cfg.get('read_only') or not cfg.get('draft')
                    or cfg['action'] != {'id': '', 'version': 1, 'implementation': 'unknown'}
                    or cfg['resource'] != expected_resource or cfg['branches'] != c['branches']
                    or cfg['definition_refs'] != [ref]
                    or cfg['trigger'] != {'kind': 'unspecified', 'configuration_ref': ref}):
                raise ValueError('SS-135 changed/protected card; preserve for review')
            actual = {f['name']: (f['data_type'], f['definition']) for f in service.get_fields(n['id'])}
            expected = {f['name']: (f['type'], f['label_zh']) for f in c['fields']}
            if c['key'] == 'candidates':
                for name, typ in [('calculated_at', 'UTC timestamp | null'), ('score', 'number | null'),
                                  ('algorithm_version', 'string | null')]:
                    if name in actual and actual[name][0] == typ:
                        actual[name] = (expected[name][0], actual[name][1])
            # SS-120 retained the aggregate card's nullable TEXT page reference.
            if c['key'] == 'identity' and actual.get('page_ref', (None,))[0] == 'TEXT | null':
                actual['page_ref'] = (expected['page_ref'][0], actual['page_ref'][1])
            if actual != expected:
                raise ValueError('SS-135 changed fields; preserve for review')
        nodes = {c['name']: originals[c['key']] for c in old['cards']}
        for e in old['connections']:
            for name in (e['source'], e['target']):
                nodes.setdefault(name, service.find_name(name))
        if not all(nodes.values()):
            raise ValueError('SS-135 missing boundary resource')
        writers = {originals[c['key']]['id'] for c in old['cards'][2:]}
        writer_fields = {f['id'] for ident in writers for f in service.get_fields(ident)}
        for req in db.execute('SELECT * FROM data_requirements'):
            if req['node_id'] in writers or req['source_field_id'] in writer_fields:
                raise ValueError('SS-135 user requirements; preserve for review')
        expected_edges = {(nodes[e['source']]['id'], nodes[e['target']]['id']): e
                          for e in old['connections']
                          if nodes[e['source']]['id'] in writers or nodes[e['target']]['id'] in writers}
        touching = [e for e in service.graph()['edges'] if e['upstream_id'] in writers or e['downstream_id'] in writers]
        if {(e['upstream_id'], e['downstream_id']) for e in touching} != set(expected_edges):
            raise ValueError('SS-135 unrelated/missing writer connection; preserve for review')
        for e in touching:
            relation = expected_edges[e['upstream_id'], e['downstream_id']]
            kind = relation.get('kind', 'read' if model.contract(e['upstream_id'])['kind'] == 'table'
                                else 'control' if model.contract(e['upstream_id'])['kind'] == 'decision' else 'data')
            config = copy.deepcopy(relation.get('config', {}))
            config.update(trigger='none' if kind in ('read', 'reference') else 'event', guard=relation.get('guard', {}))
            if relation.get('internal_retry_limit'):
                config.update(role='bounded_internal_revision_reference', max_iterations=relation['internal_retry_limit'])
            expected_bindings = [{'kind': kind, 'branch': b,
                                  'source_port_id': stable(e['upstream_id'], 'output', 'out'),
                                  'target_port_id': stable(e['downstream_id'], 'input', 'in'), 'config': config}
                                 for b in relation.get('branches', [relation.get('branch', '')])]
            actual_bindings = [{k: b[k] for k in ('kind', 'branch', 'source_port_id', 'target_port_id', 'config')}
                               for b in model.bindings() if b['edge_id'] == e['id']]
            sf = {f['name']: f for f in service.get_fields(e['upstream_id'])}
            tf = {f['name']: f for f in service.get_fields(e['downstream_id'])}
            expected_usages = {(sf[name]['id'], tf[relation.get('mapping', {}).get(name, name)]['id'])
                               for name in relation['fields']}
            usages = service.get_field_usages(e['id'])
            if (sorted(actual_bindings, key=lambda b: b['branch']) != sorted(expected_bindings, key=lambda b: b['branch']) or e['rationale'] != relation['note_zh']
                    or e['transformation'] != relation['note_zh']
                    or {(u['source_field_id'], u['target_field_id']) for u in usages} != expected_usages
                    or any(u['usage_note'] != relation['note_zh'] for u in usages)):
                raise ValueError('SS-135 changed relation/mapping; preserve for review')
        new_revision = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
        occupied = service.graph()['nodes']
        for c in spec['cards']:
            n = originals.get(c['key'])
            collision = service.find_name(c['name'])
            if collision and (not n or collision['id'] != n['id']):
                raise ValueError('SS-135 new card name conflict')
            if not n:
                if service.find_name(c['name']):
                    raise ValueError('SS-135 new card name conflict')
                anchor = originals['compose']
                x, y = anchor['position_x'] + 420, anchor['position_y']
                while any(abs(other['position_x'] - x) < 350 and abs(other['position_y'] - y) < 180 for other in occupied):
                    x += 420
                n = service.create_node({'name': c['name'], 'kind': c['kind'], 'workflow_lane': 'knowledge',
                                         'position_x': x, 'position_y': y}, actor=ACTOR, commit=False)
                occupied.append(n)
            before = copy.deepcopy(service.get_node(n['id']))
            db.execute('UPDATE nodes SET name=?,definition=?,formula=?,trigger_rule=?,notes=?,caveats=?,updated_at=? WHERE id=?',
                       (c['name'], c['description_zh'], c['algorithm_zh'], c['trigger_zh'], PATH,
                        spec['provenance_zh'], now(), n['id']))
            service._event(ACTOR, 'update', 'node', n['id'], before=before, after=service.get_node(n['id']))
            fields = {f['name']: f for f in service.get_fields(n['id'])}
            for f in c['fields']:
                if f['name'] not in fields:
                    service.create_field(n['id'], {'name': f['name'], 'data_type': f['type'],
                                                  'definition': f['label_zh']}, actor=ACTOR, commit=False)
                elif fields[f['name']]['definition'] != f['label_zh']:
                    previous = fields[f['name']]
                    db.execute('UPDATE node_fields SET definition=?,updated_at=? WHERE id=?', (f['label_zh'], now(), previous['id']))
                    service._event(ACTOR, 'update', 'field', previous['id'], before=previous, after=service.get_field(previous['id']))
            before_cfg = model.contract(n['id'])['config']
            cfg = copy.deepcopy(before_cfg)
            ref = {'path': PATH, 'revision': new_revision, 'selector': {'key': c['key']}}
            cfg.update(definition_refs=[ref], resource={'asset_webpage_flow': c['key'], 'delivery': 'studio_design_only',
                       'owner': c['owner_zh'], 'physical_binding': None, 'board_handoff': spec['handoff']},
                       trigger={'kind': 'unspecified', 'configuration_ref': ref}, branches=c['branches'],
                       action={'id': '', 'version': 1, 'implementation': 'unknown'})
            if c['key'] == 'rules':
                cfg['resource']['role'] = 'documentation_reference'
            model.validate_config(cfg, c['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), n['id']))
            model.ensure_node(service.get_node(n['id']))
            service._event(ACTOR, 'update', 'node_contract', n['id'], before=before_cfg, after=cfg)
            nodes[c['name']] = service.get_node(n['id'])
        # Reuse all existing edge and field IDs; add question/record mappings and inert references only.
        for relation in spec['connections']:
            source, target = nodes[relation['source']], nodes[relation['target']]
            edge = db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?', (source['id'], target['id'])).fetchone()
            if not edge:
                edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                    'rationale': relation['note_zh'], 'transformation': relation['note_zh'],
                    'bindings': [{'kind': 'reference', 'branch': '',
                                  'source_port_id': stable(source['id'], 'output', 'out'),
                                  'target_port_id': stable(target['id'], 'input', 'in'),
                                  'config': {'trigger': 'none', 'role': 'documentation_reference'}}]}, actor=ACTOR, commit=False)
            sf = {f['name']: f for f in service.get_fields(source['id'])}
            tf = {f['name']: f for f in service.get_fields(target['id'])}
            existing = {(u['source_field_id'], u['target_field_id']) for u in service.get_field_usages(edge['id'])}
            for name in relation['fields']:
                source_id, target_id = sf[name]['id'], tf[relation.get('mapping', {}).get(name, name)]['id']
                if (source_id, target_id) not in existing:
                    service.create_field_usage(edge['id'], {'source_field_id': source_id, 'target_field_id': target_id,
                                                           'usage_note': relation['note_zh']}, actor=ACTOR, commit=False)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-135 invalid three-round board')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'specification': PATH, 'rounds': 3})
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, '1'))
        db.commit()
    except Exception:
        db.rollback()
        raise
