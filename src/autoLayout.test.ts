import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLayout, feedbackRoutes, supportRoutes, sideLayoutGroups, forwardLayoutEdges, layoutGroups, traceRoute, layoutStages, type LayoutNode } from './autoLayout';
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
  for (const e of edges) assert.ok(p.get(e.upstream_id)!.position_y < p.get(e.downstream_id)!.position_y);
  assert.equal(layoutGroups(nodes, edges).length, 1);
});
test('all connected sources share the top row, even in a wide layer', () => {
  const sources = Array.from({ length: 12 }, (_, i) => node(`s${i}`, 'source'));
  const p = verify([...sources, node('join')], sources.map(n => edge(n.id, 'join')));
  assert.ok(sources.every(n => p.get(n.id)!.position_y === 96));
  assert.ok(p.get('join')!.position_y > 96);
});
test('Supabase and terminal outputs share the bottom boundary', () => {
  const nodes = [node('s', 'source'), node('p'), node('table', 'table'), node('sync'), node('supabase', 'table', 'supabase_asset_scores'), node('branch'), node('other', 'table')];
  const edges = [edge('s', 'p'), edge('p', 'table'), edge('table', 'sync'), edge('sync', 'supabase'), edge('p', 'branch'), edge('branch', 'other')];
  const p = verify(nodes, edges), end = p.get('supabase')!;
  assert.equal(end.position_y, Math.max(...[...p.values()].map(n => n.position_y)));
  assert.equal(p.get('other')!.position_y, end.position_y);
  assert.equal(end.position_y - p.get('sync')!.position_y, 256);
  for (const id of ['s', 'p', 'table', 'sync']) assert.equal(p.get(id)!.position_x, end.position_x);
});
test('only cycle-closing writes become feedback; intermediate and terminal writes remain forward', () => {
  const nodes = [node('s', 'source'), node('lookup'), node('identity', 'table'), node('create'), node('window', 'state'), node('rollup'), node('current', 'table'), node('sync'), node('end', 'table', 'supabase_asset_scores')];
  const edges = [edge('s', 'lookup'), edge('identity', 'lookup'), edge('lookup', 'create'), edge('create', 'identity'), edge('create', 'window'), edge('window', 'rollup'), edge('rollup', 'current'), edge('current', 'sync'), edge('sync', 'end')];
  const p = verify(nodes, edges), forward = forwardLayoutEdges(nodes, edges);
  assert.equal(forward.length, edges.length - 1);
  assert.ok(!forward.some(e => e.upstream_id === 'create' && e.downstream_id === 'identity'));
  for (const e of forward) assert.ok(p.get(e.upstream_id)!.position_y < p.get(e.downstream_id)!.position_y);
  const positioned = nodes.map(n => ({ ...n, ...p.get(n.id)! }));
  const routes = feedbackRoutes(positioned, edges);
  assert.deepEqual([...routes.keys()], ['create-identity']);
  assert.ok(routes.get('create-identity')! > p.get('create')!.position_x + 300);
});
test('unused sources are grouped beside the connected route without graph mutations', () => {
  const nodes = [node('s', 'source'), node('end'), ...Array.from({ length: 19 }, (_, i) => node(`unused${i}`, 'source', `platform.operation${i}`)), node('aux', 'table')];
  const edges = [edge('s', 'end')], p = verify(nodes, edges);
  assert.equal(layoutGroups(nodes, edges).find(g => g.key === 'source:platform')!.nodes.length, 19);
  assert.ok(nodes.filter(n => n.id.startsWith('unused')).every(n => p.get(n.id)!.position_x > p.get('end')!.position_x + 300));
});
test('cycles, self links, duplicate and dangling edges produce deterministic finite positions', () => {
  const nodes = ['a', 'b', 'c'].map(id => node(id));
  const edges = [edge('a', 'b'), edge('b', 'a'), edge('b', 'c'), edge('a', 'b'), edge('c', 'c'), edge('missing', 'a')];
  const p = verify(nodes, edges);
  assert.ok([...p.values()].every(n => Number.isFinite(n.position_x) && Number.isFinite(n.position_y)));
  assert.deepEqual(autoLayout([], edges), []);
});

