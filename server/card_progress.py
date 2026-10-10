"""Attributed card progress, separate from executable definitions and readiness."""
import json
import hashlib
from card_model import ROOT, digest


def definition_revisions(graph):
    """Local behavior and adjacent schemas; titles/layout/report writes are presentation.

    Instance revision is deliberately omitted: a prose title edit is not a new
    behavior, while config, fields, mappings and pinned module changes are.
    """
    def clean(item, excluded=()):
        return {k: v for k, v in item.items() if k not in {'created_at', 'updated_at', *excluded}}

    revisions = {}
    for node in graph['nodes']:
        edges = [e for e in graph['edges'] if node['id'] in (e['upstream_id'], e['downstream_id'])]
        edge_ids = {e['id'] for e in edges}
        neighbors = {node['id']} | {e[k] for e in edges for k in ('upstream_id', 'downstream_id')}
        contract = clean(node.get('card_contract') or {}, ('revision',))
        modules = {}
        for ref in contract.get('config', {}).get('definition_refs', []):
            path = ROOT / ref['path']
            # Only hashes are exposed. Existing package validation owns allowed paths.
            modules[ref['path']] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else None
        revisions[node['id']] = digest({
            'node': clean(node, ('name', 'position_x', 'position_y', 'card_contract')),
            'contract': contract, 'modules': modules,
            'fields': [clean(f) for f in graph['fields'] if f['node_id'] in neighbors],
            'edges': [clean(e) for e in edges],
            'bindings': [b for b in graph.get('bindings', []) if b['edge_id'] in edge_ids],
            'usages': [clean(u) for u in graph['field_usages'] if u['edge_id'] in edge_ids],
            'requirements': [clean(r) for r in graph['requirements'] if r['node_id'] == node['id']],
        })
    return revisions


class CardProgress:
    def __init__(self, model):
        self.model, self.db = model, model.db

    def snapshot(self, graph):
        revisions = definition_revisions(graph)
        reports = [dict(row) for row in self.db.execute(
            'SELECT * FROM graph_definition_reports WHERE node_id IS NOT NULL ORDER BY created_at, rowid')]
        result = {}
        for node in graph['nodes']:
            node_id, revision = node['id'], revisions[node['id']]
            observed = [{**json.loads(r['report']), 'id': r['id']} for r in reports if r['node_id'] == node_id]
            current = [r for r in observed if r.get('definition_revision') == revision]
            # Each report is a complete observation, never merge a prior healthy
            # deployment into a newer partial/failed implementation report.
            latest = current[-1] if current else None
            result[node_id] = {'definition_revision': revision, 'report': latest,
                'stale': bool(observed and not latest)}
        return result
