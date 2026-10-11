import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLayout, feedbackRoutes, forwardLayoutEdges, layoutGroups, type LayoutNode } from './autoLayout';
const node = (id: string, kind = 'process', name = id): LayoutNode => ({ id, name, type: kind === 'source' ? 'Source' : 'Metric', kind });
const edge = (a: string, b: string) => ({ id: `${a}-${b}`, upstream_id: a, downstream_id: b });
function verify(nodes: LayoutNode[], edges: ReturnType<typeof edge>[]) {
  const before = structuredClone({ nodes, edges });
  const positions = autoLayout(nodes, edges);
  assert.deepEqual(autoLayout([...nodes].reverse(), [...edges].reverse()), positions);
  assert.deepEqual({ nodes, edges }, before);
  assert.equal(new Set(positions.map(p => p.id)).size, nodes.length);
  for (const a of positions) for (const b of positions) if (a.id !== b.id) assert.ok(Math.abs(a.position_x - b.position_x) >= 300 || Math.abs(a.position_y - b.position_y) >= 160);
  return new Map(positions.map(p => [p.id, p]));
}
test('global dependencies cross workflow ownership and keep shared resources in the route', () => {
  const nodes = [node('source', 'source'), { ...node('process'), workflow_lane: 'knowledge' }, { ...node('topic', 'channel'), workflow_lane: 'shared' }, { ...node('sink', 'table'), workflow_lane: 'signal' }];
  const edges = [edge('source', 'process'), edge('process', 'topic'), edge('topic', 'sink')];
  const p = verify(nodes, edges);
  for (const e of edges) assert.ok(p.get(e.upstream_id)!.position_x < p.get(e.downstream_id)!.position_x);
  assert.equal(layoutGroups(nodes, edges).length, 1);
});
test('all connected sources share the left column, even in a tall layer', () => {
  const sources = Array.from({ length: 12 }, (_, i) => node(`s${i}`, 'source'));
  const p = verify([...sources, node('join')], sources.map(n => edge(n.id, 'join')));
  assert.ok(sources.every(n => p.get(n.id)!.position_x === 0));
  assert.ok(p.get('join')!.position_x > 0);
});
test('Supabase is the rightmost top endpoint with its longest upstream route on top', () => {
  const nodes = [node('s', 'source'), node('p'), node('table', 'table'), node('sync'), node('supabase', 'table', 'supabase_asset_scores'), node('branch'), node('other', 'table')];
  const edges = [edge('s', 'p'), edge('p', 'table'), edge('table', 'sync'), edge('sync', 'supabase'), edge('p', 'branch'), edge('branch', 'other')];
  const p = verify(nodes, edges), end = p.get('supabase')!;
  assert.equal(end.position_x, Math.max(...[...p.values()].map(n => n.position_x)));
  assert.equal(end.position_y, Math.min(...[...p.values()].map(n => n.position_y)));
  assert.ok(p.get('other')!.position_y > end.position_y);
  for (const id of ['s', 'p', 'table', 'sync']) assert.equal(p.get(id)!.position_y, end.position_y);
});
test('only cycle-closing writes become feedback; intermediate and terminal writes remain forward', () => {
  const nodes = [node('s', 'source'), node('lookup'), node('identity', 'table'), node('create'), node('window', 'state'), node('rollup'), node('current', 'table'), node('sync'), node('end', 'table', 'supabase_asset_scores')];
  const edges = [edge('s', 'lookup'), edge('identity', 'lookup'), edge('lookup', 'create'), edge('create', 'identity'), edge('create', 'window'), edge('window', 'rollup'), edge('rollup', 'current'), edge('current', 'sync'), edge('sync', 'end')];
  const p = verify(nodes, edges), forward = forwardLayoutEdges(nodes, edges);
  assert.equal(forward.length, edges.length - 1);
  assert.ok(!forward.some(e => e.upstream_id === 'create' && e.downstream_id === 'identity'));
  for (const e of forward) assert.ok(p.get(e.upstream_id)!.position_x < p.get(e.downstream_id)!.position_x);
  const positioned = nodes.map(n => ({ ...n, ...p.get(n.id)! }));
  const routes = feedbackRoutes(positioned, edges);
  assert.deepEqual([...routes.keys()], ['create-identity']);
  assert.ok(routes.get('create-identity')! > p.get('create')!.position_y + 160);
});
test('unused sources are grouped below the connected route without graph mutations', () => {
  const nodes = [node('s', 'source'), node('end'), ...Array.from({ length: 19 }, (_, i) => node(`unused${i}`, 'source', `platform.operation${i}`)), node('aux', 'table')];
  const edges = [edge('s', 'end')], p = verify(nodes, edges);
  assert.equal(layoutGroups(nodes, edges).find(g => g.key === 'source:platform')!.nodes.length, 19);
  assert.ok(nodes.filter(n => n.id.startsWith('unused')).every(n => p.get(n.id)!.position_y > p.get('end')!.position_y + 160));
});
test('cycles, self links, duplicate and dangling edges produce deterministic finite positions', () => {
  const nodes = ['a', 'b', 'c'].map(id => node(id));
  const edges = [edge('a', 'b'), edge('b', 'a'), edge('b', 'c'), edge('a', 'b'), edge('c', 'c'), edge('missing', 'a')];
  const p = verify(nodes, edges);
  assert.ok([...p.values()].every(n => Number.isFinite(n.position_x) && Number.isFinite(n.position_y)));
  assert.deepEqual(autoLayout([], edges), []);
});

test('short branch endpoints stay near their producer and the Supabase connector has a clear top row', () => {
  const nodes = [node('source', 'source'), node('topic', 'channel'), node('lookup'), node('input', 'table'), node('end', 'table', 'supabase_asset_scores'), node('short'), node('deep1'), node('deep2'), node('deep3')];
  const edges = [edge('source', 'topic'), edge('topic', 'lookup'), edge('input', 'lookup'), edge('lookup', 'end'), edge('source', 'short'), edge('lookup', 'deep1'), edge('deep1', 'deep2'), edge('deep2', 'deep3')];
  const p = verify(nodes, edges);
  assert.equal(p.get('source')!.position_y, 56);
  assert.equal(p.get('topic')!.position_y, 56);
  assert.ok(p.get('input')!.position_y > 56);
  assert.ok(p.get('short')!.position_x < p.get('deep3')!.position_x);
  assert.ok(p.get('deep1')!.position_y > 56);
  assert.ok(p.get('deep2')!.position_y > 56);
});
