"""SS-140 Studio handoff only: no message publishing, storage writer or API."""
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/hottest-history.v1.json'
MARKER = 'hottest_history_ss140_v1'
ACTOR = 'ss140-hottest-history'


def ensure_hottest_history(service):
    db = service.db
    installed = db.execute('SELECT value FROM schema_meta WHERE key=?', (MARKER,)).fetchone()
    current_revision = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    if installed:
        if installed['value'] == current_revision:
            return
        # Delivery correction: update only this catalog's known pinned revision.
        if installed['value'] != '1392d660a8e0bc6bedfa2c9fc46330183687b94843ccaf4b4598763569c0d696':
            raise ValueError('SS-140 unknown installed history definition')
        model = CardModel(service)
        db.execute('BEGIN IMMEDIATE')
        try:
            for row in db.execute('SELECT node_id,kind,config FROM node_contracts').fetchall():
                cfg = json.loads(row['config'])
                refs = [r for r in cfg['definition_refs'] if r['path'] == PATH]
                if not refs:
                    continue
                if cfg.get('read_only') or any(r['revision'] != installed['value'] for r in refs):
                    raise ValueError('SS-140 edited history definition pin')
                for ref in refs:
                    ref['revision'] = current_revision
                model.validate_config(cfg, row['kind'])
                db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), row['node_id']))
            db.execute('UPDATE schema_meta SET value=? WHERE key=?', (current_revision, MARKER))
            service._event(ACTOR, 'update_definition_pin', 'graph', MARKER, after={'revision': current_revision})
            db.commit()
        except Exception:
            db.rollback()
            raise
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='board_display_top50_ss131_v1'").fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    base = json.loads((ROOT / 'catalog/coingecko-hottest.v1.json').read_text())
    revision = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    model = CardModel(service)
    nodes = {}
    db.execute('BEGIN IMMEDIATE')
    try:
        for key in ('rank', 'result'):
            entry = next(c for c in base['cards'] if c['key'] == key)
            node = service.find_name(entry['name'])
            if not node:
                raise ValueError('SS-140 missing existing card: ' + key)
            cfg = model.contract(node['id'])['config']
            if cfg.get('read_only') or cfg['action']['implementation'] not in ('unknown', 'planned'):
                raise ValueError('SS-140 protected card: ' + key)
            for field, source in [('definition', 'description_zh'), ('formula', 'algorithm_zh')]:
                if node[field] != entry[source]:
                    raise ValueError('SS-140 edited card: ' + key + '/' + field)
            for ref in cfg['definition_refs']:
                if ref.get('revision') != hashlib.sha256((ROOT / ref['path']).read_bytes()).hexdigest():
                    raise ValueError('SS-140 unknown definition revision')
            nodes[node['name']] = node
        source, result = nodes['生成基础最热榜'], nodes['leaderboard_hottest']
        direct = db.execute('SELECT * FROM edges WHERE upstream_id=? AND downstream_id=?',
                            (source['id'], result['id'])).fetchone()
        if not direct:
            raise ValueError('SS-140 missing direct result write')
        bindings = list(db.execute('SELECT * FROM edge_bindings WHERE edge_id=?', (direct['id'],)))
        if len(bindings) != 1 or bindings[0]['kind'] != 'write':
            raise ValueError('SS-140 edited direct result binding')
        expected_names = {f['name'] for f in next(c for c in base['cards'] if c['key'] == 'result')['fields']}
        mapped_names = set()
        for usage in service.get_field_usages(direct['id']):
            for endpoint, key in [('source_field_id', source['id']), ('target_field_id', result['id'])]:
                if usage[endpoint] and not db.execute('SELECT 1 FROM node_fields WHERE id=? AND node_id=?', (usage[endpoint], key)).fetchone():
                    raise ValueError('SS-140 edited direct result mapping')
            pair = [db.execute('SELECT name FROM node_fields WHERE id=?', (usage[k],)).fetchone() for k in ('source_field_id', 'target_field_id')]
            if not all(pair) or pair[0]['name'] != pair[1]['name'] or pair[0]['name'] not in expected_names:
                raise ValueError('SS-140 edited direct result mapping')
            mapped_names.add(pair[0]['name'])
        if mapped_names != expected_names:
            raise ValueError('SS-140 incomplete direct result mapping')
        if any(service.find_name(c['name']) for c in spec['cards']):
            raise ValueError('SS-140 new card name conflict')

        def fields(node, columns):
            known = {f['name']: f for f in service.get_fields(node['id'])}
            for col in columns:
                # Existing legacy field types/definitions remain authoritative.
                # Required non-null successful-envelope constraints live in the new schema.
                if col['name'] not in known:
                    service.create_field(node['id'], {'name': col['name'], 'data_type': col['data_type'],
                        'definition': col['label_zh']}, actor=ACTOR, commit=False)

        def save(node, key, kind):
            cfg = model.contract(node['id'])['config']
            cfg['definition_refs'].append({'path': PATH, 'revision': revision, 'selector': {'key': key}})
            cfg['resource'].update(hottest_history_key=key, delivery='studio_design_only', physical_binding=None)
            if key == 'rank':
                cfg['action']['version'] = 3
                cfg['resource']['result_message_schema'] = spec['message_contract']['schema']
            if key not in ('rank', 'result'):
                cfg['action'] = {'id': 'hottest_history.' + key if kind == 'process' else '',
                                 'version': 1, 'implementation': 'planned'}
                cfg['trigger'] = {'kind': 'event' if kind == 'process' and key != 'query' else 'manual' if key == 'query' else 'unspecified'}
                cfg['resource'].update(retention='Few must bind retention and replay horizon; no configured TTL claimed',
                    dedupe_key='snapshot_id; identical replay only', rebuild_from='immutable archived result rounds; never silently recompute old scores')
            if key == 'channel':
                cfg['resource'].update(topic='', consumer_groups={'current': 'independent business group; bind in Few',
                    'archive': 'independent archive group; bind in Few'}, registry_binding='Few registry required; no topic or header tuple invented')
            if key == 'archive':
                cfg['resource'].update(execution_scope='route inside existing shared archive writer; not another service')
            if key == 'history':
                cfg['technology'] = 'Delta/Parquet (existing archive capability; physical binding unverified)'
                cfg['resource']['primary_key'] = ['snapshot_id']
            model.validate_config(cfg, kind)
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), node['id']))

        # Only new cards get initial coordinates. Existing cards and saved displays remain intact.
        left = max(r[0] for r in db.execute('SELECT position_x FROM nodes')) + 700
        top = source['position_y']
        positions = {'channel': (0, 0), 'current': (0, 400), 'archive': (600, 400),
                     'history': (600, 800), 'query': (600, 1200)}
        for card in spec['cards']:
            dx, dy = positions[card['key']]
            node = service.create_node({'name': card['name'], 'kind': card['kind'], 'workflow_lane': 'shared',
                'definition': card['description_zh'], 'formula': card['algorithm_zh'], 'trigger_rule': card['trigger_zh'],
                'caveats': spec['limitations_zh'], 'position_x': left + dx, 'position_y': top + dy}, actor=ACTOR, commit=False)
            nodes[card['name']] = node
            columns = card['fields']
            # Readers/writers explicitly consume envelope fields; current writer produces the old row schema.
            if card['key'] == 'current':
                columns = columns + [f for f in next(c for c in base['cards'] if c['key'] == 'result')['fields'] if f['name'] not in {x['name'] for x in columns}]
            if card['key'] == 'query':
                columns = columns + spec['cards'][0]['fields']
            fields(node, columns)
            save(node, card['key'], card['kind'])
        fields(source, spec['cards'][0]['fields'])
        save(source, 'rank', 'process')
        save(result, 'result', 'table')
        # Preserve the old detailed field mappings when routing the result through its business consumer.
        old_usages = service.get_field_usages(direct['id'])
        service._event(ACTOR, 'delete', 'edge', direct['id'], before=dict(direct))
        db.execute('DELETE FROM edges WHERE id=?', (direct['id'],))
        for connection in spec['connections']:
            a, b = nodes[connection['source']], nodes[connection['target']]
            edge = service.create_edge({'upstream_id': a['id'], 'downstream_id': b['id'],
                'rationale': 'SS-140已批准交接契约；未执行Few消息、写入或查询。'}, actor=ACTOR, commit=False)
            db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            model.add_binding(edge, {'kind': connection['kind'], 'branch': '',
                'source_port_id': stable(a['id'], 'output', 'out'), 'target_port_id': stable(b['id'], 'input', 'in'),
                'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [], 'role': 'hottest_history_' + connection['kind']}})
            af = {f['name']: f['id'] for f in service.get_fields(a['id'])}
            bf = {f['name']: f['id'] for f in service.get_fields(b['id'])}
            names = connection['fields'] or [f['name'] for f in next(c for c in base['cards'] if c['key'] == 'result')['fields']]
            for name in names:
                if name not in af or name not in bf:
                    raise ValueError('SS-140 missing mapped field: ' + name)
                service.create_field_usage(edge['id'], {'source_field_id': af[name], 'target_field_id': bf[name],
                    'usage_note': 'SS-140：冻结轮次与字段；嵌套rows_json结构见catalog/hottest-history.v1.json。'}, actor=ACTOR, commit=False)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-140 invalid graph')
        service._event(ACTOR, 'install_design', 'graph', MARKER,
            after={'new_nodes': [nodes[c['name']]['id'] for c in spec['cards']], 'runtime_enabled': False,
                   'previous_result_mapping_count': len(old_usages)})
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, revision))
        db.commit()
    except Exception:
        db.rollback()
        raise
