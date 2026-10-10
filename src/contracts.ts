import { z } from 'zod';

// These are wire contracts, rather than declarations that a crawler has run.
export const nodeTypes = [
  'Source', 'Raw Field', 'Evidence Check', 'Asset Resolution', 'Relationship Lookup',
  'Relationship Discovery', 'Review Decision', 'Derived Field', 'Metric', 'Score',
  'Ranking', 'Rule Evaluation', 'Flow Result', 'Signal Event', 'Product Module',
  'Redpanda Topic', 'Redis Window', 'Ranking Table', 'assets', 'asset_identifiers', 'asset_relationships',
  'asset_initial_score_sources', 'asset_monitoring_rules', 'asset_score_events', 'asset_scores_current', 'supabase_asset_scores',
  'Asset Registry', 'Rule Registry',
] as const;
export type NodeType = typeof nodeTypes[number];
export type Language = 'zh-CN' | 'en';
export type Translate = (text: string) => string;
const text = z.string();
const id = text.min(1);
const reference = z.number().int().positive().nullable();
export const cardContractSchema = z.looseObject({
  node_id: id, model_version: id, kind: id, revision: z.number().int().positive(),
  config: z.looseObject({ subtype: text, technology: text, environment: text,
    definition_refs: z.array(z.looseObject({path:id,revision:id})),
    action: z.looseObject({id:text,version:z.number().int().positive(),implementation:text}),
    profile: id, trigger:z.looseObject({kind:id}), join:z.looseObject({mode:id}),
    branches:z.array(z.looseObject({id,condition:text,terminal:z.boolean().optional()})),
    draft:z.boolean(),read_only:z.boolean(),
  }),
});
export const portSchema = z.object({id,node_id:id,key:id,direction:z.enum(['input','output']),schema_id:id.nullable()});
export const bindingSchema = z.object({id,edge_id:id,source_port_id:id,target_port_id:id,
  kind:z.enum(['data','control','read','write','publish','consume','error','reference']),branch:text,
  config:z.looseObject({trigger:z.enum(['none','event','change']).optional(),completion:z.enum(['success','error','completed']).optional()}),
});

export const nodeSchema = z.looseObject({
  id, name: id, type: z.enum(nodeTypes), reference_number: reference,
  definition: text, formula: text, rationale: text, caveats: text, notes: text,
  workflow_lane: z.enum(['shared', 'signal', 'knowledge']),
  position_x: z.number(), position_y: z.number(),
  is_catalog_source: z.union([z.literal(0), z.literal(1)]),
  is_system_state: z.union([z.literal(0), z.literal(1)]),
  decision_question: text, observation_window: text, trigger_rule: text,
  validation_plan: text, validation_evidence: text, signal_key: text,
  created_at: text, updated_at: text,
  kind: text.optional(), card_contract: cardContractSchema.nullable().optional(),
});
export const edgeSchema = z.looseObject({
  id, reference_number: reference, upstream_id: id, downstream_id: id,
  rationale: text, transformation: text, branch_label: text,
  transport_kind: z.enum(['unspecified', 'direct', 'redpanda']),
  transport_topic: text, transport_key: text, payload_schema: text,
  transport_headers: text, consumer_group: text, created_at: text,
});
export const fieldSchema = z.looseObject({
  id, node_id: id, name: id, data_type: text, definition: text, notes: text,
  example_value: text, unit: text, min_value: z.number().nullable(),
  max_value: z.number().nullable(), normalization_rule: text,
  catalog_field_id: text, ordinal: z.number().int(), created_at: text, updated_at: text,
});
export const usageSchema = z.looseObject({
  id, reference_number: reference, edge_id: id, source_field_id: id,
  target_field_id: id.nullable(), usage_note: text, created_at: text,
});
export const requirementSchema = z.looseObject({
  id, node_id: id, name: id, purpose: text, expected_example: text,
  source_field_id: id.nullable(), created_at: text, updated_at: text,
});
export const graphSchema = z.looseObject({
  revision: z.string().optional(), contract_revision: z.string().optional(),
  model_version: text.optional(), semantic_revision:text.optional(),presentation_revision:text.optional(),
  ports:z.array(portSchema).optional(),bindings:z.array(bindingSchema).optional(),
  data_schemas:z.array(z.object({id,node_id:id,version:z.number().int().positive(),field_ids:z.array(id)})).optional(),
  nodes: z.array(nodeSchema), edges: z.array(edgeSchema), fields: z.array(fieldSchema),
  field_usages: z.array(usageSchema), requirements: z.array(requirementSchema),
  types: z.array(z.enum(nodeTypes)),
}).superRefine((graph, context) => {
  const collections = ['nodes', 'edges', 'fields', 'field_usages', 'requirements','ports','bindings','data_schemas'] as const;
  for (const key of collections) {
    const seen = new Set<string>();
    (graph[key] || []).forEach((item, index) => {
      if (seen.has(item.id)) context.addIssue({ code: 'custom', path: [key, index, 'id'], message: 'Duplicate ID' });
      seen.add(item.id);
    });
  }
  const nodes = new Set(graph.nodes.map(node => node.id));
  const edges = new Map(graph.edges.map(edge => [edge.id, edge]));
  const fields = new Map(graph.fields.map(field => [field.id, field]));
  const check = (valid: boolean, path: (string | number)[]) => {
    if (!valid) context.addIssue({ code: 'custom', path, message: 'Invalid graph reference' });
  };
  graph.nodes.forEach((node,index)=>{
    if(node.card_contract) {
      check(node.card_contract.node_id===node.id,['nodes',index,'card_contract','node_id']);
      check(node.card_contract.kind===node.kind,['nodes',index,'kind']);
    }
  });
  graph.edges.forEach((edge, index) => {
    check(nodes.has(edge.upstream_id), ['edges', index, 'upstream_id']);
    check(nodes.has(edge.downstream_id), ['edges', index, 'downstream_id']);
  });
  const ports = new Map((graph.ports || []).map(port => [port.id,port]));
  const schemas = new Map((graph.data_schemas || []).map(schema => [schema.id,schema]));
  (graph.ports || []).forEach((port,index) => {
    check(nodes.has(port.node_id),['ports',index,'node_id']);
    check(!port.schema_id || schemas.get(port.schema_id)?.node_id === port.node_id,['ports',index,'schema_id']);
  });
  (graph.bindings || []).forEach((binding,index) => {
    const edge = edges.get(binding.edge_id), source = ports.get(binding.source_port_id), target = ports.get(binding.target_port_id);
    check(!!edge && source?.node_id === edge.upstream_id && source?.direction === 'output',['bindings',index,'source_port_id']);
    check(!!edge && target?.node_id === edge.downstream_id && target?.direction === 'input',['bindings',index,'target_port_id']);
  });
  (graph.data_schemas || []).forEach((schema,index) => schema.field_ids.forEach(field =>
    check(fields.get(field)?.node_id === schema.node_id,['data_schemas',index,'field_ids'])));
  graph.fields.forEach((field, index) => check(nodes.has(field.node_id), ['fields', index, 'node_id']));
  graph.requirements.forEach((need, index) => {
    check(nodes.has(need.node_id), ['requirements', index, 'node_id']);
    check(need.source_field_id === null || fields.has(need.source_field_id), ['requirements', index, 'source_field_id']);
  });
  graph.field_usages.forEach((usage, index) => {
    const edge = edges.get(usage.edge_id);
    check(!!edge, ['field_usages', index, 'edge_id']);
    check(!!edge && fields.get(usage.source_field_id)?.node_id === edge.upstream_id, ['field_usages', index, 'source_field_id']);
    check(usage.target_field_id === null || (!!edge && fields.get(usage.target_field_id)?.node_id === edge.downstream_id), ['field_usages', index, 'target_field_id']);
  });
});

