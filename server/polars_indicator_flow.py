"""SS-77 display correction: entry -> ordinary metric cards -> assembly -> Topic."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now

CATALOG = Path(__file__).resolve().parent.parent / 'catalog/polars-indicator-flow.v1.json'
MARKER = 'polars_indicator_flow_v1'
ACTOR = 'ss77-polars-indicator-flow'


def ensure_polars_indicator_flow(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not db.execute("SELECT 1 FROM schema_meta WHERE key='polars_indicator_module_v1'").fetchone():
        return
    spec = json.loads(CATALOG.read_text())
    model = CardModel(service)
    db.execute('BEGIN IMMEDIATE')
    try:
        graph = service.graph()
        parent = next(n for n in graph['nodes'] if model.contract(n['id'])['config']['resource'].get('module_children'))
        parent_config = model.contract(parent['id'])['config']
        children = [service.get_node(c['node_id']) for c in parent_config['resource']['module_children']]
        channel = next(n for n in graph['nodes'] if model.contract(n['id'])['config']['resource'].get('publisher_module_id') == parent['id'])
        raw = service.find_name('Few Understand · market.snapshot')
        edges = {(e['upstream_id'], e['downstream_id']): e for e in graph['edges']}
        publish = edges[(parent['id'], channel['id'])]
        previous = json.loads((CATALOG.parent / 'polars-indicator-module.v1.json').read_text())
        if parent['definition'] != previous['parent']['description'] or parent['formula'] != previous['parent']['algorithm']:
            raise ValueError('Polars flow: parent edited')
        if service.find_name(spec['assembly']['name']):
            raise ValueError('Polars flow: assembly name conflict')
        for child, card in zip(children, previous['cards']):
            config = model.contract(child['id'])['config']
            if config.get('read_only') or child['formula'] != card['formula'] + ' ' + card['missing']:
                raise ValueError('Polars flow: child edited')
            if set(e['downstream_id'] for e in graph['edges'] if e['upstream_id'] == child['id']) != {parent['id']}:
                raise ValueError('Polars flow: child outputs edited')
            if (raw['id'], child['id']) not in edges or (child['id'], parent['id']) not in edges:
                raise ValueError('Polars flow: expected edges missing')
        for edge in [publish] + [edges[pair] for child in children for pair in ((raw['id'], child['id']), (child['id'], parent['id']))]:
            for usage in service.get_field_usages(edge['id']):
                if not (usage['usage_note'].startswith('由模块子卡#') or usage['usage_note'] in {
                    '读取已声明输入；同名输出保留映射，其余为计算/筛选使用，不声称直接复制。',
                    '同名已声明字段；冻结输入/版本/基线引用，不补猜数据。',
                    '保留来源全历史ATH百分比口径；缺失保持null。',
                    '模块共享输入：原始字段由#3035归一，asset_id来自共享身份关联；子卡无独立消费者。',
                    '模块内部结果交给#3035统一组装，不单独发布Topic。'}):
                    raise ValueError('Polars flow: mapping edited')
        ref = {'path': 'catalog/polars-indicator-flow.v1.json', 'revision': hashlib.sha256(CATALOG.read_bytes()).hexdigest()}
        def save(node, config):
            if config.get('read_only'):
                raise ValueError('Polars flow: protected configuration')
            config['definition_refs'].append(ref)
            model.validate_config(config, model.contract(node['id'])['kind'])
            db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?', (encoded(config), node['id']))
        def remove_edge(edge):
            for usage in service.get_field_usages(edge['id']):
                service._event(ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
            db.execute('DELETE FROM edges WHERE id=?', (edge['id'],))
            service._event(ACTOR, 'delete', 'edge', edge['id'], before=edge)
        def connect(source, target, names, role):
            note = '同一Polars程序内共享输入' if role == 'module_shared_input' else '同一Polars程序内结果汇总'
            edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'], 'transport_kind': 'direct', 'rationale': note}, actor=ACTOR, commit=False)
            for b in db.execute('SELECT * FROM edge_bindings WHERE edge_id=?', (edge['id'],)).fetchall():
                config = json.loads(b['config']); config.update(trigger='none', role=role, unresolved=[])
                db.execute('UPDATE edge_bindings SET config=? WHERE id=?', (encoded(config), b['id']))
            sf = {f['name']: f for f in service.get_fields(source['id'])}
            tf = {f['name']: f for f in service.get_fields(target['id'])}
            for name in names:
                service.create_field_usage(edge['id'], {'source_field_id': sf[name]['id'], 'target_field_id': tf.get(name, {}).get('id'), 'usage_note': note}, actor=ACTOR, commit=False)
        assembly = service.create_node({'name': spec['assembly']['name'], 'kind': 'process', 'workflow_lane': 'shared',
            'definition': spec['assembly']['description'], 'formula': spec['assembly']['algorithm'],
            'caveats': '工作台设计，后台实现与运行未核验；所属3035同一Polars程序。',
            'position_x': parent['position_x'], 'position_y': parent['position_y'] + 512}, actor=ACTOR, commit=False)
        original_fields = service.get_fields(parent['id'])
        af = {}
        for f in original_fields:
            af[f['name']] = service.create_field(assembly['id'], {k: f[k] for k in ('name', 'data_type', 'definition', 'unit')}, actor=ACTOR, commit=False)
        config = model.contract(assembly['id'])['config']
        config.update(technology='Polars', action={'id': spec['assembly']['action_id'], 'version': 1, 'implementation': 'planned'},
            trigger={'kind': 'unspecified', 'module_owner_id': parent['id']}, draft=True,
            resource={'parent_module': {'node_id': parent['id'], 'reference_number': parent['reference_number']},
                      'execution_scope': 'in_process', 'design_key': 'assemble', 'primary_key': ['observation_id'], 'publication_mode': 'assemble_once'})
        save(assembly, config)
        # Keep the existing Topic publication edge and usages; only change its producer.
        before = copy.deepcopy(publish)
        db.execute('UPDATE edges SET upstream_id=? WHERE id=?', (assembly['id'], publish['id']))
        out_port = db.execute("SELECT id FROM node_ports WHERE node_id=? AND key='out'", (assembly['id'],)).fetchone()[0]
        db.execute('UPDATE edge_bindings SET source_port_id=? WHERE edge_id=?', (out_port, publish['id']))
        service._event(ACTOR, 'update', 'edge', publish['id'], before=before, after=service.get_edge(publish['id']))
        for u in service.get_field_usages(publish['id']):
            name = service.get_field(u['source_field_id'])['name']
            db.execute('UPDATE edge_field_usages SET source_field_id=?,usage_note=? WHERE id=?',
                       (af[name]['id'], '同一观测的指标结果经汇总卡组装，由3035所属程序统一发布。', u['id']))
            service._event(ACTOR, 'update', 'field_usage', u['id'], before=u,
                          after={**u, 'source_field_id': af[name]['id']})
        for child in children:
            remove_edge(edges[(raw['id'], child['id'])])
            remove_edge(edges[(child['id'], parent['id'])])
            cc = model.contract(child['id'])['config']
            # Raw origin information remains in the metric definition; normalized fields come from entry.
            connect(parent, child, list(dict.fromkeys(cc['resource']['input_fields'] + cc['resource']['shared_context_fields'])), 'module_shared_input')
            connect(child, assembly, [f['name'] for f in service.get_fields(child['id'])], 'module_result')
            cc['resource']['result_destination_id'] = assembly['id']
            save(child, cc)
        derived = set(parent_config['resource']['field_producers']) | {'metric_id', 'calculated_at'}
        # Parent outputs now describe prepared inputs; final metrics belong to the assembly.
        for f in original_fields:
            if f['name'] in derived and f['name'] not in ('price_change_percentage_24h', 'ath_change_percentage'):
                if db.execute('SELECT 1 FROM edge_field_usages WHERE source_field_id=? OR target_field_id=?', (f['id'], f['id'])).fetchone():
                    raise ValueError('Polars flow: computed parent field has unexpected mappings: ' + f['name'])
                db.execute('DELETE FROM node_fields WHERE id=?', (f['id'],))
                service._event(ACTOR, 'delete', 'field', f['id'], before=f)
        public_names = [f['name'] for f in service.get_fields(parent['id']) if f['name'] not in parent_config['resource']['field_producers']]
        connect(parent, assembly, public_names, 'module_shared_input')
        db.execute('UPDATE nodes SET definition=?,formula=?,updated_at=? WHERE id=?',
            (spec['parent_description'], spec['parent_algorithm'], now(), parent['id']))
        service._event(ACTOR, 'update', 'node', parent['id'], before=parent, after=service.get_node(parent['id']))
        parent_config['resource'].update(assembly_node_id=assembly['id'], publication_mode='via_assembly')
        save(parent, parent_config)
        cc = model.contract(channel['id'])['config']
        cc['resource']['publisher_node_id'] = assembly['id']
        save(channel, cc)
        # Lay out only this connected module. Find a clear horizontal band below the entry;
        # preserve unrelated cards and move the Topic and its descendants together if needed.
        module_ids = {parent['id'], channel['id'], assembly['id']} | {n['id'] for n in children}
        descendants = {channel['id']}
        for _ in graph['nodes']:
            added = {e['downstream_id'] for e in graph['edges'] if e['upstream_id'] in descendants} - descendants
            if not added: break
            descendants |= added
        fixed = [n for n in graph['nodes'] if n['id'] not in module_ids | descendants]
        top = parent['position_y'] + 256
        def overlaps(x, y, n):
            return abs(x - n['position_x']) < 340 and abs(y - n['position_y']) < 200
        while any(overlaps(parent['position_x'] + (i - 2) * 380, top, n) for i in range(5) for n in fixed) or any(overlaps(parent['position_x'], top + d, n) for d in (256, 512) for n in fixed):
            top += 224
        placements = {n['id']: (parent['position_x'] + (i - 2) * 380, top) for i, n in enumerate(children)}
        placements[assembly['id']] = (parent['position_x'], top + 256)
        placements[channel['id']] = (parent['position_x'], top + 512)
        downstream = [n for n in graph['nodes'] if n['id'] in descendants - {channel['id']}]
        delta = max(0, top + 768 - min((n['position_y'] for n in downstream), default=top + 768))
        while any(overlaps(n['position_x'], n['position_y'] + delta, f) for n in downstream for f in fixed):
            delta += 224
        for n in downstream: placements[n['id']] = (n['position_x'], n['position_y'] + delta)
        for node_id, (x, y) in placements.items():
            old = service.get_node(node_id)
            db.execute('UPDATE nodes SET position_x=?,position_y=? WHERE id=?', (x, y, node_id))
            service._event(ACTOR, 'update', 'node', node_id, before=old, after=service.get_node(node_id))
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Polars flow: invalid graph')
        db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, spec['version']))
        db.commit()
    except Exception:
        db.rollback()
        raise
