"""Consistent graph snapshots and an optimistic guard for local UI writes."""
import hashlib
import json


class RevisionConflict(Exception):
    pass


def snapshot(service, contract_revision=''):
    owned = not service.db.in_transaction
    if owned:
        service.db.execute('BEGIN')
    try:
        graph = service.graph()
        graph['contract_revision'] = contract_revision
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