export const sourceContractFieldSchema = z.looseObject({
  path: id, label_zh: text, type: text, evidence: text,
  purpose_zh: text.optional(), condition: text.optional(), example_value: z.unknown().optional(),
});
export const sourceOperationSchema = z.looseObject({
  id, source_id: id, label_zh: text, fields: z.array(sourceContractFieldSchema),
  documentation_url: text.optional(), endpoint: text.optional(), response_coverage: text,
});
export const sourceContractsSchema = z.looseObject({
  catalog_version: z.literal('source-contracts.v1'), owner: z.literal('SignalStudio'),
  revision: text.regex(/^sha256:[a-f0-9]{64}$/),
  source_count: z.number().int().nonnegative(),
  operation_count: z.number().int().nonnegative(), resource_count: z.number().int().nonnegative(),
  sources: z.array(z.looseObject({ id, label_zh: text })),
  operations: z.array(sourceOperationSchema), resources: z.array(sourceOperationSchema),
});
export type GraphNode = z.infer<typeof nodeSchema>;
export type GraphEdge = z.infer<typeof edgeSchema>;
export type NodeField = z.infer<typeof fieldSchema>;
export type DataRequirement = z.infer<typeof requirementSchema>;
export type Graph = z.infer<typeof graphSchema>;
export type SourceContracts = z.infer<typeof sourceContractsSchema>;
export type SourceOperation = z.infer<typeof sourceOperationSchema>;
export type Mutate = (path: string, method: 'POST' | 'PATCH' | 'DELETE', body: unknown, success?: string) => Promise<unknown>;
export type NodeContextProps = { node: GraphNode; graph: Graph; language: Language };

export interface CatalogField {
  name: string;
  path?: string;
  catalog_path?: string;
  catalog_label_cn?: string;
  label_cn?: string;
  catalog_display_label_cn?: string;
  display_label_cn?: string;
  selectable_reason?: string;
  presentation?: {
    example?: unknown; example_en?: unknown; label_zh?: string; label_en?: string;
    explanation_zh?: string; explanation_en?: string; purpose_zh?: string;
    use_case_zh?: string; role_zh?: string;
  };
}
