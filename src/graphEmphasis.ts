import { edgeProcess, traceTriggers } from './edgePresentation';
import type { Graph } from './contracts';
import { traceRoute, type LayoutNode } from './autoLayout';

export function graphEmphasis(nodes: LayoutNode[], edges: { id: string; upstream_id: string; downstream_id: string }[], selection: {
  routeNodeId?: string | null; detailNodeId?: string | null; selectedEdgeId?: string | null; hoveredEdgeId?: string | null;
}, graph?: Pick<Graph, 'nodes' | 'edges' | 'bindings'>) {
  const owner = !selection.routeNodeId && !selection.detailNodeId && selection.selectedEdgeId && graph
    ? edgeProcess(graph, graph.edges.find(edge => edge.id === selection.selectedEdgeId)) : undefined;
  if (owner) selection = { ...selection, detailNodeId: owner.id };
  // Focus pairs incident relations and declared trigger ancestry; explicit complete routes retain dependency traversal.
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
  if (graph && !selection.routeNodeId && selection.detailNodeId) {
    const focus = graph.nodes.find(node => node.id === selection.detailNodeId);
    if (focus && ['source', 'process', 'decision'].includes(focus.kind || focus.card_contract?.kind || '')) {
      const triggers = traceTriggers(graph, focus);
      for (const id of triggers.nodeIds) route.nodeIds.add(id);
      for (const id of triggers.edgeIds) route.edgeIds.add(id);
    }
  }
  const edgeId = selection.routeNodeId || selection.detailNodeId ? null : selection.selectedEdgeId || selection.hoveredEdgeId;
  const edge = edges.find(e => e.id === edgeId);
  if (edge && nodes.some(n => n.id === edge.upstream_id) && nodes.some(n => n.id === edge.downstream_id)) {
    route.nodeIds.add(edge.upstream_id); route.nodeIds.add(edge.downstream_id); route.edgeIds.add(edge.id);
  }
  return { ...route, active: route.nodeIds.size > 0 };
}
