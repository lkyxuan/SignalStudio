"""SS-61 design upgrade: reuse social.data without starting a producer/consumer."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded, stable
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'catalog/trending-channel.v1.json'
MARKER = 'trending_channel_v1'
ACTOR = 'ss61-trending-channel'


def _notes_topic(node):
    try:
        settings = json.loads(node['notes'])
        return settings.get('topic') if isinstance(settings, dict) else None
    except (ValueError, TypeError):
        return None


def ensure_trending_channel(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    if not service.db.execute("SELECT 1 FROM schema_meta WHERE key='coingecko_trending_contribution_v1'").fetchone():
        return
    spec = json.loads(CATALOG.read_text())
    model = CardModel(service)
    service.db.execute('BEGIN IMMEDIATE')
    try:
        source, consumer = [service.find_name(spec[key]) for key in ('source', 'consumer')]
        if not source or not consumer:
            raise ValueError('Trending channel upgrade: missing expected card')
        graph = service.graph()
        direct = [e for e in graph['edges'] if e['upstream_id'] == source['id'] and e['downstream_id'] == consumer['id']]
        if len(direct) != 1:
            raise ValueError('Trending channel upgrade: topology changed')
        edge = direct[0]
        # An existing custom channel needs review, never overwrite its resource/schema.
        for node in graph['nodes']:
            if node['kind'] == 'channel' and (node['name'] == spec['channel'] or
                    model.contract(node['id'])['config']['resource'].get('topic') == spec['topic'] or
                    _notes_topic(node) == spec['topic']):
                raise ValueError('Trending channel upgrade: existing social.data card requires review')
        if any(service.get_node(e['downstream_id'])['type'] == 'Redpanda Topic'
               for e in graph['edges'] if e['upstream_id'] == source['id']):
            raise ValueError('Trending channel upgrade: source already has a channel')
        for node in (source, consumer):
            if model.contract(node['id'])['config'].get('read_only'):
                raise ValueError('Trending channel upgrade: read-only card')
        if model.contract(consumer['id'])['config']['trigger']['kind'] != 'unspecified':
            raise ValueError('Trending channel upgrade: edited consumer trigger requires review')
        bindings = [b for b in graph['bindings'] if b['edge_id'] == edge['id']]
        if len(bindings) != 1 or bindings[0]['kind'] != 'data' or edge['transport_kind'] not in ('direct', 'unspecified'):
            raise ValueError('Trending channel upgrade: edited input binding requires review')
        binding = bindings[0]
        if (binding['branch'] or binding['source_port_id'] != stable(source['id'], 'output', 'out') or
                binding['target_port_id'] != stable(consumer['id'], 'input', 'in') or
                binding['config'].get('completion') != 'success' or
                binding['config'].get('temporal_boundary') is not None or
                binding['config'].get('unresolved') or binding['config'].get('trigger') not in ('none', 'event')):
            raise ValueError('Trending channel upgrade: edited input binding requires review')
        source_fields = {f['name']: f for f in service.get_fields(source['id'])}
        by_id = {f['id']: f['name'] for f in source_fields.values()}
        names = {f['name'] for f in spec['fields']}
        if not {f['name'] for f in json.loads((ROOT / 'catalog/coingecko-trending-contribution.v1.json').read_text())['source_fields']} <= source_fields.keys():
            raise ValueError('Trending channel upgrade: source schema changed')
        usages = service.get_field_usages(edge['id'])
        if any(by_id.get(u['source_field_id']) not in names for u in usages):
            raise ValueError('Trending channel upgrade: unmapped source field')
        # The existing source and consumer may be stacked too closely for a card between them.
        x = min(source['position_x'], consumer['position_x']) - 380
        y = (source['position_y'] + consumer['position_y']) / 2
        while any(abs(x - n['position_x']) < 340 and abs(y - n['position_y']) < 200 for n in graph['nodes']):
            x -= 380
        channel = service.create_node({'name': spec['channel'], 'type': 'Redpanda Topic',
            'workflow_lane': 'shared', 'definition': '复用既有social.data关注观测通道；本卡列出CoinGecko搜索热榜消息类别，专用注册项及运行待验证。',
            'notes': '', 'position_x': x, 'position_y': y, 'caveats': 'Studio设计已定义，不证明Broker消息、采集或评分已运行。'},
            actor=ACTOR, commit=False)
        fields = {}
        for field in spec['fields']:
            fields[field['name']] = service.create_field(channel['id'], field, actor=ACTOR, commit=False)
            if field['name'] not in source_fields:
                source_fields[field['name']] = service.create_field(source['id'], {
                    **field, 'definition': '采集器须提供的元数据，非API原生字段、非采集证据。' + field['definition']},
                    actor=ACTOR, commit=False)
        settings = {key: spec[key] for key in ('topic', 'message_key', 'payload_record_path',
                    'payload_schema', 'message_status', 'headers', 'header_registry', 'consumers', 'retention', 'rules')}
        settings['contract_ref'] = 'catalog/trending-channel.v1.json'
        service.db.execute('UPDATE nodes SET notes=?,updated_at=? WHERE id=?', (encoded(settings), now(), channel['id']))
        producer = service.create_edge({'upstream_id': source['id'], 'downstream_id': channel['id'],
            'rationale': 'SS-61：采集结果进入既有social.data；完整热榜快照与失败状态，非运行记录。',
            'transformation': 'coins及采集元数据→Value.data；Header source/type/category按专用注册项识别。'},
            actor=ACTOR, commit=False)
        for name, field in fields.items():
            service.create_field_usage(producer['id'], {'source_field_id': source_fields[name]['id'],
                'target_field_id': field['id'], 'usage_note': '映射到Value.data.' + name + '；设计要求，非实际消息。'},
                actor=ACTOR, commit=False)
        # Reuse the existing edge ID and preserve its target mappings and field-usage notes.
        service.db.execute("UPDATE edges SET upstream_id=?,rationale=?,transformation=?,transport_kind='direct' WHERE id=?", (
            channel['id'], 'SS-61：消费social.data中CoinGecko热榜快照，资产/身份表依赖保留。',
            '精确Header分派，校验Value.data；先幂等持久化判定再恢复评分投递，成功后确认offset。', edge['id']))
        for usage in usages:
            service.db.execute('UPDATE edge_field_usages SET source_field_id=? WHERE id=?',
                (fields[by_id[usage['source_field_id']]]['id'], usage['id']))
        used = {by_id[u['source_field_id']] for u in usages}
        for name in names - used:
            service.create_field_usage(edge['id'], {'source_field_id': fields[name]['id'],
                'usage_note': '校验本槽请求时间及成功/失败状态；缺失不评分。'}, actor=ACTOR, commit=False)
        service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
        model.ensure_edge(service.get_edge(edge['id']))
        service._event(ACTOR, 'update', 'edge', edge['id'], edge, service.get_edge(edge['id']))
        ref = {'path': 'catalog/trending-channel.v1.json', 'revision': hashlib.sha256(CATALOG.read_bytes()).hexdigest()}
        for node in (channel, consumer):
            before = model.contract(node['id'])
            config = copy.deepcopy(before['config'])
            config['definition_refs'].append(ref)
            if node['id'] == channel['id']:
                config['resource'] = settings
            else:
                config['trigger'] = {'kind': 'event', 'configuration_ref': ref}
            model.validate_config(config, before['kind'])
            service.db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(config), node['id']))
            service._event(ACTOR, 'update', 'node_contract', node['id'], before, model.contract(node['id']))
        if service.db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Trending channel upgrade: invalid graph')
        service.db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, spec['version']))
        service.db.commit()
    except Exception:
        service.db.rollback()
        raise
