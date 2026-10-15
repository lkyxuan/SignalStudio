"""SS-108 additive Studio mapping of fixed Few code; never runs the translator."""
import hashlib
import json
from pathlib import Path
from card_model import CardModel, encoded, stable

ROOT = Path(__file__).resolve().parent.parent
PATH = 'catalog/worth-reading-translation.v1.json'
MARKER = 'worth_reading_translation_ss108_v1'
ACTOR = 'ss108-worth-reading-translation'


def ensure_worth_reading_translation(service):
    db = service.db
    if db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    spec = json.loads((ROOT / PATH).read_text())
    model = CardModel(service)
    if not model.enabled():
        raise ValueError('SS-108 requires card model')
    if any(service.find_name(c['name']) for c in spec['cards']):
        raise ValueError('SS-108 card name conflict; existing cards must be reviewed')
    digest = hashlib.sha256((ROOT / PATH).read_bytes()).hexdigest()
    # Separate clear area; do not rearrange the user's saved graph.
    bottom = db.execute('SELECT MAX(position_y) FROM nodes').fetchone()[0]
    y = (bottom or 0) + 800
    nodes = {}
    db.execute('BEGIN IMMEDIATE')
    try:
        for c in spec['cards']:
            n = service.create_node({'name': c['name'], 'kind': c['kind'], 'workflow_lane': 'shared',
                'definition': c['description_zh'], 'formula': c['rule_zh'],
                'trigger_rule': '同一个content-translator服务每3分钟调度；非独立任务。' if c['key'] in ('summary','body','sync') else '既有写入或前端读取；Studio不执行。',
                'caveats': '固定代码848a64f已核对；测试网上线为Few回报，Studio未独立复验。生产未核验。图卡不执行翻译。',
                'notes': PATH + ' · ' + c['key'],
                'position_x': c['position'][0], 'position_y': y + c['position'][1]}, actor=ACTOR, commit=False)
            nodes[c['key']] = n
            for f in c['fields']:
                service.create_field(n['id'], {'name': f['name'], 'data_type': f['data_type'], 'definition': f['label_zh']}, actor=ACTOR, commit=False)
            cfg = model.contract(n['id'])['config']
            cfg['definition_refs'] = [{'path': PATH, 'revision': digest, 'selector': {'key': c['key']}}]
            cfg['resource'] = {'translation_key': c['key'], 'delivery': 'studio_mapping_only',
                'observed_rows': [], 'implementation_reference': spec['implementation_reference'],
                'evidence': spec['evidence'], 'service': spec['service'] if c['key'] in ('summary','body','sync','quota') else None}
            # External implementation is evidence, not an executable Studio action.
            cfg['action'] = {'id': '', 'version': 1, 'implementation': 'unknown'}
            cfg['trigger'] = {'kind': 'unspecified'}
            if c['kind'] == 'interface':
                cfg['interface'] = {'purpose_zh': c['description_zh'], 'purpose_en': c['description_en'],
                    'display_zh': [c['rule_zh']], 'display_en': [c['rule_en']], 'implementation': 'unverified', 'endpoint': '/app'}
            model.validate_config(cfg, c['kind'])
            db.execute('UPDATE node_contracts SET config=?,revision=revision+1 WHERE node_id=?', (encoded(cfg), n['id']))
        for e in spec['edges']:
            source, target = nodes[e['source']], nodes[e['target']]
            edge = service.create_edge({'upstream_id': source['id'], 'downstream_id': target['id'], 'transport_kind': 'direct',
                'rationale': 'SS-108：固定代码读写依赖映射；不是Studio执行绑定或运行证明。',
                'transformation': e['note'] or '原文版本和译文关联；不触发采集或翻译。'}, actor=ACTOR, commit=False)
            db.execute('DELETE FROM edge_bindings WHERE edge_id=?', (edge['id'],))
            model.add_binding(edge, {'kind': e['kind'], 'branch': '',
                'source_port_id': stable(source['id'], 'output', 'out'),
                'target_port_id': stable(target['id'], 'input', 'in'),
                'config': {'trigger': 'none', 'completion': 'success', 'unresolved': [], 'role': 'external_code_dependency'}})
            sf = {f['name']: f['id'] for f in service.get_fields(source['id'])}
            tf = {f['name']: f['id'] for f in service.get_fields(target['id'])}
            for name in e['fields']:
                service.create_field_usage(edge['id'], {'source_field_id': sf[name], 'target_field_id': tf.get(name),
                    'usage_note': '固定提交字段用途；非在线记录。' }, actor=ACTOR, commit=False)
        if db.execute('PRAGMA foreign_key_check').fetchall() or model.cycles():
            raise ValueError('SS-108 invalid graph')
        service._event(ACTOR, 'install_mapping', 'graph', MARKER, after={'nodes': [n['id'] for n in nodes.values()]})
        db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, spec['version']))
        db.commit()
    except Exception:
        db.rollback()
        raise
