"""Correct SS-116's design links; no runtime reader or generator is executed."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/asset-page-refresh-link.v1.json'
MARKER = 'asset_page_refresh_link_ss116_v1'
ACTOR = 'ss116-page-refresh-link'


def ensure_asset_page_refresh_link(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    model = CardModel(service)
    names = ('assets', spec['source'], spec['target'], spec['candidates'])
    nodes = {name: service.find_name(name) for name in names}
    if not model.enabled() or not all(nodes.values()):
        raise ValueError('SS-116 page links require existing identity, history, candidate and decision cards')
    assets, source, target, candidates = (nodes[name] for name in names)
    if model.contract(target['id'])['kind'] != 'decision':
        raise ValueError('SS-116 refresh target must be the existing decision card')
    if not db.execute('SELECT 1 FROM edges WHERE upstream_id=? AND downstream_id=?',
                      (candidates['id'], target['id'])).fetchone():
        raise ValueError('SS-116 missing candidate handoff; refusing to invent it')
    sf = {f['name']: f for f in service.get_fields(source['id'])}
    tf = {f['name']: f for f in service.get_fields(target['id'])}
    af = {f['name']: f for f in service.get_fields(assets['id'])}
    if not set(spec['read_fields']).issubset(sf) or 'asset_id' not in tf:
        raise ValueError('SS-116 missing page lookup fields')
    def normalized_type(value):
        return 'text' if value.lower() in ('text', 'string') else value.lower()
    for name in spec['read_fields']:
        if name in tf and normalized_type(tf[name]['data_type']) != normalized_type(sf[name]['data_type']):
            raise ValueError('SS-116 conflicting decision input field: ' + name)
    old_edges = [dict(row) for row in db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?',
                                               (assets['id'], source['id']))]
    if len(old_edges) != 1:
        raise ValueError('SS-116 identity reference changed; review before replacing')
    old = old_edges[0]
    base = json.loads((ROOT / 'catalog/asset-page-versions.v1.json').read_text())
    old_usages = service.get_field_usages(old['id'])
    if (old['rationale'] != base['relation_zh'] or
            old['transformation'] != 'asset_id 引用 assets 的同一 UUID；不复制实体、不执行写入。' or
            len(old_usages) != 1 or old_usages[0]['target_field_id'] != sf['asset_id']['id'] or
            old_usages[0]['source_field_id'] != af.get('asset_id', {}).get('id')):
        raise ValueError('SS-116 identity line was edited; preserve it for review')
    bindings = [dict(row) for row in db.execute('SELECT * FROM edge_bindings WHERE edge_id=?', (old['id'],))]
    if (len(bindings) != 1 or bindings[0]['kind'] != 'reference' or
            json.loads(bindings[0]['config']).get('role') != 'asset_page_identity_reference' or
            not db.execute("SELECT 1 FROM change_events WHERE actor=? AND action='create' AND entity='edge' AND entity_id=?",
                           ('ss116-webpage-history-design', old['id'])).fetchone()):
        raise ValueError('SS-116 identity line is edited or unowned; preserve it for review')
    if db.execute('SELECT 1 FROM edges WHERE upstream_id=? AND downstream_id=?',
                  (source['id'], target['id'])).fetchone():
        raise ValueError('SS-116 page read line already exists; review instead of duplicating')
    for node in (source, target):
        if model.contract(node['id'])['config'].get('read_only'):
            raise ValueError('SS-116 cannot edit protected card definitions')
    ref = {'path': PATH, 'revision': hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest(),
           'selector': {'key': 'whole_page_history_read'}}
    db.execute('BEGIN IMMEDIATE')
    try:
        for usage in service.get_field_usages(old['id']):
            service._event(ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
        service._event(ACTOR, 'delete', 'edge', old['id'], before=old)
        db.execute('DELETE FROM edges WHERE id=?', (old['id'],))
        for name in spec['read_fields']:
            if name not in tf:
                tf[name] = service.create_field(target['id'], {'name': name,
                    'data_type': sf[name]['data_type'], 'definition': sf[name]['definition']},
                    actor=ACTOR, commit=False)
        for node in (source, target):
            before = model.contract(node['id'])['config']
            cfg = copy.deepcopy(before)
            cfg['definition_refs'].append(ref)
            if node['id'] == target['id']:
                cfg['page_history_read'] = {'source': spec['source'], 'lookup_key': 'asset_id',
                    'fields': spec['read_fields'], 'page_refresh_interval_seconds': None,
                    'delivery': 'studio_design_only'}
            model.validate_config(cfg, model.contract(node['id'])['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?',
                       (encoded(cfg), node['id']))
            service._event(ACTOR, 'update', 'node_contract', node['id'], before=before, after=cfg)
        edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
            'transport_kind': 'direct', 'rationale': '按候选资产 UUID 读取整页网页制作历史，供刷新判断。',
            'transformation': '\n'.join(spec['rules_zh'])}, actor=ACTOR, commit=False)
        db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
        model.add_binding(edge, {'kind': 'read', 'branch': '',
            'source_port_id': stable(source['id'], 'output', 'out'),
            'target_port_id': stable(target['id'], 'input', 'in'),
            'config': {'trigger': 'none', 'role': 'asset_page_refresh_read',
                'lookup_key': 'asset_id', 'configuration_ref': ref}})
        for name in spec['read_fields']:
            service.create_field_usage(edge['id'], {'source_field_id': sf[name]['id'],
                'target_field_id': tf[name]['id'], 'usage_note': '按候选 asset_id 查最近成功网页版本；整页时限待配置。'},
                actor=ACTOR, commit=False)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-116 invalid page read graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'edge': edge['id']})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, str(spec['version'])))
        db.commit()
    except Exception:
        db.rollback()
        raise
