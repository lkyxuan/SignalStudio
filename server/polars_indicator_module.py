"""SS-77: expand the workspace definition, never execute Polars or Few jobs."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'catalog/polars-indicator-module.v1.json'
MARKER = 'polars_indicator_module_v1'
ACTOR = 'ss77-polars-indicator-module'


def ensure_polars_indicator_module(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not service.db.execute("SELECT 1 FROM schema_meta WHERE key='coingecko_indicator_signals_v1'").fetchone():
        return
    spec = json.loads(CATALOG.read_text())
    market = json.loads((ROOT / 'catalog/market-polars.v1.json').read_text())
    model = CardModel(service)
    service.db.execute('BEGIN IMMEDIATE')
    try:
        graph = service.graph()
        parent = service.find_name(spec['parent']['name'])
        channel = service.find_name(spec['channel'])
        raw = service.find_name(spec['input'])
        history = service.find_name('coingecko_market_history')
        if not all((parent, channel, raw, history)):
            raise ValueError('Polars module: missing shared input')
        managed = [parent, channel] + [service.find_name(c['name']) for c in spec['consumers']]
        by_key = {n['key']: n for n in market['nodes']}
        for node in managed:
            if not node:
                raise ValueError('Polars module: missing consumer')
            config = model.contract(node['id'])['config']
            key = config.get('resource', {}).get('design_key')
            old = by_key.get(key)
            if (not old or node['definition'] != old['description'] or node['formula'] != old['algorithm']
                    or config.get('read_only') or not config.get('draft')
                    or config['action']['implementation'] not in ('unknown', 'planned')):
                raise ValueError('Polars module: definition/configuration changed: ' + node['name'])
            actual = {(f['name'], f['data_type'], f['definition']) for f in service.get_fields(node['id'])}
            if actual != {(f['name'], f['data_type'], f['label_zh']) for f in old['columns']}:
                raise ValueError('Polars module: fields changed: ' + node['name'])
            if key not in ('polars', 'indicators'):
                sources = {service.get_node(e['upstream_id'])['name'] for e in graph['edges'] if e['downstream_id'] == node['id']}
                expected = set(old['sources']) | {e['source'] for e in market['additional_edges'] if e['target'] == node['name']}
                if sources != expected:
                    raise ValueError('Polars module: dependencies changed: ' + node['name'])
                expected_resource = {'design_key': key, 'delivery': 'schema_and_connections_only', 'primary_key': old['primary_key']}
                if config['resource'] != expected_resource:
                    raise ValueError('Polars module: configuration changed: ' + node['name'])
            elif key == 'polars' and config['resource'] != {
                    'design_key': 'polars', 'delivery': 'schema_and_connections_only', 'primary_key': old['primary_key']}:
                raise ValueError('Polars module: parent configuration changed')
            if any(k in config['resource'] for k in ('parent_module', 'module_children', 'field_producers', 'indicator_dependency')):
                raise ValueError('Polars module: ownership configuration already exists')
        edges = {(e['upstream_id'], e['downstream_id']): e for e in graph['edges']}
        publish = edges.get((parent['id'], channel['id']))
        if not publish:
            raise ValueError('Polars module: missing shared publication')
        generated_notes = {
            '读取已声明输入；同名输出保留映射，其余为计算/筛选使用，不声称直接复制。',
            '同名已声明字段；冻结输入/版本/基线引用，不补猜数据。',
            '保留来源全历史ATH百分比口径；缺失保持null。',
        }
        for usage in service.get_field_usages(publish['id']):
            if usage['usage_note'] not in generated_notes:
                raise ValueError('Polars module: publication mapping edited')
        for c in spec['consumers']:
            node = service.find_name(c['name'])
            edge = edges.get((channel['id'], node['id']))
            if not edge:
                raise ValueError('Polars module: missing indicator dependency')
            # Only replace the previous installer-generated all-fields mappings.
            for usage in service.get_field_usages(edge['id']):
                if usage['usage_note'] not in (
                    '读取已声明输入；同名输出保留映射，其余为计算/筛选使用，不声称直接复制。',
                    '同名已声明字段；冻结输入/版本/基线引用，不补猜数据。',
                    '该字段作为处理输入使用，不声称复制到输出。'):
                    raise ValueError('Polars module: input mapping edited: ' + node['name'])
        for card in spec['cards']:
            if service.find_name(card['name']):
                raise ValueError('Polars module: child name conflict: ' + card['name'])
        ref = {'path': 'catalog/polars-indicator-module.v1.json', 'revision': hashlib.sha256(CATALOG.read_bytes()).hexdigest()}

        def save_config(node, config):
            model.validate_config(config, model.contract(node['id'])['kind'])
            service.db.execute('UPDATE node_contracts SET revision=revision+1,config=? WHERE node_id=?', (encoded(config), node['id']))

        def mapping(source, target, names, note, role):
            edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'],
                'rationale': note, 'transport_kind': 'direct'}, actor=ACTOR, commit=False)
            # Shared input references do not introduce independent Topic consumers.
            for binding in service.db.execute('SELECT * FROM edge_bindings WHERE edge_id=?', (edge['id'],)).fetchall():
                config = json.loads(binding['config'])
                config.update(trigger='none', role=role, unresolved=[])
                kind = 'reference' if role == 'module_shared_input' else binding['kind']
                service.db.execute('UPDATE edge_bindings SET kind=?,config=? WHERE id=?', (kind, encoded(config), binding['id']))
            source_fields = {f['name']: f for f in service.get_fields(source['id'])}
            target_fields = {f['name']: f for f in service.get_fields(target['id'])}
            for name in names:
                service.create_field_usage(edge['id'], {'source_field_id': source_fields[name]['id'],
                    'target_field_id': target_fields.get(name, {}).get('id'), 'usage_note': note}, actor=ACTOR, commit=False)
            return edge

        # Keep every existing card position; put the new group in the nearest free column.
        x = parent['position_x'] - 400
        y = parent['position_y']
        while any(abs(n['position_x'] - x) < 350 and y - 220 < n['position_y'] < y + len(spec['cards']) * 230 for n in graph['nodes']):
            x -= 400
        children = []
        producers = {}
        for index, card in enumerate(spec['cards']):
            node = service.create_node({'name': card['name'], 'kind': 'process', 'workflow_lane': 'shared',
                'definition': '所属#3035 Polars模块的单项指标职责；' + card['formula'],
                'formula': card['formula'] + ' ' + card['missing'],
                'notes': ref['path'] + ' · ' + card['key'],
                'caveats': '工作台设计；同一Polars程序内执行，后台实现与运行未核验。',
                'position_x': x, 'position_y': y + index * 230}, actor=ACTOR, commit=False)
            outputs = card['columns'] + ([next(f for f in by_key['polars']['columns'] if f['name'] == name)
                        for name in card['history']['output_fields']] if card['history'] else [])
            outputs += [next(f for f in by_key['polars']['columns'] if f['name'] == name) for name in card['shared_context_fields']]
            for f in outputs:
                service.create_field(node['id'], {'name': f['name'], 'data_type': f['data_type'],
                    'definition': f['label_zh'], 'unit': card['unit'] if f['name'] == card['output'] else ''}, actor=ACTOR, commit=False)
            config = model.contract(node['id'])['config']
            config.update(technology='Polars', definition_refs=[{**ref, 'selector': {'key': card['key']}}],
                action={'id': 'polars_indicator.' + card['key'], 'version': 1, 'implementation': 'planned'},
                trigger={'kind': 'unspecified', 'module_owner_id': parent['id']},
                resource={'parent_module': {'node_id': parent['id'], 'reference_number': parent['reference_number']},
                    'execution_scope': 'in_process', 'design_key': card['key'], 'output_field': card['output'],
                    'primary_key': ['observation_id'], 'shared_context_fields': card['shared_context_fields'],
                    'input_fields': card['input_fields'], 'history': card['history'],
                    'delivery': 'schema_and_connections_only'}, draft=True)
            save_config(node, config)
            raw_names = {'requested_at': 'meta.requested_at', 'source_id': 'meta.operation_id',
                         'source_object_id': 'id', 'quote_currency': 'meta.quote_currency', 'coverage_key': 'meta.coverage_key'}
            mapping(raw, node, [raw_names.get(name, name) for name in card['input_fields'] if name != 'asset_id'],
                    '模块共享输入：原始字段由#3035归一，asset_id来自共享身份关联；子卡无独立消费者。', 'module_shared_input')
            if card['history']:
                mapping(history, node, card['history']['input_fields'], '模块历史读取：按原基线规则选择，非独立调度。', 'module_history_input')
            mapping(node, parent, [f['name'] for f in outputs], '模块内部结果交给#3035统一组装，不单独发布Topic。', 'module_result')
            children.append({'node_id': node['id'], 'reference_number': node['reference_number'], 'key': card['key'], 'output_field': card['output']})
            for f in outputs:
                if f['name'] not in card['shared_context_fields']:
                    producers[f['name']] = {'node_id': node['id'], 'reference_number': node['reference_number'], 'key': card['key']}
        before = copy.deepcopy(parent)
        service.db.execute('UPDATE nodes SET definition=?,formula=?,notes=?,updated_at=? WHERE id=?',
            (spec['parent']['description'], spec['parent']['algorithm'], ref['path'] + ' · module', now(), parent['id']))
        config = model.contract(parent['id'])['config']
        config['definition_refs'].append({**ref, 'selector': {'key': 'module'}})
        config['resource'].update(module_children=children, field_producers=producers,
            publication_mode='assemble_once', execution_scope='shared_polars_program')
        save_config(parent, config)
        service._event(ACTOR, 'update', 'node', parent['id'], before=before, after=service.get_node(parent['id']))
        config = model.contract(channel['id'])['config']
        config['definition_refs'].append(ref)
        config['resource'].update(field_producers=producers, publisher_module_id=parent['id'],
            field_consumers=spec['consumers'])
        save_config(channel, config)
        for c in spec['consumers']:
            node = service.find_name(c['name'])
            edge = edges[(channel['id'], node['id'])]
            for usage in service.get_field_usages(edge['id']):
                service._event(ACTOR, 'delete', 'field_usage', usage['id'], before=usage)
            service.db.execute('DELETE FROM edge_field_usages WHERE edge_id=?', (edge['id'],))
            source_fields = {f['name']: f for f in service.get_fields(channel['id'])}
            for name in c['required_fields']:
                note = '业务指标：' + c['purpose'] if name in c['metric_fields'] else '现行校验/准入/身份/追溯字段，不表示用此字段排名或加分。'
                service.create_field_usage(edge['id'], {'source_field_id': source_fields[name]['id'],
                    'target_field_id': None, 'usage_note': note}, actor=ACTOR, commit=False)
            config = model.contract(node['id'])['config']
            config['definition_refs'].append({**ref, 'selector': {'consumer': c['key']}})
            config['resource']['indicator_dependency'] = {k: c[k] for k in ('metric_fields', 'validation_fields', 'required_fields', 'purpose')}
            save_config(node, config)
        # Name-by-name publication mappings keep the module assembly visible in exports.
        for usage in service.get_field_usages(publish['id']):
            name = service.get_field(usage['source_field_id'])['name']
            if name in producers:
                note = '由模块子卡#' + str(producers[name]['reference_number']) + '产出；#3035按同一观测组装后统一发布。'
                before_usage = copy.deepcopy(usage)
                service.db.execute('UPDATE edge_field_usages SET usage_note=? WHERE id=?', (note, usage['id']))
                service._event(ACTOR, 'update', 'field_usage', usage['id'], before=before_usage,
                               after={**usage, 'usage_note': note})
        if service.db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Polars module: invalid graph')
        service.db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, spec['version']))
        service.db.commit()
    except Exception:
        service.db.rollback()
        raise
