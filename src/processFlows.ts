import type { Graph, GraphEdge } from './contracts';
import { cardKind } from './cardModel';
import { edgeBindings, edgeProcess } from './edgePresentation';

type RelationGraph = Pick<Graph, 'nodes' | 'edges' | 'bindings'>;
const actionKinds = new Set(['source', 'process', 'decision']);

// A read request is a presentation of an existing access, never an executable binding.
export function processGraph<T extends RelationGraph>(graph: T): T {
  const edges: GraphEdge[] = [], bindings = [...(graph.bindings || [])];
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  for (const edge of graph.edges) {
    if (edge.presentation_role) { edges.push(edge); continue; }
    const links = edgeBindings(graph, edge);
    const source = byId.get(edge.upstream_id), target = byId.get(edge.downstream_id);
    const paired = source && target && ['table', 'state'].includes(cardKind(source)) &&
      actionKinds.has(cardKind(target)) && links.length > 0 &&
      links.every(binding => binding.kind === 'read' && binding.config.trigger === 'none' &&
        !(Array.isArray(binding.config.unresolved) && binding.config.unresolved.length));
    if (!paired) { edges.push(edge); continue; }
    edges.push({ ...edge, presentation_role: 'response', relationship_id: edge.id });
    const id = `read-request:${edge.id}`;
    edges.push({ ...edge, id, upstream_id: edge.downstream_id, downstream_id: edge.upstream_id,
      presentation_role: 'request', relationship_id: edge.id });
    bindings.push(...links.map(binding => ({ ...binding, id: `read-request:${binding.id}`, edge_id: id,
      source_port_id: binding.target_port_id, target_port_id: binding.source_port_id,
      config: { ...binding.config, trigger: 'none' as const } })));
  }
  return { ...graph, edges, bindings };
}

// Transitions can belong to both adjacent actions. Storage never joins their flows.
export function edgeFlows(graph: RelationGraph, edge?: GraphEdge) {
  if (!edge) return [];
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  const ids = new Set<string>();
  const add = (id: string) => { const node = byId.get(id); if (node && actionKinds.has(cardKind(node))) ids.add(id); };
  for (const binding of edgeBindings(graph, edge)) {
    if (binding.kind === 'read') add(edge.presentation_role === 'request' ? edge.upstream_id : edge.downstream_id);
    else if (['write', 'publish'].includes(binding.kind)) add(edge.upstream_id);
    else if (binding.kind === 'consume') add(edge.downstream_id);
    else if (['data', 'control', 'error'].includes(binding.kind)) { add(edge.upstream_id); add(edge.downstream_id); }
  }
  const owner = edgeProcess(graph, edge)?.id;
  return [...ids].sort((a, b) => Number(b === owner) - Number(a === owner)).map(id => byId.get(id)!);
}

export function processFlow(graph: RelationGraph, nodeId: string) {
  const nodeIds = new Set([nodeId]), edgeIds = new Set<string>();
  const valid = new Set(graph.nodes.map(node => node.id));
  for (const edge of graph.edges) if (valid.has(edge.upstream_id) && valid.has(edge.downstream_id) && edgeFlows(graph, edge).some(node => node.id === nodeId)) {
    nodeIds.add(edge.upstream_id); nodeIds.add(edge.downstream_id); edgeIds.add(edge.id);
  }
  return { nodeIds, edgeIds };
}

export function relationshipId(edge: GraphEdge | undefined) {
  return typeof edge?.relationship_id === 'string' ? edge.relationship_id : edge?.id;
}