test('three leaderboards form the bottom row while real downstream content remains a side branch', () => {
  const boards = ['warming', 'hottest', 'emerging'].map(name => node(name, 'table', `leaderboard_${name}`));
  const nodes = [node('source', 'source'), node('p'), ...boards, node('candidate'), node('refresh'), node('content', 'table'), node('supabase', 'table', 'supabase_asset_scores')];
  const edges = [edge('source', 'p'), ...boards.map(n => edge('p', n.id)), ...boards.map(n => edge(n.id, 'candidate')), edge('candidate', 'refresh'), edge('refresh', 'content'), edge('content', 'refresh'), edge('p', 'supabase')];
  const p = verify(nodes, edges), footer = p.get('supabase')!.position_y;
  for (const board of boards) assert.equal(p.get(board.id)!.position_y, footer);
  assert.equal(p.get('hottest')!.position_x - p.get('warming')!.position_x, 380);
  assert.equal(p.get('emerging')!.position_x - p.get('hottest')!.position_x, 380);
  for (const id of ['candidate', 'refresh', 'content']) {
    assert.ok(p.get(id)!.position_y < footer);
    assert.ok(p.get(id)!.position_x > Math.max(...boards.map(n => p.get(n.id)!.position_x + 300)));
  }
  const routes = supportRoutes(nodes.map(n => ({ ...n, ...p.get(n.id)! })), edges);
  assert.ok(boards.every(n => routes.has(`${n.id}-candidate`)));
  assert.equal(traceRoute(nodes, edges, 'warming').nodeIds.has('content'), true);
});

test('selected route includes complete ancestors and descendants without unrelated fork siblings', () => {
  const nodes = ['s', 'fork', 'chosen', 'next', 'end', 'sibling', 'other', 'isolated'].map(id => node(id));
  const edges = [edge('s', 'fork'), edge('fork', 'chosen'), edge('chosen', 'next'), edge('next', 'end'), edge('fork', 'sibling'), edge('sibling', 'other')];
  const result = traceRoute(nodes, edges, 'chosen');
  assert.deepEqual([...result.nodeIds].sort(), ['chosen', 'end', 'fork', 'next', 's'].sort());
  assert.equal(result.edgeIds.size, 4);
  assert.equal(traceRoute(nodes, edges, 'missing').nodeIds.size, 0);
  assert.deepEqual([...traceRoute(nodes, edges, 'isolated').nodeIds], ['isolated']);
});
test('complete route traversal preserves cycles and excludes dangling edges', () => {
  const nodes = ['a', 'b', 'c'].map(id => node(id));
  const edges = [edge('a', 'b'), edge('b', 'a'), edge('b', 'c'), edge('missing', 'a')];
  const result = traceRoute(nodes, edges, 'b');
  assert.equal(result.nodeIds.size, 3); assert.equal(result.edgeIds.size, 3);
});
test('stage labels are presentation data and preserve saved coordinates', () => {
  const nodes = [node('s', 'source'), node('p'), node('end', 'table', 'supabase_asset_scores')], edges = [edge('s', 'p'), edge('p', 'end')];
  const positions = verify(nodes, edges);
  const positioned = nodes.map(n => ({ ...n, ...positions.get(n.id)! }));
  const stages = layoutStages(positioned, edges);
  assert.equal(stages[0]!.title, '爬虫入口'); assert.equal(stages.at(-1)!.title, '榜单与输出');
  assert.equal(stages.length, 3);
});

test('shared identifier lookup sits beside its users without changing processing depths or dropping reads/writes', () => {
  const lookup = node('lookup', 'table', 'asset_identifiers');
  const main = [node('s', 'source'), node('check'), node('create'), node('score'), node('topic', 'channel'), node('cache', 'state'), node('end', 'table', 'supabase_asset_scores')];
  const flow = [edge('s', 'check'), edge('check', 'create'), edge('create', 'score'), edge('score', 'topic'), edge('topic', 'cache'), edge('cache', 'end')];
  const shared = [edge('lookup', 'check'), edge('lookup', 'score'), edge('create', 'lookup')];
  const edges = [...flow, ...shared, edge('lookup', 'missing')], nodes = [...main, lookup];
  const p = verify(nodes, edges), plain = autoLayout(main, flow);
  for (const n of plain) assert.deepEqual(p.get(n.id), n);
  assert.ok(p.get('lookup')!.position_x + 300 < Math.min(...plain.map(n => n.position_x)));
  assert.equal(p.get('lookup')!.position_y, p.get('create')!.position_y);
  const positioned = nodes.map(n => ({ ...n, ...p.get(n.id)! }));
  const routes = supportRoutes(positioned, edges);
  assert.equal(routes.size, 3);
  assert.equal(routes.get('lookup-check')!.sourceShared, true);
  assert.equal(routes.get('create-lookup')!.sourceShared, false);
  assert.ok([...routes.values()].every(r => r.routeX > p.get('lookup')!.position_x + 300 && r.routeX < 0));
  assert.equal(feedbackRoutes(positioned, edges).size, 0);
  const stages = layoutStages(positioned, edges);
  assert.equal(stages.filter(s => s.id !== 'stage:assets').reduce((n, s) => n + s.count, 0), main.length);
  assert.equal(stages.find(s => s.id === 'stage:assets')!.count, 1);
  const trace = traceRoute(nodes, edges, 'lookup');
  assert.ok(shared.every(e => trace.edgeIds.has(e.id)));
});


