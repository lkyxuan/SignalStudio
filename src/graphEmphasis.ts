import { traceRoute, type LayoutNode } from './autoLayout';

export function graphEmphasis(nodes: LayoutNode[], edges: { id: string; upstream_id: string; downstream_id: string }[], selection: {
  routeNodeId?: string | null; detailNodeId?: string | null; selectedEdgeId?: string | null; hoveredEdgeId?: string | null;
}) {
  // Inspector selection never seeds a route, including while its card is hovered.
  const route = traceRoute(nodes, edges, selection.routeNodeId || '');
  const edgeId = selection.routeNodeId || selection.detailNodeId ? null : selection.selectedEdgeId || selection.hoveredEdgeId;
  const edge = edges.find(e => e.id === edgeId);
  if (edge && nodes.some(n => n.id === edge.upstream_id) && nodes.some(n => n.id === edge.downstream_id)) {
    route.nodeIds.add(edge.upstream_id); route.nodeIds.add(edge.downstream_id); route.edgeIds.add(edge.id);
  }
  return { ...route, active: route.nodeIds.size > 0 };
}
