import type { Graph } from './contracts';
import { autoLayout, sideLayoutGroups } from './autoLayout';
import { taskRoles, type TaskRole } from './taskPresentation';

// Retain SS-58 dependency rows, side workflows and output anchors. Pack each
// occupied main row by responsibility; resource cards keep their own identity.
// This runs only on Arrange, never on page load or graph refresh.
export function taskLayout(graph: Pick<Graph, 'nodes' | 'edges' | 'bindings'>) {
  const positions = autoLayout(graph.nodes, graph.edges);
  const roles = taskRoles(graph);
  const sideIds = new Set(sideLayoutGroups(graph.nodes, graph.edges).flatMap(group => group.nodes.map(node => node.id)));
  const connected = new Set(graph.edges.flatMap(edge => [edge.upstream_id, edge.downstream_id]));
  const rank: Record<TaskRole, number> = { collection: 0, result: 1, business: 2, unknown: 3, resource: 4, maintenance: 5 };
  const rows = new Map<number, typeof positions>();
  for (const position of positions) if (connected.has(position.id) && !sideIds.has(position.id)) {
    rows.set(position.position_y, [...(rows.get(position.position_y) || []), position]);
  }
  for (const row of rows.values()) {
    const slots = row.map(position => position.position_x).sort((a, b) => a - b);
    row.sort((a, b) => rank[roles.get(a.id)!] - rank[roles.get(b.id)!] || a.position_x - b.position_x);
    row.forEach((position, index) => { position.position_x = slots[index]!; });
  }
  return positions;
}
