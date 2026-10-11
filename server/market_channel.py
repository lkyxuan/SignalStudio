"""SS-60: one design channel for CoinGecko; no business consumer is started."""
import copy
import hashlib
import json
from pathlib import Path

from card_model import CardModel, encoded
from graph_service import now

ROOT = Path(__file__).resolve().parent.parent
CATALOG = ROOT / 'catalog/market-channel.v1.json'
MARKER = 'market_channel_v1'
ACTOR = 'ss60-market-channel'


def ensure_market_channel(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    # An empty workspace has no approved foundation to upgrade.
    if not service.db.execute("SELECT 1 FROM schema_meta WHERE key='leaderboard_foundation_v1'").fetchone():
        return
    spec = json.loads(CATALOG.read_text())
    model = CardModel(service)
    # Read and check under the same write lock, preventing concurrent graph edits.
    service.db.execute('BEGIN IMMEDIATE')
    try:
        nodes = {key: service.find_name(spec[key]) for key in
                 ('source', 'channel', 'retire', 'normalizer', 'candidate')}
        if not all(nodes.values()):
            raise ValueError('Market channel upgrade: missing expected card')
        source, channel, retired, normalizer, candidate = [nodes[k] for k in nodes]
        graph = service.graph()
        edges = {(e['upstream_id'], e['downstream_id']): e for e in graph['edges']}
        old_pairs = [(source['id'], retired['id']), (retired['id'], candidate['id']),
                     (source['id'], normalizer['id']), (source['id'], channel['id'])]
        if any(pair not in edges for pair in old_pairs):
            raise ValueError('Market channel upgrade: topology changed')
        retired_edges = {pair for pair in edges if retired['id'] in pair}
        if retired_edges != set(old_pairs[:2]):
            raise ValueError('Market channel upgrade: retired channel has other dependencies')
        if any((channel['id'], n['id']) in edges for n in (normalizer, candidate)):
            raise ValueError('Market channel upgrade: consumer already rewired')
        published = {e['downstream_id'] for e in graph['edges'] if e['upstream_id'] == source['id']
                     and service.get_node(e['downstream_id'])['type'] == 'Redpanda Topic'}
        if published != {retired['id'], channel['id']}:
            raise ValueError('Market channel upgrade: other source channels require review')
        historical = json.loads((ROOT / 'catalog/coingecko-implemented-signals.v1.json').read_text())
        old_topic = next(t for t in historical['topics'] if t['name'] == channel['name'])
        if channel['definition'] != old_topic['definition'] or channel['notes'] != (
                'catalog/coingecko-implemented-signals.v1.json · ' + historical['source_revision']):
            raise ValueError('Market channel upgrade: channel settings changed')
        if set(model.contract(channel['id'])['config']['resource']) - {'legacy_settings_ref'}:
            raise ValueError('Market channel upgrade: explicit channel resource requires review')
        for key in ('channel', 'normalizer', 'candidate'):
            if model.contract(nodes[key]['id'])['config'].get('read_only'):
                raise ValueError('Market channel upgrade: read-only card')
        fields = {key: {f['name']: f for f in service.get_fields(n['id'])}
                  for key, n in nodes.items()}
        rewires = [(edges[old_pairs[1]], 'retire', 'candidate'),
                   (edges[old_pairs[2]], 'source', 'normalizer')]
        # Preserve every mapped field; refuse an edited mapping we cannot transfer.
        for edge, old_key, target_key in rewires:
            old_fields = {f['id']: name for name, f in fields[old_key].items()}
            for usage in service.get_field_usages(edge['id']):
                if old_fields.get(usage['source_field_id']) not in fields['channel']:
                    raise ValueError('Market channel upgrade: channel lacks a mapped field')
        for path, target in spec['field_mapping'].items():
            if target not in fields['normalizer'] or (path not in fields['channel'] and path not in spec['required_metadata']):
                raise ValueError('Market channel upgrade: field contract changed')
        for path in spec['required_metadata']:
            if path not in fields['channel']:
                fields['channel'][path] = service.create_field(channel['id'], {
                    'name': path, 'data_type': 'string',
                    'definition': 'SS-60要求的采集元数据扩展；实际消息未核验，不是CoinGecko原生字段。'},
                    actor=ACTOR, commit=False)
        settings = {k: spec[k] for k in ('topic', 'message_key', 'payload_schema',
                    'payload_record_path', 'metadata_path', 'consumers', 'message_status')}
        settings.update(headers=[], retention='unknown', contract_ref='catalog/market-channel.v1.json',
                        required_metadata=spec['required_metadata'], rules=spec['rules_zh'])
        service.db.execute('UPDATE nodes SET definition=?,notes=?,updated_at=? WHERE id=?', (
            'CoinGecko唯一行情消息通道；供既有规则、候选与#3022独立消费。设计已定义，运行未核验。',
            encoded(settings), now(), channel['id']))
        for edge, old_key, target_key in rewires:
            before = copy.deepcopy(edge)
            old_fields = {f['id']: name for name, f in fields[old_key].items()}
            service.db.execute("UPDATE edges SET upstream_id=?,rationale=?,transformation=?,transport_kind='direct',transport_topic='',transport_key='',payload_schema='',transport_headers='[]',consumer_group='' WHERE id=?", (
                channel['id'], 'SS-60：消费同一market.snapshot；通道设置见#5004，非运行证明。',
                'Value根对象为行情；meta扩展待实现。缺失元数据不猜值，幂等持久化后确认消费。', edge['id']))
            for usage in service.get_field_usages(edge['id']):
                service.db.execute('UPDATE edge_field_usages SET source_field_id=? WHERE id=?',
                    (fields['channel'][old_fields[usage['source_field_id']]]['id'], usage['id']))
            service.db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            model.ensure_edge(service.get_edge(edge['id']))
            service._event(ACTOR, 'update', 'edge', edge['id'], before, service.get_edge(edge['id']))
        normal_edge = service.get_edge(edges[old_pairs[2]]['id'])
        existing = {(u['source_field_id'], u['target_field_id']) for u in service.get_field_usages(normal_edge['id'])}
        for path, target in spec['field_mapping'].items():
            pair = (fields['channel'][path]['id'], fields['normalizer'][target]['id'])
            if pair not in existing:
                service.create_field_usage(normal_edge['id'], {'source_field_id': pair[0], 'target_field_id': pair[1],
                    'usage_note': 'SS-60字段要求；meta须由采集器提供，实际发送未核验。'}, actor=ACTOR, commit=False)
        producer = edges[old_pairs[3]]
        existing = {(u['source_field_id'], u['target_field_id']) for u in service.get_field_usages(producer['id'])}
        for name in fields['source'].keys() & fields['channel'].keys():
            pair = (fields['source'][name]['id'], fields['channel'][name]['id'])
            if pair not in existing:
                service.create_field_usage(producer['id'], {'source_field_id': pair[0], 'target_field_id': pair[1],
                    'usage_note': '采集后发布一次；来源字段映射，非已发送记录。'}, actor=ACTOR, commit=False)
        # Do not fabricate source-response fields for collector-owned metadata.
        ref = {'path': 'catalog/market-channel.v1.json', 'revision': hashlib.sha256(CATALOG.read_bytes()).hexdigest()}
        for key in ('channel', 'normalizer', 'candidate'):
            node = nodes[key]
            before = model.contract(node['id'])
            config = copy.deepcopy(before['config'])
            config['definition_refs'].append({**ref, 'selector': {'role': key}})
            if key == 'channel':
                config['resource'] = settings
            if key == 'candidate':
                for definition in config['definition_refs']:
                    if definition['path'] == 'catalog/signal-contracts.v1.json':
                        definition['revision'] = hashlib.sha256((ROOT / definition['path']).read_bytes()).hexdigest()
                trigger_ref = config['trigger'].get('configuration_ref')
                if trigger_ref and trigger_ref.get('path') == 'catalog/signal-contracts.v1.json':
                    trigger_ref['revision'] = hashlib.sha256((ROOT / trigger_ref['path']).read_bytes()).hexdigest()
            if key == 'normalizer':
                config['trigger'] = {'kind': 'event', 'configuration_ref': ref}
                config['idempotency'] = {'key': 'observation_id', 'status': 'required_not_verified'}
            model.validate_config(config, before['kind'])
            service.db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(config), node['id']))
            service._event(ACTOR, 'update', 'node_contract', node['id'], before, model.contract(node['id']))
        service._event(ACTOR, 'update', 'node', channel['id'], channel, service.get_node(channel['id']))
        service._event(ACTOR, 'delete', 'node', retired['id'], before=retired)
        service.db.execute('DELETE FROM nodes WHERE id=?', (retired['id'],))
        if service.db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('Market channel upgrade: invalid graph')
        service.db.execute('INSERT INTO schema_meta VALUES (?,?)', (MARKER, spec['version']))
        service.db.commit()
    except Exception:
        service.db.rollback()
        raise
