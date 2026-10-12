import test from 'node:test';
import assert from 'node:assert/strict';
import { edgePresentation, edgeProcess, relationFocus, traceTriggers } from './edgePresentation';
import { graphEmphasis } from './graphEmphasis';
import { serverGraph } from './testFixtures';
import type { Graph, GraphNode } from './contracts';
const base = serverGraph(true);
const template = base.nodes.find(node => node.card_contract)!;
function node(id: string, kind: string, reference_number: number, name = id): GraphNode {
  return { ...template, id, kind, reference_number, name, card_contract: { ...template.card_contract!, node_id: id, kind,
    config: { ...template.card_contract!.config, definition_refs: [{ path: 'catalog/identity-flow-case.v1.json', revision: 'test' }] } } };
}
const nodes = [node('table', 'table', 1001), node('ids', 'table', 1002), node('review', 'decision', 4003),
  node('correct', 'process', 3003, '执行获批资产纠错'), node('other', 'process', 4002), node('writer', 'process', 3002)];
const rows = [
  ['trigger', 'review', 'correct', 'control', 'approve', 'event'],
  ['read', 'table', 'correct', 'read', '', 'none'], ['read-ids', 'ids', 'correct', 'read', '', 'none'],
  ['write', 'correct', 'table', 'write', '', 'none'], ['write-ids', 'correct', 'ids', 'write', '', 'none'],
  ['sibling', 'table', 'other', 'read', '', 'none'], ['previous-write', 'writer', 'table', 'write', '', 'none'],
];
const graph: Graph = { ...base, nodes, edges: rows.map(([id, upstream_id, downstream_id]) => ({ ...base.edges[0]!, id: id!, upstream_id: upstream_id!, downstream_id: downstream_id! })),
  bindings: rows.map(([edge_id, , , kind, branch, trigger]) => ({ id: edge_id!, edge_id: edge_id!, kind: kind as NonNullable<Graph['bindings']>[number]['kind'],
    branch: branch!, config: { trigger: trigger as 'none' | 'event' }, source_port_id: 'test', target_port_id: 'test' })) };
const edge = (id: string) => graph.edges.find(edge => edge.id === id)!;
const correction = nodes.find(node => node.id === 'correct')!;
test('selecting either read, trigger or write pairs the same process and excludes other table consumers/writers', () => {
  for (const id of ['trigger', 'read', 'read-ids', 'write', 'write-ids']) {
    assert.equal(edgeProcess(graph, edge(id))?.id, 'correct');
    const highlighted = graphEmphasis(nodes, graph.edges, { selectedEdgeId: id }, graph);
    assert.deepEqual([...highlighted.edgeIds].sort(), ['read', 'read-ids', 'trigger', 'write', 'write-ids']);
    assert.deepEqual([...highlighted.nodeIds].sort(), ['correct', 'ids', 'review', 'table']);
  }
  assert.equal(relationFocus(graph, 'table')?.id, 'table');
  assert.equal(relationFocus(graph, null, 'missing'), undefined);
  assert.equal(graphEmphasis(nodes, graph.edges, {}, graph).active, false);
});
test('approved correction stages are local, parallel reads share a stage, overview is unnumbered', () => {
  assert.equal(edgePresentation(graph, edge('trigger'), 'zh-CN', correction).label, '① 批准后触发');
  assert.equal(edgePresentation(graph, edge('read'), 'zh-CN', correction).label, '② 读取当前记录');
  assert.equal(edgePresentation(graph, edge('read-ids'), 'zh-CN', correction).label, '② 读取当前记录');
  assert.equal(edgePresentation(graph, edge('write'), 'zh-CN', correction).label, '③ 核对通过后写入');
  assert.equal(edgePresentation(graph, edge('read'), 'en', correction).label, '② Read current record');
  assert.equal(edgePresentation(graph, edge('read'), 'zh-CN').label, '读取');
  assert.equal(edgePresentation(graph, edge('sibling'), 'zh-CN', correction).label, '读取');
  const detached = { ...correction, card_contract: { ...correction.card_contract!, config: { ...correction.card_contract!.config, definition_refs: [] } } };
  assert.equal(edgePresentation(graph, edge('write'), 'zh-CN', detached).label, '写入');
});
test('all eight relation types, missing definitions, change triggers and multi-bindings retain their meaning', () => {
  const meanings = { data: '传递数据', control: '分支控制', read: '读取', write: '写入', publish: '发布消息', consume: '消费消息', error: '失败处理', reference: '引用' };
  for (const [kind, label] of Object.entries(meanings)) {
    const one: Graph = { ...graph, bindings: [{ ...graph.bindings![0]!, edge_id: 'read', kind: kind as NonNullable<Graph['bindings']>[number]['kind'], branch: '', config: { trigger: 'none' } }] };
    assert.equal(edgePresentation(one, edge('read'), 'zh-CN').label, label);
  }
  assert.equal(edgePresentation({ ...graph, bindings: [] }, edge('read'), 'zh-CN').label, '关系待定义');
  assert.equal(edgeProcess({ ...graph, bindings: [] }, edge('read')), undefined);
  const multi: Graph = { ...graph, bindings: [
    { ...graph.bindings![0]!, edge_id: 'read', kind: 'data', branch: '', config: { trigger: 'event', completion: 'success' } },
    { ...graph.bindings![0]!, edge_id: 'read', kind: 'error', branch: '', config: { trigger: 'event', completion: 'error' } },
  ] };
  assert.equal(edgePresentation(multi, edge('read'), 'zh-CN').label, '传递数据 · 事件触发 / 失败处理 · 事件触发');
  multi.bindings = [{ ...multi.bindings![0]!, kind: 'read', config: { trigger: 'change' } }];
  assert.equal(edgePresentation(multi, edge('read'), 'en').label, 'Read · Trigger on change');
  multi.bindings![0]!.config.unresolved = ['meaning_missing'];
  assert.match(edgePresentation(multi, edge('read'), 'zh-CN').label, /待完善/);
});