test('reviewed public services and complete side workflows retain boundaries and actual directions', () => {
  const named = (id: string, name: string, kind = 'process') => node(id, kind, name);
  const nodes = [node('s', 'source'), node('lookup'), node('create'), node('contribution'), node('topic', 'channel'), node('cache', 'state'), node('rollup'), node('current', 'table'), node('board', 'table', 'leaderboard_hottest'),
    named('assets', 'assets', 'table'), named('ids', 'asset_identifiers', 'table'), named('ai', '定期 AI 检查资产地图'), named('review', '人工审核资产纠错建议', 'decision'), named('correct', '执行获批资产纠错'),
    named('coverage', 'leaderboard_coverage', 'table'), named('config', 'asset_initial_score_sources', 'table'), named('archive', '归档评分流水'), named('ledger', 'asset_score_events', 'table'),
    named('compare', 'Redis · 关注变化比较数据区', 'state'), named('trend', '判定关注趋势状态'), named('state', 'asset_attention_states', 'table'), named('unused', 'asset_relationships', 'table')];
  const flow = [edge('s', 'lookup'), edge('lookup', 'create'), edge('create', 'contribution'), edge('contribution', 'topic'), edge('topic', 'cache'), edge('cache', 'rollup'), edge('rollup', 'current'), edge('current', 'board')];
  const branches = [edge('assets', 'lookup'), edge('ids', 'lookup'), edge('create', 'assets'), edge('create', 'ids'), edge('assets', 'ai'), edge('ids', 'ai'), edge('ai', 'review'), edge('lookup', 'review'), edge('review', 'correct'), edge('correct', 'assets'), edge('correct', 'ids'), edge('coverage', 'rollup'), edge('config', 'contribution'), edge('topic', 'archive'), edge('archive', 'ledger'), edge('current', 'compare'), edge('coverage', 'compare'), edge('compare', 'trend'), edge('trend', 'state')];
  const edges = [...flow, ...branches], p = verify(nodes, edges), positioned = nodes.map(n => ({ ...n, ...p.get(n.id)! }));
  const groups = sideLayoutGroups(nodes, edges), ids = new Set(groups.flatMap(g => g.nodes.map(n => n.id)));
  assert.equal(ids.size, 12);
  assert.ok(!ids.has('unused') && !ids.has('topic') && !ids.has('cache') && !ids.has('current'));
  for (const g of groups) for (const n of g.nodes) assert.ok(g.side === 'left' ? p.get(n.id)!.position_x + 300 < 0 : p.get(n.id)!.position_x > p.get('board')!.position_x + 300);
  for (const [a, b] of [['ai', 'review'], ['review', 'correct'], ['archive', 'ledger'], ['compare', 'trend'], ['trend', 'state']] as const) assert.ok(p.get(a)!.position_y < p.get(b)!.position_y);
  const routes = supportRoutes(positioned, edges);
  assert.equal(routes.get('coverage-compare')!.sourceSide, 'right');
  assert.equal(routes.get('coverage-compare')!.targetSide, 'left');
  const crossY = routes.get('coverage-compare')!.targetTop;
  assert.ok(nodes.filter(n => !ids.has(n.id) && n.id !== 'unused').every(n => crossY < p.get(n.id)!.position_y || crossY > p.get(n.id)!.position_y + 160));
  assert.equal(routes.get('lookup-review')!.targetSide, 'right');
  assert.ok(!routes.has('ai-review') && !routes.has('archive-ledger'));
  assert.ok(branches.every(e => traceRoute(nodes, edges, e.upstream_id).edgeIds.has(e.id)));
  const stages = layoutStages(positioned, edges);
  assert.equal(stages.filter(g => /^stage:[0-9]+$/.test(g.id)).reduce((n, g) => n + g.count, 0), 9);
  assert.equal(stages.reduce((n, g) => n + g.count, 0), nodes.length - 1);
});
