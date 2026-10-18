"""SS-116: keep #1039 as one current webpage record per asset, not a version ledger."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/asset-pages.v1.json'
MARKER = 'asset_pages_current_ss116_v1'
ACTOR = 'ss116-current-asset-pages'


def ensure_asset_pages(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    model = CardModel(service)
    source, target = service.find_name('asset_page_versions'), service.find_name('刷新判断')
    if not source or not target or service.find_name('asset_pages'):
        raise ValueError('SS-116 current-page upgrade requires the existing history card without name conflicts')
    sf = {f['name']: f for f in service.get_fields(source['id'])}
    tf = {f['name']: f for f in service.get_fields(target['id'])}
    if not {'asset_id', 'page_ref', 'page_version_id', 'generated_at'}.issubset(sf) or not {'page_version_id', 'generated_at'}.issubset(tf):
        raise ValueError('SS-116 missing fields for current-page upgrade')
    if 'updated_at' in sf or 'page_updated_at' in tf:
        raise ValueError('SS-116 current-page field conflict')
    for field, owner in ((sf['page_version_id'], 'ss116-webpage-history-design'),
                         (sf['generated_at'], 'ss116-webpage-history-design'),
                         (tf['page_version_id'], 'ss116-page-refresh-link'),
                         (tf['generated_at'], 'ss116-page-refresh-link')):
        if not db.execute("SELECT 1 FROM change_events WHERE actor=? AND action='create' AND entity='field' AND entity_id=?",
                          (owner, field['id'])).fetchone():
            raise ValueError('SS-116 unowned field; preserve for review')
    edges = [dict(r) for r in db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?', (source['id'], target['id']))]
    if len(edges) != 1:
        raise ValueError('SS-116 requires one existing page read relation')
    edge = edges[0]
    bindings = db.execute('SELECT * FROM edge_bindings WHERE edge_id=?', (edge['id'],)).fetchall()
    if len(bindings) != 1 or bindings[0]['kind'] != 'read' or json.loads(bindings[0]['config']).get('role') != 'asset_page_refresh_read':
        raise ValueError('SS-116 edited page read binding')
    for field in (sf['page_version_id'], tf['page_version_id']):
        if db.execute('SELECT 1 FROM edge_field_usages WHERE (source_field_id=? OR target_field_id=?) AND edge_id<>?',
                      (field['id'], field['id'], edge['id'])).fetchone() or db.execute(
                      'SELECT 1 FROM data_requirements WHERE source_field_id=?', (field['id'],)).fetchone():
            raise ValueError('SS-116 version field has unrelated references; preserve for review')
    for node in (source, target):
        cfg = model.contract(node['id'])['config']
        if cfg.get('read_only') or cfg.get('resource', {}).get('observed_rows'):
            raise ValueError('SS-116 protected card or imported data requires review')
    ref = {'path': PATH, 'revision': hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest(), 'selector': {'name': 'asset_pages'}}
    db.execute('BEGIN IMMEDIATE')
    try:
        for usage in service.get_field_usages(edge['id']):
            if usage['source_field_id'] == sf['page_version_id']['id'] or usage['target_field_id'] == tf['page_version_id']['id']:
                service._event(ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
                db.execute('DELETE FROM edge_field_usages WHERE id=?', (usage['id'],))
        for field in (sf['page_version_id'], tf['page_version_id']):
            db.execute('DELETE FROM node_fields WHERE id=?', (field['id'],))
            service._event(ACTOR, 'delete', 'field', field['id'], before=field)
        for field, name, definition in (
                (sf['generated_at'], 'updated_at', spec['table']['columns'][2]['label_zh']),
                (tf['generated_at'], 'page_updated_at', '#1039 当前网页最后成功更新时间；不是 #1019 分栏目内容时间')):
            db.execute('UPDATE node_fields SET name=?,definition=? WHERE id=?', (name, definition, field['id']))
            service._event(ACTOR, 'update', 'field', field['id'], before=field, after={'name': name, 'definition': definition})
        db.execute('UPDATE node_fields SET definition=? WHERE id=?', (spec['table']['columns'][1]['label_zh'], sf['page_ref']['id']))
        db.execute('UPDATE nodes SET name=?,definition=?,formula=?,caveats=?,notes=?,updated_at=? WHERE id=?',
                   ('asset_pages', spec['table']['purpose_zh'], '\n'.join(spec['rules_zh']), spec['provenance_zh'], PATH, now(), source['id']))
        service._event(ACTOR, 'update', 'node', source['id'], before=source, after=service.get_node(source['id']))
        definition = target['definition'] + '\n另按候选资产 UUID 查 #1039 当前网页记录，整页更新周期待配置。'
        db.execute('UPDATE nodes SET definition=?,updated_at=? WHERE id=?', (definition, now(), target['id']))
        service._event(ACTOR, 'update', 'node', target['id'], before=target, after=service.get_node(target['id']))
        for node in (source, target):
            before = model.contract(node['id'])['config']
            cfg = copy.deepcopy(before)
            cfg['definition_refs'] = [r for r in cfg['definition_refs'] if r['path'] not in
                                      ('catalog/asset-page-versions.v1.json', 'catalog/asset-page-refresh-link.v1.json')]
            cfg['definition_refs'].append(ref)
            if node['id'] == source['id']:
                cfg['resource'].update({'table_name': 'asset_pages', 'primary_key': ['asset_id']})
            else:
                cfg.pop('page_history_read', None)
                cfg['page_read'] = spec['refresh_read']
            model.validate_config(cfg, model.contract(node['id'])['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))
            service._event(ACTOR, 'update', 'node_contract', node['id'], before=before, after=cfg)
        read_cfg = json.loads(bindings[0]['config'])
        read_cfg['configuration_ref'] = ref
        db.execute('UPDATE edge_bindings SET config=? WHERE id=?', (encoded(read_cfg), bindings[0]['id']))
        db.execute('UPDATE edges SET rationale=?,transformation=? WHERE id=?',
                   ('按候选资产 UUID 读取当前网页位置与最后成功更新时间。', '\n'.join(spec['refresh_read']['rules_zh']), edge['id']))
        for usage in service.get_field_usages(edge['id']):
            db.execute('UPDATE edge_field_usages SET usage_note=? WHERE id=?',
                       ('按 asset_id 读取当前网页；updated_at 对应 page_updated_at，整页周期待配置。', usage['id']))
        if db.execute('PRAGMA foreign_key_check').fetchall():
            raise ValueError('SS-116 invalid current-page schema references')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'node': source['id'], 'edge': edge['id']})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))
        db.commit()
    except Exception:
        db.rollback()
        raise
