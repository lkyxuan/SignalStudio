import test from 'node:test';
import assert from 'node:assert/strict';
import { serverGraph } from './testFixtures';
import { processGraph, processFlow, edgeFlows, relationshipId } from './processFlows';
import { edgePresentation, isScheduled } from './edgePresentation';
import { graphEmphasis } from './graphEmphasis';
import type { Graph, GraphNode } from './contracts';

const base = serverGraph(true);
const node = (id: string, kind: string, reference_number: number): GraphNode => ({ ...base.nodes[0]!, id, name: id, kind, reference_number });
const nodes = [node('table', 'table', 1002), node('check', 'process', 4002), node('review', 'decision', 4003), node('other', 'process', 9001)];
const specs = [['read', 'table', 'check', 'read'], ['proposal', 'check', 'review', 'data'], ['other-read', 'table', 'other', 'read']];
const graph: Graph = { ...base, nodes, edges: specs.map(([id, upstream_id, downstream_id], index) => ({ ...base.edges[0]!, id: id!, upstream_id: upstream_id!, downstream_id: downstream_id!, reference_number: 24 + index })),
  bindings: specs.map(([id, , , kind]) => ({ ...base.bindings![0]!, id: id!, edge_id: id!, kind: kind as 'read' | 'data', branch: '', config: { trigger: 'none' } })) };

test('request and return share a processing flow with its output, not another reader of the same table', () => {
  const p = processGraph(graph);
  const expected = ['proposal', 'read', 'read-request:read'];
  for (const id of expected) {
    const focus = graphEmphasis(p.nodes, p.edges, { selectedEdgeId: id }, p);
    assert.deepEqual([...focus.edgeIds].sort(), expected);
    assert.deepEqual([...focus.nodeIds].sort(), ['check', 'review', 'table']);
  }
  const request = p.edges.find(edge => edge.id === 'read-request:read')!;
  assert.equal(request.upstream_id, 'check'); assert.equal(request.downstream_id, 'table');
  assert.equal(edgePresentation(p, request, 'zh-CN').displayLabel, 'L024-Q · 读取请求');
  assert.equal(edgePresentation(p, p.edges.find(edge => edge.id === 'read'), 'zh-CN').displayLabel, 'L024 · 返回数据');
  assert.equal(relationshipId(request), 'read');
  assert.deepEqual(edgeFlows(p, p.edges.find(edge => edge.id === 'proposal')).map(node => node.id), ['check', 'review']);
});

test('projection is deterministic, idempotent and never alters saved executable relations', () => {
  const before = structuredClone(graph), p = processGraph(graph);
  assert.deepEqual(graph, before); assert.deepEqual(processGraph(p), p);
  const labels = (g: Graph) => g.edges.map(edge => edgePresentation(g, edge, 'en').displayLabel.split(' · ')[0]).sort();
  assert.deepEqual(labels(processGraph({ ...graph, edges: [...graph.edges].reverse() })), labels(p));
  assert.equal(new Set(labels(p)).size, p.edges.length);
});

test('change subscriptions, mixed bindings, unresolved and dangling reads are not invented requests', () => {
  for (const config of [{ trigger: 'change' as const }, { trigger: 'none' as const, unresolved: ['unknown access'] }, {}]) {
    const g = { ...graph, bindings: graph.bindings!.map(binding => binding.edge_id === 'read' ? { ...binding, config } : binding) };
    assert.equal(processGraph(g).edges.some(edge => edge.id === 'read-request:read'), false);
  }
  const mixed = { ...graph, bindings: [...graph.bindings!, { ...graph.bindings![0]!, id: 'also-data', kind: 'data' as const }] };
  assert.equal(processGraph(mixed).edges.some(edge => edge.id === 'read-request:read'), false);
  assert.doesNotThrow(() => processGraph({ ...graph, nodes: [] }));
});

test('selecting a decision includes ten declared trigger inputs, outputs and reads without connecting their unrelated outputs', () => {
  const inputs = Array.from({ length: 10 }, (_, i) => node(`input-${i}`, 'process', 2000 + i));
  const extra = inputs.map(n => ({ ...graph.edges[0]!, id: n.id, upstream_id: n.id, downstream_id: 'review' }));
  const g = processGraph({ ...graph, nodes: [...nodes, ...inputs], edges: [...graph.edges, ...extra],
    bindings: [...graph.bindings!, ...extra.map(e => ({ ...graph.bindings![0]!, id: e.id, edge_id: e.id, kind: 'control' as const, config: { trigger: 'event' as const } }))] });
  const flow = processFlow(g, 'review');
  assert.equal(inputs.every(n => flow.edgeIds.has(n.id)), true);
  assert.equal(flow.edgeIds.has('proposal'), true); assert.equal(flow.edgeIds.has('read'), false);
});

test('references retain uncertainty and cannot glue independent steps through storage', () => {
  const g = { ...graph, bindings: graph.bindings!.map(binding => ({ ...binding, kind: 'reference' as const })) };
  assert.equal(processFlow(g, 'check').edgeIds.size, 0);
  assert.equal(processGraph(g).edges.length, graph.edges.length);
  assert.equal(edgeFlows(g, g.edges[0]).length, 0);
});

test('clock badge follows actual schedule or attached known module and disappears when detached', () => {
  const scheduled = { ...nodes[1]!, card_contract: structuredClone(base.nodes.find(node => node.card_contract)!.card_contract!) };
  scheduled.card_contract!.config.trigger.kind = 'schedule'; assert.equal(isScheduled(scheduled), true);
  scheduled.card_contract!.config.trigger.kind = 'event'; scheduled.card_contract!.config.definition_refs = [];
  assert.equal(isScheduled(scheduled), false);
  scheduled.name = '定期 AI 检查资产地图'; scheduled.card_contract!.config.definition_refs = [{ path: 'catalog/identity-flow-case.v1.json', revision: 'test' }];
  assert.equal(isScheduled(scheduled), true);
  scheduled.card_contract!.config.definition_refs = []; assert.equal(isScheduled(scheduled), false);
  scheduled.name = 'kaito.mcp.kaito_smart_following_market';
  scheduled.card_contract!.config.definition_refs = [{ path: 'catalog/source-contracts.v1.json', revision: 'test' }];
  assert.equal(isScheduled(scheduled), true, 'the structured source collection plan supplies its timer');
  scheduled.card_contract!.config.definition_refs = []; assert.equal(isScheduled(scheduled), false);
});
