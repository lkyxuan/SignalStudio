"""Install SS-116's webpage history design card, without creating a business table."""
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/asset-page-versions.v1.json'
MARKER = 'asset_page_versions_ss116_v1'
ACTOR = 'ss116-webpage-history-design'


def ensure_asset_page_versions(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    model = CardModel(service)
    assets = service.find_name('assets')
    if not model.enabled() or not assets:
        raise ValueError('SS-116 requires the existing asset identity card and card model')
    source_fields = {f['name']: f['id'] for f in service.get_fields(assets['id'])}
    if 'asset_id' not in source_fields:
        raise ValueError('SS-116 requires assets.asset_id')
    if service.find_name(spec['table']['name']):
        raise ValueError('SS-116 card name conflict; review existing card')
    y = (db.execute('SELECT MAX(position_y) FROM nodes').fetchone()[0] or 0) + 400
    db.execute('BEGIN IMMEDIATE')
    try:
        table = spec['table']
        node = service.create_node({'name': table['name'], 'kind': 'table', 'workflow_lane': 'shared',
            'definition': table['purpose_zh'], 'formula': '\n'.join(spec['rules_zh']),
            'caveats': spec['provenance_zh'], 'notes': PATH,
            'position_x': assets['position_x'], 'position_y': y}, actor=ACTOR, commit=False)
        for column in table['columns']:
            service.create_field(node['id'], {'name': column['name'], 'data_type': column['type'],
                'definition': column['label_zh']}, actor=ACTOR, commit=False)
        cfg = model.contract(node['id'])['config']
        cfg['definition_refs'] = [{'path': PATH,
            'revision': hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest(),
            'selector': {'name': table['name']}}]
        cfg['resource'] = {'delivery': 'studio_design_only', 'table_name': table['name'],
            'primary_key': table['primary_key'], 'physical_binding': 'unconnected', 'observed_rows': []}
        cfg['action'] = {'id': '', 'version': 1, 'implementation': 'unknown'}
        cfg['trigger'] = {'kind': 'unspecified'}
        model.validate_config(cfg, 'table')
        db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?',
                   (encoded(cfg), node['id']))
        edge = service.create_edge({'upstream_id': assets['id'], 'downstream_id': node['id'],
            'transport_kind': 'direct', 'rationale': spec['relation_zh'],
            'transformation': 'asset_id 引用 assets 的同一 UUID；不复制实体、不执行写入。'},
            actor=ACTOR, commit=False)
        db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
        model.add_binding(edge, {'kind': 'reference', 'branch': '',
            'source_port_id': stable(assets['id'], 'output', 'out'),
            'target_port_id': stable(node['id'], 'input', 'in'),
            'config': {'trigger': 'none', 'role': 'asset_page_identity_reference'}})
        target = next(f for f in service.get_fields(node['id']) if f['name'] == 'asset_id')
        service.create_field_usage(edge['id'], {'source_field_id': source_fields['asset_id'],
            'target_field_id': target['id'], 'usage_note': spec['relation_zh']}, actor=ACTOR, commit=False)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-116 invalid design graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER, after={'node': node['id']})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, str(spec['version'])))
        db.commit()
    except Exception:
        db.rollback()
        raise