test('trigger ancestry follows messages and multiple entry points without crossing shared reads or writes', () => {
  const extraNodes = [node('crawler', 'source', 2030), node('topic', 'channel', 5003), node('timer', 'process', 9001)];
  extraNodes[0]!.card_contract!.config.trigger = { kind: 'schedule', interval_seconds: 60 };
  extraNodes[2]!.card_contract!.config.trigger = { kind: 'manual' };
  const extra = [
    ['publish', 'crawler', 'topic', 'publish', 'none'], ['consume', 'topic', 'review', 'consume', 'event'],
    ['manual', 'timer', 'review', 'data', 'event'],
  ];
  const chain: Graph = { ...graph, nodes: [...nodes, ...extraNodes], edges: [...graph.edges, ...extra.map(([id, upstream_id, downstream_id]) => ({ ...edge('read'), id: id!, upstream_id: upstream_id!, downstream_id: downstream_id! }))],
    bindings: [...structuredClone(graph.bindings!), ...extra.map(([id, , , kind, trigger]) => ({ ...graph.bindings![0]!, id: id!, edge_id: id!, kind: kind as NonNullable<Graph['bindings']>[number]['kind'], branch: '', config: { trigger: trigger as 'event' | 'none' } }))] };
  const trace = traceTriggers(chain, correction);
  assert.deepEqual([...trace.edgeIds].sort(), ['consume', 'manual', 'publish', 'trigger']);
  assert.deepEqual(trace.origins.map(origin => [origin.node.id, origin.reason]).sort(), [['crawler', 'schedule'], ['timer', 'manual']]);
  assert.equal(trace.nodeIds.has('table'), false);
  assert.equal(traceTriggers(chain, nodes[0]).origins.length, 0);
  const emphasized = graphEmphasis(chain.nodes, chain.edges, { selectedEdgeId: 'read' }, chain);
  assert.equal(emphasized.edgeIds.has('publish'), true);
  assert.equal(emphasized.edgeIds.has('previous-write'), false);
  chain.bindings!.find(binding => binding.edge_id === 'read')!.config.trigger = 'change';
  assert.ok(traceTriggers(chain, correction).origins.some(origin => origin.node.id === 'table' && origin.reason === 'change'));
  assert.equal(traceTriggers(chain, correction).edgeIds.has('previous-write'), false);
});
test('trigger cycles terminate and expose the unresolved origin rather than inventing a start', () => {
  const loop: Graph = { ...graph, edges: [...graph.edges, { ...edge('trigger'), id: 'back', upstream_id: 'correct', downstream_id: 'review' }],
    bindings: [...graph.bindings!, { ...graph.bindings![0]!, id: 'back', edge_id: 'back', branch: '' }] };
  const trace = traceTriggers(loop, correction);
  assert.equal(trace.edgeIds.size, 2);
  assert.ok(trace.origins.some(origin => origin.reason === 'cycle'));
});

test('attached module schedules remain definitions and detach cleanly', () => {
  const periodic = node('periodic', 'process', 4002, '定期 AI 检查资产地图');
  assert.equal(traceTriggers({ ...graph, nodes: [...nodes, periodic] }, periodic).origins[0]?.reason, 'schedule');
  periodic.card_contract!.config.definition_refs = [];
  assert.equal(traceTriggers({ ...graph, nodes: [...nodes, periodic] }, periodic).origins[0]?.reason, 'undefined');
});
