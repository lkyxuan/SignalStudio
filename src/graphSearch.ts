import type { Graph, GraphNode } from './contracts';

// Build text lazily: an empty locator must not scan or concatenate every field.
export function createNodeSearch(graph: Pick<Graph, 'fields' | 'requirements'>, describe: (node: GraphNode) => string) {
  let extra: Map<string, string[]> | undefined;
  const text = new WeakMap<GraphNode, string>();
  return (node: GraphNode, query: string): boolean => {
    if (!query) return true;
    if (!extra) {
      extra = new Map();
      const add = (id: string, value: string) => {
        const entries = extra!.get(id) ?? []; entries.push(value); extra!.set(id, entries);
      };
      for (const field of graph.fields) add(field.node_id, `${field.name} ${field.definition}`);
      for (const item of graph.requirements) add(item.node_id, `${item.name} ${item.purpose}`);
    }
    let value = text.get(node);
    if (value === undefined) {
      value = `${describe(node)} ${(extra.get(node.id) ?? []).join(' ')}`.toLowerCase();
      text.set(node, value);
    }
    return value.includes(query);
  };
}
