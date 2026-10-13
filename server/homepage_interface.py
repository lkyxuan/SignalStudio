"""Install the approved six-position definition, without business data or consumers."""
import hashlib
import json
from application_interfaces import ROOT
from card_model import CardModel, encoded, stable

PATH = 'catalog/homepage-layout.v1.json'
MARKER = 'homepage_interface_v1'
MARKET_PATH = 'catalog/market-current.v1.json'


def ensure_homepage_interface(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / 'server/migration_snapshots/homepage-ss81.json').read_text())
    item = spec['interface']
    names = list(dict.fromkeys(slot['source_name'] for slot in spec['slots'] if slot['source_name']))
    targets = [service.find_name(name) for name in names]
    if not all(targets):
        return
    model = CardModel(service)
    if not model.enabled():
        raise ValueError('Homepage installation requires card-model migration')
    if service.find_name(item['name']):
        raise ValueError('Homepage interface name conflicts with an existing card')
    with service.db:
        x, y = targets[0]['position_x'] + 840, targets[0]['position_y'] + 240
        occupied = [(n['position_x'], n['position_y']) for n in service.graph()['nodes']]
        while any(abs(x - px) < 380 and abs(y - py) < 220 for px, py in occupied):
            y += 240
        node = service.create_node({'name': item['name'], 'kind': 'interface',
            'workflow_lane': targets[0]['workflow_lane'], 'definition': item['purpose_zh'],
            'caveats': '六框结构定义；第三榜与信号分组待定，业务页面/API未接入。',
            'notes': PATH, 'position_x': x, 'position_y': y},
            actor='homepage-interface-definition', commit=False)
        config = model.contract(node['id'])['config']
        config['definition_refs'] = [{'path': PATH, 'revision': hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest(),
            'selector': {'key': item['key']}}]
        config['interface'] = item
        model.validate_config(config, 'interface')
        service.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(config), node['id']))
        for target in targets:
            edge = service.create_edge({'upstream_id': target['id'], 'downstream_id': node['id'],
                'rationale': '首页展示来源引用；API/信号持久化未绑定，不触发执行。'},
                actor='homepage-interface-definition', commit=False)
            service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            model.add_binding(edge, {'kind': 'reference', 'branch': '',
                'source_port_id': stable(target['id'], 'output', 'out'),
                'target_port_id': stable(node['id'], 'input', 'in'),
                'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [], 'role': 'homepage_source_definition'}})
        # Only the old frontend position declaration changed; preserve all user config.
        revision = hashlib.sha256((ROOT / MARKET_PATH).read_bytes()).hexdigest()
        for row in service.db.execute('SELECT node_id,config FROM node_contracts').fetchall():
            saved = json.loads(row['config'])
            changed = False
            for ref in saved.get('definition_refs', []):
                if ref.get('path') == MARKET_PATH:
                    ref['revision'] = revision
                    changed = True
            if changed:
                service.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(saved), row['node_id']))
        service.db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))
