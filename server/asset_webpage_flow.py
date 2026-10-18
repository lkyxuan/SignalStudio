"""Replace the retired per-information content design with the current webpage flow."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/asset-webpage-flow.v1.json'
MARKER = 'asset_webpage_flow_ss116_v1'
ACTOR = 'ss116-current-webpage-flow'


def ensure_asset_webpage_flow(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    model = CardModel(service)
    names = {c['name'] for c in spec['cards']} | set(spec['retired_cards'])
    names |= {e['source'] for e in spec['connections']} | {e['target'] for e in spec['connections']}
    nodes = {name: service.find_name(name) for name in names}
    if not model.enabled() or not all(nodes.values()):
        raise ValueError('SS-116 webpage cleanup requires the existing flow cards')
    retired = {nodes[name]['id'] for name in spec['retired_cards']}
    owned = {n['id'] for n in nodes.values()}
    for name in spec['retired_cards']:
        cfg = model.contract(nodes[name]['id'])['config']
        if cfg.get('read_only') or cfg.get('resource', {}).get('observed_rows'):
            raise ValueError('SS-116 retired card has protected/imported data; review before removal')
    # Do not remove an unexpected user's outside flow while retiring these three cards.
    for edge in db.execute('SELECT * FROM edges'):
        if (edge['upstream_id'] in retired or edge['downstream_id'] in retired) and not {edge['upstream_id'], edge['downstream_id']}.issubset(owned):
            raise ValueError('SS-116 retired card has an unrelated connection; preserve for review')
    digest = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    db.execute('BEGIN IMMEDIATE')
    try:
        for name in spec['retired_cards']:
            node = nodes[name]
            edges = [dict(e) for e in db.execute('SELECT * FROM edges WHERE upstream_id=? OR downstream_id=?', (node['id'], node['id']))]
            for edge in edges:
                for usage in service.get_field_usages(edge['id']):
                    service._event(ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
                service._event(ACTOR, 'delete', 'edge', edge['id'], before=edge)
            for field in service.get_fields(node['id']):
                service._event(ACTOR, 'delete', 'field', field['id'], before=field)
            service._event(ACTOR, 'delete', 'node', node['id'], before=node)
            db.execute('DELETE FROM nodes WHERE id=?', (node['id'],))
        for card in spec['cards']:
            node = nodes[card['name']]
            fields = {f['name']: f for f in service.get_fields(node['id'])}
            for f in card['fields']:
                if f['name'] not in fields:
                    fields[f['name']] = service.create_field(node['id'], {'name': f['name'], 'data_type': f['type'],
                        'definition': f['label_zh']}, actor=ACTOR, commit=False)
            db.execute('UPDATE nodes SET definition=?,formula=?,trigger_rule=?,caveats=?,notes=?,updated_at=? WHERE id=?',
                       (card['description_zh'], card['algorithm_zh'], card['trigger_zh'], spec['provenance_zh'], PATH, now(), node['id']))
            service._event(ACTOR, 'update', 'node', node['id'], before=node, after=service.get_node(node['id']))
            before = model.contract(node['id'])['config']
            if before.get('read_only'):
                raise ValueError('SS-116 cannot change protected current flow')
            cfg = copy.deepcopy(before)
            ref = {'path': PATH, 'revision': digest, 'selector': {'key': card['key']}}
            cfg['definition_refs'] = [ref]
            cfg['resource'].pop('legacy_settings_ref', None)
            cfg['resource'].update(delivery='studio_design_only', asset_webpage_flow=card['key'])
            cfg['trigger'] = {'kind': 'unspecified', 'configuration_ref': ref}
            if card['key'] == 'decision':
                cfg['actor'] = 'automatic'
                cfg['branches'] = spec['branches']
                cfg.setdefault('page_read', {})['page_refresh_interval_seconds'] = None
            if card['key'] == 'gap':
                cfg['actor'] = 'automatic'
                cfg['branches'] = [
                    {'id': 'need_search', 'label_zh': '搜索补缺', 'label_en': 'Search', 'condition': '本次需要补搜或资料有必要缺口。', 'terminal': False},
                    {'id': 'enough', 'label_zh': '资料足够', 'label_en': 'Enough data', 'condition': '免搜索策略启用且所需资料完整有效。', 'terminal': False},
                    {'id': 'blocked', 'label_zh': '待核对', 'label_en': 'Needs review', 'condition': '资料或来源不可用，不能继续组装。', 'terminal': True}]
            if card['key'] == 'cache':
                cfg['resource'].update(primary_key=['asset_id', 'query_key'], observed_rows=[], physical_binding=None)
            model.validate_config(cfg, model.contract(node['id'])['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))
            service._event(ACTOR, 'update', 'node_contract', node['id'], before=before, after=cfg)
        for relation in spec['connections']:
            source, target = nodes[relation['source']], nodes[relation['target']]
            edge = db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?', (source['id'], target['id'])).fetchone()
            if edge:
                edge = dict(edge)
                for usage in service.get_field_usages(edge['id']):
                    service._event(ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
                db.execute('DELETE FROM edge_field_usages WHERE edge_id=?', (edge['id'],))
            else:
                edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                    'transport_kind': 'direct', 'rationale': relation['note_zh']}, actor=ACTOR, commit=False)
            db.execute('UPDATE edges SET rationale=?,transformation=? WHERE id=?', (relation['note_zh'], relation['note_zh'], edge['id']))
            db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            kind = 'read' if model.contract(source['id'])['kind'] == 'table' else 'write' if model.contract(target['id'])['kind'] == 'table' else 'control' if model.contract(source['id'])['kind'] == 'decision' else 'data'
            for branch in relation.get('branches', [relation.get('branch', '')]):
                model.add_binding(edge, {'kind': kind, 'branch': branch,
                    'source_port_id': stable(source['id'], 'output', 'out'),
                    'target_port_id': stable(target['id'], 'input', 'in'),
                    'config': {'trigger': 'none' if kind == 'read' else 'event',
                               **({'role': 'asset_page_refresh_read', 'lookup_key': 'asset_id'} if relation['source'] == 'asset_pages' else {})}})
            sf = {f['name']: f for f in service.get_fields(source['id'])}
            tf = {f['name']: f for f in service.get_fields(target['id'])}
            for name in relation['fields']:
                target_name = relation.get('mapping', {}).get(name, name)
                if name not in sf or target_name not in tf:
                    raise ValueError('SS-116 missing current mapping: ' + relation['source'] + '.' + name)
                service.create_field_usage(edge['id'], {'source_field_id': sf[name]['id'], 'target_field_id': tf[target_name]['id'],
                    'usage_note': relation['note_zh']}, actor=ACTOR, commit=False)
        for card in spec['cards']:
            wanted = {f['name'] for f in card['fields']}
            for f in service.get_fields(nodes[card['name']]['id']):
                if f['name'] in wanted:
                    continue
                if db.execute('SELECT 1 FROM edge_field_usages WHERE source_field_id=? OR target_field_id=?', (f['id'], f['id'])).fetchone() or db.execute('SELECT 1 FROM data_requirements WHERE source_field_id=?', (f['id'],)).fetchone():
                    raise ValueError('SS-116 obsolete field has unrelated uses: ' + card['name'] + '.' + f['name'])
                service._event(ACTOR, 'delete', 'field', f['id'], before=f)
                db.execute('DELETE FROM node_fields WHERE id=?', (f['id'],))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-116 invalid current webpage flow')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'retired': spec['retired_cards']})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))
        db.commit()
    except Exception:
        db.rollback()
        raise
