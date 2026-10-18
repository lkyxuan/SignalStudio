import { z } from 'zod';
import { reuseEntities, reuseValue } from './referenceReuse';
import { graphSchema, nodeSchema, fieldSchema, usageSchema, requirementSchema, type Graph } from './contracts';

export const collections = ['nodes', 'edges', 'fields', 'field_usages', 'requirements', 'ports', 'bindings', 'data_schemas'] as const;
const deferredKeys = {
  nodes:['rationale','caveats','notes','validation_plan','validation_evidence'],
  fields:['notes','example_value','normalization_rule'], field_usages:['usage_note'],requirements:['expected_example'],
} as const;
const deferred = ['nodes', 'fields', 'field_usages', 'requirements'] as const;
function withDetails(key: typeof deferred[number], entity: {id:string;[key:string]:unknown}, detail: {id:string;[key:string]:unknown}) {
  return {...entity, ...Object.fromEntries(deferredKeys[key].map(name=>[name, detail[name]])), detail_loaded:true};
}
const deltaSchema = z.looseObject({ transport: z.literal('delta.v1'), base_revision: z.string(), revision: z.string(),
  changes: z.record(z.string(), z.object({ upsert: z.array(z.looseObject({id:z.string()})), delete: z.array(z.string()) })),
  order: z.record(z.string(), z.array(z.string())),
});
export const detailsSchema = z.object({revision:z.string(),workspace:z.object({project_root:z.string(),database_path:z.string()}),
  nodes:z.array(nodeSchema),fields:z.array(fieldSchema),field_usages:z.array(usageSchema),requirements:z.array(requirementSchema)});

export function preserveDetails(next: Graph, previous?: Graph | null): Graph {
  if (!previous) return next;
  for (const key of deferred) {
    const old = new Map(previous[key].map(item => [item.id, item]));
    (next as Record<string, unknown>)[key] = next[key].map(item => {
      const cached = old.get(item.id);
      return item.detail_revision && cached?.detail_loaded === true && cached.detail_revision === item.detail_revision ? withDetails(key, item, cached) : item;
    });
  }
  return next;
}
function reuseGraph(next: Graph, previous?: Graph | null): Graph {
  if (!previous) return next;
  for (const key of collections) {
    if (next[key]) (next as Record<string, unknown>)[key] = reuseEntities<{id:string}>(next[key]!, previous[key] ?? []);
  }
  const current = next as Record<string, unknown>, old = previous as Record<string, unknown>;
  for (const key of Object.keys(current)) {
    if (!(collections as readonly string[]).includes(key)) current[key] = reuseValue(current[key], old[key]);
  }
  return Object.keys(current).length === Object.keys(old).length &&
    Object.keys(current).every(key => Object.hasOwn(old, key) && current[key] === old[key]) ? previous : next;
}
export function decodeGraph(value: unknown, base?: Graph | null): Graph {
  if ((value as Record<string, unknown>)?.transport !== 'delta.v1') return reuseGraph(preserveDetails(graphSchema.parse(value), base), base);
  const delta = deltaSchema.parse(value);
  if (!base || base.revision !== delta.base_revision || base.transport !== 'canvas.v1') throw Error('Invalid delta base');
  const result: Record<string, unknown> = { ...base, ...delta, transport: 'canvas.v1' };
  delete result.changes; delete result.order; delete result.base_revision;
  for (const key of collections) {
    const change = delta.changes[key], order = delta.order[key] ?? (base[key] || []).map(entity=>entity.id);
    if (!change || !order || new Set(order).size !== order.length) throw Error('Invalid delta collection');
    const entities = new Map<string, {id:string;[key:string]:unknown}>((base[key] || []).map(entity => [entity.id, entity]));
    for (const id of change.delete) entities.delete(id);
    for (const entity of change.upsert) entities.set(entity.id, entity);
    if (entities.size !== order.length || order.some(id => !entities.has(id))) throw Error('Invalid delta order');
    result[key] = order.map(id => entities.get(id));
  }
  return reuseGraph(preserveDetails(graphSchema.parse(result), base), base);
}
export function mergeDetails(graph: Graph, value: z.infer<typeof detailsSchema>): Graph {
  const next = { ...graph };
  for (const key of deferred) {
    const loaded = new Map(value[key].map(item => [item.id, item]));
    (next as Record<string, unknown>)[key] = graph[key].map(item => {
      const detail = loaded.get(item.id);
      return detail?.detail_loaded === true && detail.detail_revision === item.detail_revision ? withDetails(key, item, detail) : item;
    });
  }
  return reuseGraph(graphSchema.parse(next), graph);
}
export function detailsReady(graph: Graph | null, nodeIds: string[]): boolean {
  if (!graph) return false;
  const nodes = new Set(nodeIds);
  const edges = new Set(graph.edges.filter(edge => nodes.has(edge.upstream_id) || nodes.has(edge.downstream_id)).map(edge => edge.id));
  return deferred.every(key => graph[key].every(item => {
    const wanted = key === 'nodes' ? nodes.has(item.id) : key === 'field_usages' ? edges.has(String(item.edge_id)) : nodes.has(String(item.node_id));
    return !wanted || item.detail_loaded !== false;
  }));
}
