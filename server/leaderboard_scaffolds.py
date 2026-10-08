"""Install five design-only board paths once; never run scoring or provision Redis."""
import json
from pathlib import Path

CATALOG = Path(__file__).resolve().parent.parent / 'catalog/leaderboard-scaffolds.v1.json'
MARKER = 'leaderboard_scaffolds_v1'


def ensure_leaderboard_scaffolds(service):
    if service.db.execute('SELECT 1 FROM schema_meta WHERE key=?', (MARKER,)).fetchone():
        return
    catalog = json.loads(CATALOG.read_text())
    # Fail before writes if a user already owns any of these names.
    names = [board[role] for board in catalog['boards']
             for role in ('cache_name', 'calculator_name', 'table_name')]
    if any(service.find_name(name) for name in names):
        raise ValueError('Leaderboard scaffold name conflicts with an existing card')
    bottom = service.db.execute('SELECT COALESCE(MAX(position_y), 0) FROM nodes').fetchone()[0] + 300
    with service.db:
        for index, board in enumerate(catalog['boards']):
            nodes = []
            for column, (role, kind) in enumerate((('cache_name', 'Redis Window'),
                                                  ('calculator_name', 'Score'),
                                                  ('table_name', 'Ranking Table'))):
                node = service.create_node({
                    'name': board[role], 'type': kind, 'workflow_lane': 'signal',
                    'definition': f"{board['label_zh']}榜独立{'数据区' if column == 0 else '计算程序' if column == 1 else '结果表'}；设计骨架，尚未接入数据或运行。",
                    'formula': '独立算法待定义；数据来源、加分规则、窗口、衰减、资格及触发方式后续逐榜完善。' if column == 1 else '',
                    'caveats': '非部署或运行证据。与 total_heat 演示链路独立，不自动沿用 +100、7 天衰减、前 100 或 180 秒有效期。',
                    'notes': f"catalog/leaderboard-scaffolds.v1.json · {board['key']}",
                    'position_x': column * 440, 'position_y': bottom + index * 230,
                }, actor='system', commit=False)
                if column in (1, 2):
                    for field in catalog['columns']:
                        service.create_field(node['id'], {
                            'name': field['name'], 'data_type': field['data_type'],
                            'definition': field['label_zh'],
                        }, actor='system', commit=False)
                if column == 2:
                    service.db.execute('UPDATE nodes SET is_system_state=1 WHERE id=?', (node['id'],))
                nodes.append(node)
            for upstream, downstream in zip(nodes, nodes[1:]):
                service.create_edge({'upstream_id': upstream['id'], 'downstream_id': downstream['id'],
                                     'rationale': '规划的数据流向；尚无执行、写入或字段消费映射。'},
                                    actor='system', commit=False)
        service.db.execute('INSERT INTO schema_meta(key,value) VALUES (?,?)', (MARKER, '1'))
