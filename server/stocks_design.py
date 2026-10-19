# coding: utf-8
"""SS-127 additive design installation. Does not collect, schedule or rank."""
import hashlib
import json
from pathlib import Path
from urllib.parse import quote
from card_model import CardModel, encoded, stable

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/coingecko-stocks.v1.json'
MARKER = 'coingecko_stocks_design_ss127_v1'
ACTOR = 'ss127-stocks-design'


def ensure_stocks_design(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    model = CardModel(service)
    if not model.enabled():
        raise ValueError('Stocks design requires the shared card model')
    spec = json.loads((ROOT / PATH).read_text())
    if any(service.find_name(c['name']) for c in spec['cards']):
        raise ValueError('Stocks design card name conflict; preserve the existing design')
    shared = {r['target']: service.find_name(r['target']) for r in spec['shared_references']}
    if not all(shared.values()):
        raise ValueError('Stocks design requires shared assets and identifiers')
    # Allocate a new area only. Never rearrange existing cards or display overrides.
    right = db.execute('SELECT COALESCE(MAX(position_x),0) FROM nodes').fetchone()[0] + 1000
    revision = hashlib.sha256((ROOT/PATH).read_bytes()).hexdigest()
    db.execute('BEGIN IMMEDIATE')
    try:
        nodes = {}
        for card in spec['cards']:
            node = service.create_node({'name': card['name'], 'kind': card['kind'], 'workflow_lane': 'shared',
                'definition': card['purpose_zh'], 'formula': card['purpose_zh'] if card['kind']=='process' else '',
                'trigger_rule': '设计：由 Stocks 采集轮次驱动；频率待权限/额度核验，未启动定时器。',
                'caveats': spec['policy']['limits_zh'], 'notes': PATH,
                'position_x': right + card['position'][0], 'position_y': 96 + card['position'][1]}, actor=ACTOR, commit=False)
            nodes[card['key']] = node
            operation = next((o for o in spec['operations'] if o['key']==card['key']), None)
            fields = operation['fields'] if operation else card['fields']
            for field in fields:
                service.create_field(node['id'], {'name': field['path'], 'data_type': field['type'],
                    'definition': field.get('description') or field['label_zh']}, actor=ACTOR, commit=False)
            config = model.contract(node['id'])['config']
            config.update(definition_refs=[{'path': PATH, 'revision': revision, 'selector': {'key': card['key']}},
                {'path': 'catalog/coingecko-stocks-observed.v1.json',
                 'revision': hashlib.sha256((ROOT/'catalog/coingecko-stocks-observed.v1.json').read_bytes()).hexdigest(),
                 'selector': {'key': card['key']}}])
            config['action'].update(id='', implementation='planned')
            config['resource'] = {'stocks_key': card['key'], 'market_scope': 'tokenized_stocks',
                'delivery': 'studio_design_only', 'physical_binding': None, 'runtime_enabled': False}
            model.validate_config(config, card['kind'])
            db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(config), node['id']))
        for link in spec['connections'] + spec['shared_references']:
            source = nodes[link['source']]
            target = shared.get(link['target']) or nodes[link['target']]
            edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                'rationale': 'SS-127 已批准设计引用；未启动采集、写入或计算。'}, actor=ACTOR, commit=False)
            db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            model.add_binding(edge, {'kind': 'reference', 'branch': '',
                'source_port_id': stable(source['id'], 'output', 'out'),
                'target_port_id': stable(target['id'], 'input', 'in'),
                'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [], 'role': 'stocks_design_only'}})
        # Only seed the new Stocks occurrences of shared cards; their canonical
        # positions and every existing occurrence remain untouched.
        for index, name in enumerate(('assets', 'asset_identifiers')):
            occurrence = 'occurrence:' + quote(json.dumps([nodes['rwa_list']['id'], shared[name]['id']], separators=(',', ':')), safe='')
            db.execute('INSERT OR IGNORE INTO node_display_positions VALUES (?,?,?,?)',
                       (shared[name]['id'], occurrence, right + index*460, 2596))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Invalid Stocks design graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER,
            after={'new_nodes': [n['id'] for n in nodes.values()], 'runtime_enabled': False})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, revision))
        db.commit()
    except Exception:
        db.rollback()
        raise
