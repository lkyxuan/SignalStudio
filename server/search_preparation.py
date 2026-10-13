"""SS-87 graph design migration. Never searches, collects or generates content."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/search-preparation.v1.json'
REFRESH = 'catalog/content-refresh.v1.json'
PREVIOUS = ROOT / 'server/migration_snapshots/content-refresh-ss84.json'
MARKER = 'search_preparation_ss87_v1'
ACTOR = 'ss87-search-preparation'


def load(path):
    return json.loads((ROOT / path).read_text())


def digest(path):
    return hashlib.sha256((ROOT / path).read_bytes()).hexdigest()


def ensure_search_preparation(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='new_uuid_board_v1'").fetchone():
        raise ValueError('Search preparation requires SS-84 before SS-87')
    spec, refresh, previous = load(PATH), load(REFRESH), json.loads(PREVIOUS.read_text())
    model = CardModel(service)
    old_stages = {s['key']: s for s in previous['stages']}
    nodes = {s['key']: service.find_name(s['name']) for s in previous['stages']}
    for name in ('asset_identifiers', previous['result']['name']):
        nodes[name] = service.find_name(name)
    if any(n is None for n in nodes.values()):
        raise ValueError('Search preparation missing prerequisite card')
    for key in ('generate', 'decision'):
        n, st = nodes[key], old_stages[key]
        if n['definition'] != st['description_zh'] or n['formula'] != st['algorithm_zh']:
            raise ValueError('Search preparation: edited ' + key + ' definition')
        cfg = model.contract(n['id'])['config']
        if cfg.get('read_only') or cfg['action']['implementation'] not in ('planned', 'unknown'):
            raise ValueError('Search preparation: protected card contract')
    if any(service.find_name(n['name']) for n in spec['nodes']):
        raise ValueError('Search preparation: new card name conflict')
    # Remove just the two producer-owned shortcuts; preserve all user relations.
    old_edges = []
    for source in ('decision', 'asset_identifiers'):
        edges = list(db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?',
                               (nodes[source]['id'], nodes['generate']['id'])))
        if len(edges) != 1 or not db.execute(
                "SELECT 1 FROM change_events WHERE actor='content-refresh-four-stages-v2' AND action='create' AND entity='edge' AND entity_id=?",
                (edges[0]['id'],)).fetchone():
            raise ValueError('Search preparation: changed or unowned shortcut')
        edge = dict(edges[0])
        expected = next(e for e in previous['connections'] if e['source'] == source and e['target'] == 'generate')
        known = {f['id']:f['name'] for n in (nodes[source], nodes['generate']) for f in service.get_fields(n['id'])}
        usages = service.get_field_usages(edge['id'])
        if edge['transformation'] != expected['note_zh'] or len(usages) != len(expected['fields']) or {
                (known.get(u['source_field_id']), known.get(u['target_field_id'])) for u in usages
                } != {(name,name) for name in expected['fields']}:
            raise ValueError('Search preparation: edited shortcut mapping')
        old_edges.append(edge)
    allowed = {digest('server/migration_snapshots/content-refresh-ss84.json'),
               digest('server/migration_snapshots/content-refresh-20261010.json'), digest(REFRESH)}

    def rewrite(value):
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if not isinstance(value, dict):
            return value
        out = {k: rewrite(v) for k, v in value.items()}
        if value.get('path') == REFRESH:
            if value.get('revision') not in allowed:
                raise ValueError('Search preparation: unknown content definition revision')
            out['revision'] = digest(REFRESH)
            if out.get('selector', {}).get('name') == old_stages['generate']['name']:
                out['selector']['name'] = next(s['name'] for s in refresh['stages'] if s['key'] == 'generate')
        return out

    def fields(node, columns):
        existing = {f['name']: f for f in service.get_fields(node['id'])}
        for col in columns:
            if col['name'] not in existing:
                service.create_field(node['id'], {'name': col['name'], 'data_type': col['data_type'],
                    'definition': col['label_zh']}, actor=ACTOR, commit=False)

    def configure(node, definition, key, branches=None):
        cfg = copy.deepcopy(model.contract(node['id'])['config'])
        cfg['definition_refs'] = [{'path': definition, 'revision': digest(definition), 'selector': {'key': key}}]
        cfg['resource'].update(delivery='studio_design_only')
        if key in ('read','search','cache'):
            cfg['resource']['bindings'] = spec['bindings']
        if key == 'gap':
            cfg['actor'] = 'automatic'
            cfg['resource']['search_policy'] = spec['default_search_policy']
        if key == 'cache':
            cfg['resource'].update(primary_key=['query_key'], observed_rows=[], physical_binding=None)
        if branches is not None:
            cfg['branches'] = branches
        # Existing action identity is preserved. New cards remain unbound planned definitions.
        cfg['trigger'] = {'kind': 'unspecified', 'configuration_ref': cfg['definition_refs'][0]}
        model.validate_config(cfg, model.contract(node['id'])['kind'])
        db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))
        model.ensure_node(service.get_node(node['id']))

    db.execute('BEGIN IMMEDIATE')
    try:
        for edge in old_edges:
            for usage in service.get_field_usages(edge['id']):
                service._event(ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
            service._event(ACTOR, 'delete', 'edge', edge['id'], before=edge)
            db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
        for key in ('generate','decision'):
            node = nodes[key]
            stage = next(s for s in refresh['stages'] if s['key'] == key)
            db.execute('UPDATE nodes SET name=?,definition=?,formula=?,trigger_rule=?,updated_at=? WHERE id=?',
                       (stage['name'], stage['description_zh'], stage['algorithm_zh'], stage['trigger_zh'], now(), node['id']))
            fields(node, stage['fields'])
            service._event(ACTOR, 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
        generator = nodes['generate']
        x = generator['position_x'] - 2100
        y = max(row[0] for row in db.execute('SELECT position_y FROM nodes')) + 400
        # New cards get their own clear two-lane area. Existing saved positions never move.
        layout = {'read': (0,0), 'gap': (420,0), 'search': (840,300), 'cache': (1260,540), 'assemble': (1680,0)}
        for entry in spec['nodes']:
            dx, dy = layout[entry['key']]
            node = service.create_node({'name': entry['name'], 'kind': entry['kind'], 'workflow_lane': 'shared',
                'definition': entry['description_zh'], 'formula': entry['algorithm_zh'],
                'trigger_rule': entry['trigger_zh'], 'caveats': spec['limitations_zh'], 'notes': PATH,
                'position_x': x + dx, 'position_y': y + dy}, actor=ACTOR, commit=False)
            nodes[entry['key']] = node
            fields(node, entry['fields'])
            configure(node, PATH, entry['key'], spec['branches'] if entry['key'] == 'gap' else None)
        for edge_spec in spec['connections']:
            source, target = nodes[edge_spec['source']], nodes[edge_spec['target']]
            edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                'transport_kind': 'direct', 'rationale': 'SS-87已批准设计依赖，不证明真实运行。',
                'transformation': edge_spec['note_zh']}, actor=ACTOR, commit=False)
            db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            for branch in edge_spec.get('branches', ['']):
                model.add_binding(edge, {'kind': edge_spec['kind'], 'branch': branch,
                    'source_port_id': stable(source['id'], 'branch', branch) if branch else stable(source['id'], 'output', 'out'),
                    'target_port_id': stable(target['id'], 'input', 'in'),
                    'config': {'trigger': 'none', 'completion': 'completed' if edge_spec['source']=='search' else 'success',
                               'unresolved': [], 'role': 'search_preparation'} })
            sf = {f['name']:f['id'] for f in service.get_fields(source['id'])}
            tf = {f['name']:f['id'] for f in service.get_fields(target['id'])}
            for name in edge_spec['fields']:
                service.create_field_usage(edge['id'], {'source_field_id': sf[name], 'target_field_id': tf[name],
                    'usage_note': edge_spec['note_zh']}, actor=ACTOR, commit=False)
        configure(nodes['generate'], REFRESH, 'generate')
        # Advance only known references; unrelated config and reports remain intact.
        for row in db.execute('SELECT node_id,kind,config FROM node_contracts').fetchall():
            before = json.loads(row['config'])
            after = rewrite(before)
            if after != before:
                if before.get('read_only'):
                    raise ValueError('Search preparation: protected reference')
                model.validate_config(after, row['kind'])
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(after), row['node_id']))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Search preparation: invalid graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER,
            after={'new_nodes': [nodes[n['key']]['id'] for n in spec['nodes']], 'search_policy': spec['default_search_policy']})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, spec['revision']))
        db.commit()
    except Exception:
        db.rollback()
        raise
