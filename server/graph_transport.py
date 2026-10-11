"""Bounded, process-local canvas revisions; the database remains authoritative."""
from collections import OrderedDict
from copy import deepcopy
import hashlib
import json

COLLECTIONS = ('nodes', 'edges', 'fields', 'field_usages', 'requirements', 'ports', 'bindings', 'data_schemas')
DEFERRED = {
    'nodes': ('rationale', 'caveats', 'notes', 'validation_plan', 'validation_evidence'),
    'fields': ('notes', 'example_value', 'normalization_rule'),
    'field_usages': ('usage_note',),
    'requirements': ('expected_example',),
}


def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def detail_revision(entity, keys):
    return hashlib.sha256(encoded({key: entity.get(key, '') for key in keys})).hexdigest()[:32]


def canvas(graph):
    result = deepcopy(graph)
    result['transport'] = 'canvas.v1'
    for collection, keys in DEFERRED.items():
        for entity in result[collection]:
            if not any(entity.get(key) for key in keys):
                continue
            entity['detail_revision'] = detail_revision(entity, keys)
            entity['detail_loaded'] = False
            for key in keys:
                entity[key] = ''
    return result


def details(graph, node_ids):
    edges = {e['id'] for e in graph['edges'] if e['upstream_id'] in node_ids or e['downstream_id'] in node_ids}
    result = {'revision': graph['revision'], 'workspace': graph['workspace']}
    for key in DEFERRED:
        result[key] = []
        for entity in graph[key]:
            wanted = (entity['id'] in node_ids if key == 'nodes' else
                      entity['edge_id'] in edges if key == 'field_usages' else entity['node_id'] in node_ids)
            if wanted:
                result[key].append({**entity, 'detail_revision': detail_revision(entity, DEFERRED[key]), 'detail_loaded': True})
    return result


class GraphTransport:
    def __init__(self, limit=16, byte_limit=16_000_000):
        self.limit, self.byte_limit = limit, byte_limit
        self.history = OrderedDict()
        self.sizes = {}

    def response(self, graph, since=None):
        current = canvas(graph)
        base = self.history.get(since)
        revision = current['revision']
        if revision not in self.history:
            self.history[revision] = current
            self.sizes[revision] = len(encoded(current))
            while len(self.history) > self.limit or (sum(self.sizes.values()) > self.byte_limit and len(self.history) > 1):
                oldest, _ = self.history.popitem(last=False)
                self.sizes.pop(oldest)
        if not base:
            return current
        delta = {key: value for key, value in current.items() if key not in COLLECTIONS and base.get(key) != value}
        delta.update(transport='delta.v1', base_revision=since, changes={}, order={})
        for key in COLLECTIONS:
            old = {entity['id']: entity for entity in base.get(key, [])}
            new = {entity['id']: entity for entity in current.get(key, [])}
            delta['changes'][key] = {'upsert': [entity for identity, entity in new.items() if old.get(identity) != entity],
                                     'delete': [identity for identity in old if identity not in new]}
            order = [entity['id'] for entity in current.get(key, [])]
            if order != [entity['id'] for entity in base.get(key, [])]:
                delta['order'][key] = order
        # Large edits may be smaller as a fresh canvas snapshot.
        return delta if len(encoded(delta)) < len(encoded(current)) else current
