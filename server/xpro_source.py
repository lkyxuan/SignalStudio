"""SS-144: install one standalone source definition, never a collector or flow."""
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/xpro-feed-source.v1.json'
MARKER = 'xpro_feed_source_ss144_v1'
ACTOR = 'ss144-xpro-source'


def ensure_xpro_source(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    model = CardModel(service)
    if not model.enabled():
        raise ValueError('X Pro source requires the shared card model')
    spec = json.loads((ROOT / PATH).read_text())
    if service.find_name(spec['name']):
        raise ValueError('X Pro source name conflict; preserve the existing card')
    right = service.db.execute('SELECT COALESCE(MAX(position_x),0) FROM nodes').fetchone()[0] + 600
    revision = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    with service.db:
        node = service.create_node({'name': spec['name'], 'kind': 'source',
            'definition': spec['purpose_zh'], 'caveats': spec['evidence_zh'], 'notes': PATH,
            'position_x': right, 'position_y': 96}, actor=ACTOR, commit=False)
        for field in spec['fields']:
            service.create_field(node['id'], {'name': field['path'], 'data_type': field['type'],
                'definition': field['label_zh'] + '：' + field['description_zh']}, actor=ACTOR, commit=False)
        config = model.contract(node['id'])['config']
        config['definition_refs'] = [{'path': PATH, 'revision': revision, 'selector': {'name': spec['name']}}]
        config['action'].update(id='', implementation='planned')
        config['resource'] = {'provider': 'xpro-feed', 'runtime_enabled': False, 'physical_binding': None}
        model.validate_config(config, 'source')
        service.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(config), node['id']))
        service.db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, revision))
