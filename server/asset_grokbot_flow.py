"""SS-120: consolidate webpage production as one unconnected Grokbot boundary."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/asset-grokbot-flow.v1.json'
MARKER = 'asset_grokbot_flow_ss120_v1'
ACTOR = 'ss120-grokbot-webpage-boundary'
ACCESS_MARKER = 'asset_grokbot_access_ss121_fewunderstand_v1'


def ensure_asset_grokbot_flow(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        _ensure_data_access_description(service)
        return
    spec = json.loads((ROOT / PATH).read_text())
    previous = json.loads((ROOT / 'catalog/asset-webpage-flow.v1.json').read_text())
    model = CardModel(service)
    names = {c['name'] for c in previous['cards']}
    names |= {e[k] for e in previous['connections'] for k in ('source', 'target')}
    nodes = {name: service.find_name(name) for name in names}
    if not model.enabled() or not all(nodes.values()):
        raise ValueError('SS-120 requires the existing SS-116 flow')
    grokbot = next(c for c in spec['cards'] if c['key'] == 'grokbot')
    if service.find_name(grokbot['name']):
        raise ValueError('SS-120 Grokbot name conflict; preserve for review')
    changed = {spec['reused_card'], *spec['retired_cards']}
    changed_ids = {nodes[n]['id'] for n in changed}
    expected_edges = {(nodes[e['source']]['id'], nodes[e['target']]['id']) for e in previous['connections']}
    # Refuse to silently erase later user work attached to any absorbed step.
    for edge in db.execute('SELECT * FROM edges'):
        if {edge['upstream_id'], edge['downstream_id']} & changed_ids and (edge['upstream_id'], edge['downstream_id']) not in expected_edges:
            raise ValueError('SS-120 unrelated connection; preserve for review')
    for name in changed | {c['name'] for c in spec['cards'] if c['key'] != 'grokbot'}:
        node = nodes[name]
        cfg = model.contract(node['id'])['config']
        resource = cfg.get('resource', {})
        if (cfg.get('read_only') or resource.get('observed_rows') or
                resource.get('physical_binding') not in (None, 'unconnected') or
                not any(r['path'] == 'catalog/asset-webpage-flow.v1.json' for r in cfg['definition_refs'])):
            raise ValueError('SS-120 protected, imported or changed card; preserve for review')
    # The record table gains only a write relation; its schema/config remain intact.
    if model.contract(nodes['asset_pages']['id'])['config'].get('read_only'):
        raise ValueError('SS-120 protected webpage record')
    field_ids = {f['id'] for n in changed for f in service.get_fields(nodes[n]['id'])}
    for r in db.execute('SELECT * FROM data_requirements'):
        if r['node_id'] in changed_ids or r['source_field_id'] in field_ids:
            raise ValueError('SS-120 material step has data requirements; preserve for review')
    for usage in db.execute('SELECT u.*,e.upstream_id,e.downstream_id FROM edge_field_usages u JOIN edges e ON e.id=u.edge_id'):
        if {usage['source_field_id'], usage['target_field_id']} & field_ids and (usage['upstream_id'], usage['downstream_id']) not in expected_edges:
            raise ValueError('SS-120 unrelated field usage; preserve for review')
    digest = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    db.execute('BEGIN IMMEDIATE')
    try:
        # All relations involving the absorbed steps are replaced by the boundary's I/O.
        edges = [dict(e) for e in db.execute('SELECT * FROM edges') if {e['upstream_id'], e['downstream_id']} & changed_ids]
        for edge in edges:
            for usage in service.get_field_usages(edge['id']):
                service._event(ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
            service._event(ACTOR, 'delete', 'edge', edge['id'], before=edge)
            db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
        for name in spec['retired_cards']:
            node = nodes[name]
            for field in service.get_fields(node['id']):
                service._event(ACTOR, 'delete', 'field', field['id'], before=field)
            service._event(ACTOR, 'delete', 'node', node['id'], before=node)
            db.execute('DELETE FROM nodes WHERE id=?', (node['id'],))
        nodes[grokbot['name']] = nodes[spec['reused_card']]
        for card in spec['cards']:
            node = nodes[card['name']]
            fields = {f['name']: f for f in service.get_fields(node['id'])}
            if card['key'] == 'grokbot':
                for field in list(fields.values()):
                    if field['name'] not in {f['name'] for f in card['fields']}:
                        service._event(ACTOR, 'delete', 'field', field['id'], before=field)
                        db.execute('DELETE FROM node_fields WHERE id=?', (field['id'],))
                for f in card['fields']:
                    if f['name'] not in fields:
                        service.create_field(node['id'], {'name': f['name'], 'data_type': f['type'], 'definition': f['label_zh']}, actor=ACTOR, commit=False)
                    else:
                        db.execute('UPDATE node_fields SET definition=?,data_type=? WHERE id=?', (f['label_zh'], f['type'], fields[f['name']]['id']))
            db.execute('UPDATE nodes SET name=?,definition=?,formula=?,trigger_rule=?,caveats=?,notes=?,updated_at=? WHERE id=?',
                       (card['name'], card['description_zh'], card['algorithm_zh'], card['trigger_zh'], spec['provenance_zh'], PATH, now(), node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
            before = model.contract(node['id'])['config']
            cfg = copy.deepcopy(before)
            ref = {'path': PATH, 'revision': digest, 'selector': {'key': card['key']}}
            cfg['definition_refs'] = [ref]
            cfg['resource'] = {'delivery': 'studio_design_only', 'asset_webpage_flow': card['key']}
            cfg['trigger'] = {'kind': 'unspecified', 'configuration_ref': ref}
            if card['key'] == 'grokbot':
                cfg['resource'].update(internal_workflow='research_pending', workflow_version=None,
                                       tools_binding=None, physical_binding=None,
                                       data_access=copy.deepcopy(card['data_access']))
                cfg['action'] = {'id': '', 'implementation': 'unknown', 'version': 1}
            model.validate_config(cfg, model.contract(node['id'])['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))
            service._event(ACTOR, 'update', 'node_contract', node['id'], before=before, after=cfg)
        for relation in spec['connections']:
            source, target = nodes[relation['source']], nodes[relation['target']]
            # Candidate->decision and page-table->decision remain untouched.
            if source['id'] not in changed_ids and target['id'] not in changed_ids:
                continue
            kind = relation.get('kind', 'read' if model.contract(source['id'])['kind'] == 'table' else 'control')
            bindings = [{'kind': kind, 'branch': branch,
                         'source_port_id': stable(source['id'], 'output', 'out'),
                         'target_port_id': stable(target['id'], 'input', 'in'),
                         'config': relation.get('config', {'trigger': 'none' if kind == 'read' else 'event'})}
                        for branch in relation.get('branches', [''])]
            edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                                        'rationale': relation['note_zh'], 'transformation': relation['note_zh'],
                                        'bindings': bindings}, actor=ACTOR, commit=False)
            sf = {f['name']: f for f in service.get_fields(source['id'])}
            tf = {f['name']: f for f in service.get_fields(target['id'])}
            for name in relation['fields']:
                service.create_field_usage(edge['id'], {'source_field_id': sf[name]['id'],
                    'target_field_id': tf[relation.get('mapping', {}).get(name, name)]['id'],
                    'usage_note': relation['note_zh']}, actor=ACTOR, commit=False)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-120 invalid consolidated flow')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'retired': spec['retired_cards'], 'reused': nodes[grokbot['name']]['id']})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (ACCESS_MARKER, '1'))
        db.commit()
    except Exception:
        db.rollback()
        raise


def _ensure_data_access_description(service):
    """Correct the business-data boundary to Few Understand on existing hosts."""
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (ACCESS_MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    model = CardModel(service)
    revision = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    db.execute('BEGIN IMMEDIATE')
    try:
        for card in spec['cards']:
            node = service.find_name(card['name'])
            if not node:
                raise ValueError('SS-120 missing consolidated card')
            before = model.contract(node['id'])['config']
            if before.get('read_only') or not any(r['path'] == PATH for r in before['definition_refs']):
                raise ValueError('SS-120 changed consolidated card; preserve for review')
            cfg = copy.deepcopy(before)
            ref = {'path': PATH, 'revision': revision, 'selector': {'key': card['key']}}
            cfg['definition_refs'] = [ref]
            cfg['trigger']['configuration_ref'] = ref
            if card['key'] == 'grokbot':
                cfg['resource']['data_access'] = copy.deepcopy(card['data_access'])
            model.validate_config(cfg, model.contract(node['id'])['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))
            service._event(ACTOR, 'update', 'node_contract', node['id'], before=before, after=cfg)
            db.execute('UPDATE nodes SET formula=?,updated_at=? WHERE id=?', (card['algorithm_zh'], now(), node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (ACCESS_MARKER, '1'))
        db.commit()
    except Exception:
        db.rollback()
        raise
