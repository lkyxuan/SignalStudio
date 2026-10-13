"""SS-80: retire the old discovery branch, preserving the unified identity chain.

Only Studio definitions change. No business asset, event or Few runtime data is deleted.
Historical installers remain immutable; this final transaction overrides their definitions.
"""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
MARKER = 'retire_market_discovery_v1'
ACTOR = 'ss80-retire-discovery'
CATALOG = ROOT / 'server/migration_snapshots/market-ss80.json'
REPLACEMENTS = {
    'catalog/market-polars.v1.json': 'catalog/market-current.v1.json',
    'catalog/polars-indicator-module.v1.json': 'catalog/polars-indicator-current.v1.json',
}
RETIRED = {'记录首次有效发现', 'leaderboard_discoveries'}
DISABLED = {'生成新发现榜', 'leaderboard_emerging'}
OLD_FIELDS = {'discovery_score', 'new_score', 'first_seen_at', 'source_first_seen_json',
              'discovery_status', 'discovery_kind'}


def ensure_retire_market_discovery(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='coingecko_identity_handoff_v1'").fetchone():
        return
    spec = json.loads(CATALOG.read_text())
    old = json.loads((ROOT / 'catalog/market-polars.v1.json').read_text())
    definitions = {n['name']: n for n in spec['nodes']}
    previous = {n['name']: n for n in old['nodes']}
    model = CardModel(service)
    # Migrations must include saved cards hidden by the workspace scope.
    graph = {key: [dict(r) for r in db.execute('SELECT * FROM ' + table)]
             for key, table in [('nodes', 'nodes'), ('edges', 'edges'), ('fields', 'node_fields'),
                                ('requirements', 'data_requirements'), ('field_usages', 'edge_field_usages')]}
    nodes = {n['name']: n for n in graph['nodes']}
    managed = set(previous)
    affected = RETIRED | DISABLED
    if not affected <= nodes.keys():
        raise ValueError('Discovery cleanup: expected old cards missing')
    ids = {nodes[name]['id'] for name in affected}
    # Reject new work attached to cards whose data is being removed or disabled.
    for edge in graph['edges']:
        if edge['upstream_id'] in ids or edge['downstream_id'] in ids:
            other = edge['downstream_id'] if edge['upstream_id'] in ids else edge['upstream_id']
            if service.get_node(other)['name'] not in managed:
                raise ValueError('Discovery cleanup: unrelated dependency attached')
    for name in affected:
        n = nodes[name]
        cfg = model.contract(n['id'])['config']
        if (n['definition'] != previous[name]['description'] or n['formula'] != previous[name]['algorithm']
                or cfg.get('read_only') or cfg['action']['implementation'] not in ('unknown', 'planned')):
            raise ValueError('Discovery cleanup: protected or edited card ' + name)
    remove_fields = [f for f in graph['fields'] if f['node_id'] in ids
                     or (service.get_node(f['node_id'])['name'] in managed and f['name'] in OLD_FIELDS)]
    for field in remove_fields:
        name = service.get_node(field['node_id'])['name']
        original = next((f for f in previous[name]['columns'] if f['name'] == field['name']), None)
        if original is None or field['data_type'] != original['data_type'] or field['definition'] != original['label_zh']:
            raise ValueError('Discovery cleanup: edited field ' + field['name'])
    field_ids = {f['id'] for f in remove_fields}
    for usage in graph['field_usages']:
        if usage['source_field_id'] in field_ids or usage.get('target_field_id') in field_ids:
            edge = next(e for e in graph['edges'] if e['id'] == usage['edge_id'])
            if any(service.get_node(edge[k])['name'] not in managed for k in ('upstream_id', 'downstream_id')):
                raise ValueError('Discovery cleanup: removed field used by unrelated work')
    for req in graph['requirements']:
        if req.get('source_field_id') in field_ids and service.get_node(req['node_id'])['name'] not in managed:
            raise ValueError('Discovery cleanup: removed field required by unrelated work')

    def rewrite(value):
        if isinstance(value, list):
            return [rewrite(v) for v in value]
        if isinstance(value, dict):
            result = {k: rewrite(v) for k, v in value.items()}
            # Recursive string rewriting has already replaced result['path'].
            # Select the new digest using the original path, not the rewritten one.
            if value.get('path') in REPLACEMENTS:
                result['path'] = REPLACEMENTS[value['path']]
                result['revision'] = hashlib.sha256((ROOT / result['path']).read_bytes()).hexdigest()
            elif result.get('path') == 'catalog/market-scoring.v1.json':
                result['revision'] = hashlib.sha256((ROOT / result['path']).read_bytes()).hexdigest()
            return result
        return REPLACEMENTS.get(value, value) if isinstance(value, str) else value

    db.execute('BEGIN IMMEDIATE')
    try:
        for edge in graph['edges']:
            if edge['upstream_id'] in ids or edge['downstream_id'] in ids:
                service._event(ACTOR, 'delete', 'edge', edge['id'], before=edge)
                db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
        for usage in graph['field_usages']:
            if usage['source_field_id'] in field_ids or usage.get('target_field_id') in field_ids:
                db.execute('DELETE FROM edge_field_usages WHERE id=?', (usage['id'],))
        for req in graph['requirements']:
            if req.get('source_field_id') in field_ids:
                db.execute('DELETE FROM data_requirements WHERE id=?', (req['id'],))
        for field in remove_fields:
            service._event(ACTOR, 'delete', 'field', field['id'], before=field)
            db.execute('DELETE FROM node_fields WHERE id=?', (field['id'],))
        for name in RETIRED:
            node = nodes[name]
            service._event(ACTOR, 'delete', 'node', node['id'], before=node)
            db.execute('DELETE FROM nodes WHERE id=?', (node['id'],))
        consumers = json.loads((ROOT / 'catalog/polars-indicator-current.v1.json').read_text())['consumers']
        for node in graph['nodes']:
            name = node['name']
            if name in RETIRED:
                continue
            config = model.contract(node['id'])['config']
            before = copy.deepcopy(config)
            config = rewrite(config)
            resource = config['resource']
            if isinstance(resource.get('consumers'), dict):
                resource['consumers'] = {k: v for k, v in resource['consumers'].items() if k not in affected}
            if 'field_consumers' in resource:
                resource['field_consumers'] = consumers
            dep = next((c for c in consumers if c['name'] == name), None)
            if dep and 'indicator_dependency' in resource:
                resource['indicator_dependency'] = {k: dep[k] for k in ('metric_fields', 'validation_fields', 'required_fields', 'purpose')}
            if name in DISABLED:
                config['action'] = {'id': '', 'version': 1, 'implementation': 'unknown'}
                config['trigger'] = {'kind': 'unspecified'}
                resource.pop('indicator_dependency', None)
                resource['primary_key'] = []
                config['definition_refs'] = [r for r in config['definition_refs'] if r['path'] == 'catalog/market-current.v1.json']
                resource['status'] = 'retired_placeholder'
            # Keep Polars/handoff overrides intact; only replace changed market descriptions.
            if name in definitions and name not in ('Polars · 计算 CoinGecko 量价指标', 'Few Understand · indicator.data'):
                item = definitions[name]
                if item['description'] != previous[name]['description'] or item['algorithm'] != previous[name]['algorithm']:
                    if node['definition'] != previous[name]['description'] or node['formula'] != previous[name]['algorithm']:
                        raise ValueError('Discovery cleanup: edited surviving definition ' + name)
                    db.execute('UPDATE nodes SET definition=?,formula=?,updated_at=? WHERE id=?',
                               (item['description'], item['algorithm'], now(), node['id']))
            if config != before:
                if before.get('read_only') or before['action']['implementation'] not in ('planned', 'unknown'):
                    raise ValueError('Discovery cleanup: protected surviving contract ' + name)
                model.validate_config(config, model.contract(node['id'])['kind'])
                db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?', (encoded(config), node['id']))
            if name in managed and node['rationale'] == old['purpose']:
                db.execute('UPDATE nodes SET rationale=? WHERE id=?', (spec['purpose'], node['id']))
            if name in managed or config != before:
                notes = node['notes']
                for a, b in REPLACEMENTS.items():
                    notes = notes.replace(a, b)
                db.execute('UPDATE nodes SET notes=? WHERE id=?', (notes, node['id']))
        # Scoring input notes must no longer mention the removed reward.
        for usage in db.execute('SELECT * FROM edge_field_usages WHERE usage_note LIKE ?', ('%首次发现奖励%',)).fetchall():
            db.execute('UPDATE edge_field_usages SET usage_note=? WHERE id=?',
                       ('四项量价指标按最高档加分；统一建档起始分由#3009独立判断。', usage['id']))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Discovery cleanup: invalid graph')
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, spec['revision']))
        db.commit()
    except Exception:
        db.rollback()
        raise
