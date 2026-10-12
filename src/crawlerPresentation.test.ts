import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLayout, crawlerLayout, traceRoute, type LayoutNode } from './autoLayout';
import { crawlerPresentation } from './crawlerPresentation';
import { arcStyles } from './edgeRouting';

const node = (id: string, kind = 'process', name = id): LayoutNode & { position_x: number; position_y: number; reference_number: number; definition: string } =>
  ({ id, name, kind, type: kind === 'source' ? 'Source' : 'Metric', position_x: 0, position_y: 0, reference_number: 1000 + id.length, definition: `Definition ${id}` });
const edge = (a: string, b: string) => ({ id: `${a}-${b}`, upstream_id: a, downstream_id: b });
function example() {
  const nodes = [node('markets', 'source', 'coingecko.coins_markets'), node('trending', 'source', 'coingecko.search_trending'), node('kaito', 'source', 'kaito.mcp.feed'),
    node('snapshot', 'channel'), node('up'), node('down'), node('volume'), node('social', 'channel'), node('award'), node('account'),
    node('table', 'table', 'asset_identifiers'), node('submit'), node('events', 'channel'), node('cache', 'state'), node('total'),
    node('db', 'table', 'supabase_asset_scores'), node('ui', 'interface', '资产得分页面')];
  const edges = [edge('markets', 'snapshot'), ...['up', 'down', 'volume'].map(id => edge('snapshot', id)), edge('volume', 'submit'),
    edge('trending', 'social'), edge('social', 'award'), edge('award', 'submit'), edge('kaito', 'account'), edge('account', 'submit'),
    ...['volume', 'award', 'account'].map(id => edge('table', id)), edge('account', 'table'),
    edge('submit', 'events'), edge('events', 'cache'), edge('cache', 'total'), edge('total', 'db'), edge('db', 'ui')];
  return { nodes, edges };
}
function arranged() {
  const g = example(), positions = autoLayout(g.nodes, g.edges);
  const nodes = g.nodes.map(n => ({ ...n, ...positions.find(p => p.id === n.id)! }));
  return { ...g, nodes, view: crawlerPresentation(nodes, g.edges) };
}

test('each operation has a disjoint tower wide enough for its own complex branches', () => {
  const g = example(), before = structuredClone(g), plan = crawlerLayout(g.nodes, g.edges);
  assert.deepEqual(g, before);
  assert.deepEqual(crawlerLayout([...g.nodes].reverse(), [...g.edges].reverse()), plan);
  assert.equal(plan.positions.length, g.nodes.length);
  const towers = ['markets', 'trending', 'kaito'].map(id => plan.occurrences.filter(n => n.towerId === id));
  for (const [i, tower] of towers.entries()) {
    assert.equal(tower.find(n => n.logicalId === ['markets', 'trending', 'kaito'][i])!.position_y, 96);
    if (i) assert.ok(Math.min(...tower.map(n => n.position_x)) - Math.max(...towers[i - 1]!.map(n => n.position_x + 300)) >= 720);
    const support = tower.find(n => n.logicalId === 'table')!;
    const main = tower.filter(n => n.logicalId !== 'table');
    assert.ok(Math.min(...main.map(n => n.position_x)) - support.position_x >= 960);
  }
  for (const a of plan.occurrences) for (const b of plan.occurrences) if (a.id !== b.id)
    assert.ok(Math.abs(a.position_x - b.position_x) >= 300 || Math.abs(a.position_y - b.position_y) >= 160);
  for (const id of ['up', 'down', 'volume']) assert.equal(plan.occurrences.find(n => n.logicalId === id)!.towerId, 'markets');
  const branches = ['up', 'down', 'volume'].map(id => plan.occurrences.find(n => n.logicalId === id)!);
  for (const a of branches) for (const b of branches)
    if (a.id !== b.id && a.position_y === b.position_y) assert.ok(Math.abs(a.position_x - b.position_x) >= 600);
  assert.equal(plan.occurrences.filter(n => n.logicalId === 'db').length, 1);
  assert.ok(plan.occurrences.find(n => n.logicalId === 'db')!.position_y > Math.max(...towers.flat().map(n => n.position_y)));
});

