"""Reversible SS-78 workspace scope; saved records and Few runtime stay untouched."""
import json
from pathlib import Path

SCOPE = json.loads((Path(__file__).resolve().parent.parent / 'catalog/workspace-scope.v1.json').read_text())


def scoped_graph(graph, scope=None):
    scope = SCOPE if scope is None else scope
    hidden = {item['node_id'] for item in scope['shelved_cards']}
    nodes = [n for n in graph['nodes'] if n['id'] not in hidden]
    node_ids = {n['id'] for n in nodes}
    edges = [e for e in graph['edges'] if e['upstream_id'] in node_ids and e['downstream_id'] in node_ids]
    edge_ids = {e['id'] for e in edges}
    fields = [f for f in graph['fields'] if f['node_id'] in node_ids]
    field_ids = {f['id'] for f in fields}
    requirements = [{**r, 'source_field_id': r['source_field_id'] if r.get('source_field_id') in field_ids else None}
                    for r in graph['requirements'] if r['node_id'] in node_ids]
    return {**graph, 'nodes': nodes, 'edges': edges, 'fields': fields, 'requirements': requirements,
            'field_usages': [u for u in graph['field_usages'] if u['edge_id'] in edge_ids],
            'workspace_scope': scope}
