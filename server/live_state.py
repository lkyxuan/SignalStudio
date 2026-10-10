"""Consistent graph snapshots and an optimistic guard for local UI writes."""
import hashlib
import json


class RevisionConflict(Exception):
    pass


def snapshot(service, contract_revision='', include_progress=True):
    owned = not service.db.in_transaction
    if owned:
        service.db.execute('BEGIN')
    try:
        graph = service.graph()
        graph['contract_revision'] = contract_revision
        presentation = {node['id']: [node['position_x'],node['position_y']] for node in graph['nodes']}
        semantic = json.loads(json.dumps(graph))
        for node in semantic['nodes']:
            for key in ('position_x','position_y','updated_at'):
                node.pop(key, None)
        graph['semantic_revision'] = hashlib.sha256(json.dumps(semantic, sort_keys=True, ensure_ascii=False,
            separators=(',', ':')).encode()).hexdigest()
        graph['presentation_revision'] = hashlib.sha256(json.dumps(presentation, sort_keys=True,
            separators=(',', ':')).encode()).hexdigest()
        if include_progress and service.db.execute("SELECT 1 FROM sqlite_master WHERE name='node_contracts'").fetchone():
            from card_model import CardModel
            from card_progress import CardProgress
            graph['card_progress'] = CardProgress(CardModel(service)).snapshot(graph)
        graph['revision'] = hashlib.sha256(json.dumps(graph, sort_keys=True, ensure_ascii=False,
            separators=(',', ':')).encode()).hexdigest()
        return graph
    finally:
        if owned:
            service.db.rollback()


def guard(service, expected, contract_revision=''):
    # The write lock makes revision comparison atomic with the following write,
    # even if another backend process shares the same SQLite database.
    service.db.execute('BEGIN IMMEDIATE')
    if snapshot(service, contract_revision)['revision'] != expected:
        service.db.rollback()
        raise RevisionConflict('工作台已被外部更新。请先选择如何处理未保存编辑。')