test('the same physical table and shared processors have local occurrences, stable IDs and shared content', () => {
  const { nodes, view } = arranged();
  for (const id of ['table', 'submit', 'events', 'cache', 'total']) {
    const copies = view.nodes.filter(n => n.logicalId === id);
    assert.equal(copies.length, 3);
    assert.equal(new Set(copies.map(n => n.id)).size, 3);
    assert.ok(copies.every(n => !/["\\\s]/.test(n.id)), 'ReactFlow uses IDs in unescaped attribute selectors');
    assert.equal(copies.filter(n => n.id === id).length, 1);
    assert.ok(copies.every(n => n.shared && n.reference_number === nodes.find(n => n.id === id)!.reference_number));
  }
  const changed = crawlerPresentation(nodes.map(n => n.id === 'table' ? { ...n, name: 'Renamed table', definition: 'One shared edit' } : n), example().edges);
  assert.ok(changed.nodes.filter(n => n.logicalId === 'table').every(n => n.name === 'Renamed table' && n.definition === 'One shared edit'));
});

test('local reads/writes stay inside their crawler and retain every logical relation', () => {
  const { edges, view } = arranged(), by = new Map(view.nodes.map(n => [n.id, n]));
  for (const e of view.edges) {
    const a = by.get(e.upstream_id)!, b = by.get(e.downstream_id)!;
    if (a.towerId && b.towerId) assert.equal(a.towerId, b.towerId);
    assert.equal(a.logicalId, edges.find(saved => saved.id === e.logicalEdgeId)!.upstream_id);
    assert.equal(b.logicalId, edges.find(saved => saved.id === e.logicalEdgeId)!.downstream_id);
  }
  assert.deepEqual(new Set(view.edges.map(e => e.logicalEdgeId)), new Set(edges.map(e => e.id)));
  const route = traceRoute(view.nodes, view.edges, 'trending');
  assert.ok(!route.nodeIds.has('markets') && !route.nodeIds.has('kaito'));
});

test('request and response occurrences pair locally without merging readers from other towers', () => {
  const { nodes, edges } = arranged();
  const displays: (ReturnType<typeof edge> & { relationship_id?: string; presentation_role?: string })[] = edges.flatMap(e => e.upstream_id === 'table' ? [{ ...e, relationship_id: e.id, presentation_role: 'response' },
    { ...e, id: `read-request:${e.id}`, relationship_id: e.id, presentation_role: 'request', upstream_id: e.downstream_id, downstream_id: e.upstream_id }] : [e]);
  const view = crawlerPresentation(nodes, edges, displays), arcs = arcStyles(view.nodes, view.edges);
  const pairs = new Map<string, typeof view.edges>();
  for (const e of view.edges) if (e.relationship_id) pairs.set(e.relationship_id, [...(pairs.get(e.relationship_id) || []), e]);
  assert.equal(pairs.size, 3);
  for (const pair of pairs.values()) {
    assert.equal(pair.length, 2);
    const [a, b] = pair;
    assert.equal(a!.upstream_id, b!.downstream_id);
    assert.equal(arcs.get(a!.id)!.sourcePort!.position, arcs.get(b!.id)!.targetPort!.position);
  }
});

test('saved coordinates survive refresh and dragging the logical card preserves mirror offsets', () => {
  const { nodes, edges, view } = arranged();
  const shifted = crawlerPresentation(nodes.map(n => n.id === 'table' ? { ...n, position_x: n.position_x + 45, position_y: n.position_y + 30 } : n), edges);
  for (const n of view.nodes) {
    const next = shifted.nodes.find(p => p.id === n.id)!;
    assert.equal(next.position_x - n.position_x, n.logicalId === 'table' ? 45 : 0);
    assert.equal(next.position_y - n.position_y, n.logicalId === 'table' ? 30 : 0);
  }
  assert.deepEqual(crawlerPresentation(structuredClone(nodes), structuredClone(edges)), view);
});

test('new crawlers receive towers automatically and same names never merge distinct logical IDs', () => {
  const g = example();
  const view = crawlerPresentation([...g.nodes, node('new', 'source', 'coingecko.new_operation'), node('other', 'table', 'asset_identifiers')],
    [...g.edges, edge('new', 'submit'), edge('other', 'submit')]);
  assert.ok(view.nodes.some(n => n.towerId === 'new' && n.logicalId === 'submit'));
  assert.ok(view.nodes.some(n => n.logicalId === 'other'));
  assert.ok(view.nodes.filter(n => n.logicalId === 'other').every(n => n.id !== 'table'));
});

test('shared maintenance gets a local table occurrence and does not draw its reads back through a crawler', () => {
  const g = example(), nodes = [...g.nodes, node('maintenance', 'process', '定期 AI 检查资产地图')];
  const edges = [...g.edges, edge('table', 'maintenance')];
  const plan = crawlerLayout(nodes, edges);
  assert.deepEqual(crawlerLayout([...nodes].reverse(), [...edges].reverse()), plan);
  const view = crawlerPresentation(nodes.map(n => ({ ...n, ...plan.positions.find(p => p.id === n.id)! })), edges);
  const local = view.nodes.find(n => n.logicalId === 'table' && n.towerId === null)!;
  assert.ok(local && local.id !== local.logicalId && local.shared);
  assert.equal(view.edges.find(e => e.logicalEdgeId === 'table-maintenance')!.upstream_id, local.id);
  assert.equal(plan.positions.filter(p => p.id === 'table').length, 1);
});
