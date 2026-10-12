"""Install interface definitions once; never serve or execute business UI actions."""
import hashlib
import json
from pathlib import Path
from card_model import CardModel, encoded, stable

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/application-interfaces.v1.json'
MARKER = 'application_interface_cards_v1'


def ensure_application_interfaces(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    targets = {item['key']: service.find_name(item['target_name']) for item in spec['cards']}
    if not all(targets.values()):
        return  # No invented targets when the original module is absent or renamed.
    model = CardModel(service)
    if not model.enabled():
        raise ValueError('Interface installation requires card-model migration')
    # A coincidentally named user card is not ours to change or silently adopt.
    if any(service.find_name(item['name']) for item in spec['cards']):
        raise ValueError('Application interface name conflicts with an existing card; review before installation')
    with service.db:
        occupied = [(n['position_x'], n['position_y']) for n in service.graph()['nodes']]
        for item in spec['cards']:
            target = targets[item['key']]
            x, y = target['position_x'] + 420, target['position_y'] + 240
            while any(abs(x - px) < 380 and abs(y - py) < 220 for px, py in occupied):
                y += 240
            occupied.append((x, y))
            node = service.create_node({'name': item['name'], 'kind': 'interface',
                'workflow_lane': target['workflow_lane'], 'definition': item['purpose_zh'],
                'caveats': '界面交付定义；实际页面/API/运行尚未核验。',
                'notes': PATH + ' · ' + item['key'], 'position_x': x, 'position_y': y},
                actor='application-interface-definition', commit=False)
            config = model.contract(node['id'])['config']
            refs = [PATH] + (['catalog/supabase-score-sync.v1.json'] if item['key'] == 'asset_scores' else ['catalog/identity-flow-case.v1.json'])
            config['definition_refs'] = [{'path': path, 'revision': hashlib.sha256((ROOT / path).read_bytes()).hexdigest(),
                'selector': {'key': item['key']}} for path in refs]
            config['interface'] = {**item, 'endpoint': None, 'api_endpoint': None, 'implementation': 'unverified'}
            if item['key'] == 'asset_scores':
                # Link to the single source rule, rather than copying a second policy.
                config['interface']['read_contract_ref'] = item['read_contract_ref']
            model.validate_config(config, 'interface')
            service.db.execute('UPDATE node_contracts SET config=? WHERE node_id=?', (encoded(config), node['id']))
            upstream, downstream = (target, node) if item['relation'] == 'read' else (node, target)
            edge = service.create_edge({'upstream_id': upstream['id'], 'downstream_id': downstream['id'],
                'rationale': '读取规则定义，实际页面/API待绑定。' if item['relation'] == 'read' else '承载人工审核的应用界面；不自动触发、不代表直连。'},
                actor='application-interface-definition', commit=False)
            service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            model.add_binding(edge, {'kind': item['relation'], 'branch': '',
                'source_port_id': stable(upstream['id'], 'output', 'out'),
                'target_port_id': stable(downstream['id'], 'input', 'in'),
                'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [],
                    **({'role': 'human_review_surface'} if item['relation'] == 'reference' else {})}})
        service.db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))
