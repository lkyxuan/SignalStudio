import { traceRoute, type LayoutNode } from './autoLayout';

export function graphEmphasis(nodes: LayoutNode[], edges: { id: string; upstream_id: string; downstream_id: string }[], selection: {
  routeNodeId?: string | null; detailNodeId?: string | null; selectedEdgeId?: string | null; hoveredEdgeId?: string | null;
}) {
  // Details emphasize only incident edges; explicit double-click routes retain recursive traversal.
  const route = traceRoute(nodes, edges, selection.routeNodeId || '');
  if (!selection.routeNodeId && selection.detailNodeId && nodes.some(n => n.id === selection.detailNodeId)) {
    const validIds = new Set(nodes.map(n => n.id));
    route.nodeIds.add(selection.detailNodeId);
    for (const edge of edges) {
      if ((edge.upstream_id === selection.detailNodeId || edge.downstream_id === selection.detailNodeId) &&
          validIds.has(edge.upstream_id) && validIds.has(edge.downstream_id)) {
        route.nodeIds.add(edge.upstream_id); route.nodeIds.add(edge.downstream_id); route.edgeIds.add(edge.id);
      }
    }
  }
  const edgeId = selection.routeNodeId || selection.detailNodeId ? null : selection.selectedEdgeId || selection.hoveredEdgeId;
  const edge = edges.find(e => e.id === edgeId);
  if (edge && nodes.some(n => n.id === edge.upstream_id) && nodes.some(n => n.id === edge.downstream_id)) {
    route.nodeIds.add(edge.upstream_id); route.nodeIds.add(edge.downstream_id); route.edgeIds.add(edge.id);
  }
  return { ...route, active: route.nodeIds.size > 0 };
}
