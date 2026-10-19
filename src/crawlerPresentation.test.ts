import test from 'node:test';
import assert from 'node:assert/strict';
import { autoLayout, crawlerLayout, traceRoute, type LayoutNode } from './autoLayout';
import { crawlerPresentation, displayPositionUpdate, currentPresentationEdges } from './crawlerPresentation';
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

test('each shared display moves independently, survives reload and shares content', () => {
  const { nodes, edges, view } = arranged();
  for (const target of view.nodes.filter(n => n.logicalId === 'table')) {
    const body = displayPositionUpdate(view.nodes, target.id, {x:1234, y:5678});
    const display_positions = Object.fromEntries([...body.initial_positions, body.position].map(p => [p.id, {position_x:p.position_x, position_y:p.position_y}]));
    const saved = nodes.map(n => n.id === 'table' ? {...n, display_positions, definition:'Shared definition'} : n);
    const next = crawlerPresentation(structuredClone(saved), structuredClone(edges));
    for (const old of view.nodes) {
      const card = next.nodes.find(n => n.id === old.id)!;
      assert.equal(card.position_x, old.id === target.id ? 1234 : old.position_x);
      assert.equal(card.position_y, old.id === target.id ? 5678 : old.position_y);
      if (card.logicalId === 'table') assert.equal(card.definition, 'Shared definition');
    }
    assert.deepEqual(next.edges, view.edges);
  }
});

test('CoinGecko product lines keep outputs nearby while preserving shared output readers', () => {
  const nodes = [node('markets', 'source', 'coingecko.coins_markets'), node('kaito', 'source', 'kaito.mcp.feed'),
    node('snapshot', 'channel', 'Few Understand · market.snapshot'), node('metrics', 'process', 'Polars · 计算 CoinGecko 量价指标'),
    node('indicator', 'channel', 'Few Understand · indicator.data'), node('candidate', 'state', 'CoinGecko · 最热榜候选快照'),
    node('rank', 'process', '生成基础最热榜'), node('hot', 'table', 'leaderboard_hottest'),
    node('alert', 'process', 'CoinGecko · 24 小时大涨'), node('signal', 'channel', 'Few Understand · signal.data'),
    node('discover', 'process', 'CoinGecko · 核实并建档'), node('new-rank', 'process', '生成最新UUID榜'), node('new', 'table', 'leaderboard_new_uuid'),
    node('legacy', 'process', '量价评分 · 生成贡献'), node('warm-candidate', 'state', 'CoinGecko · 升温候选快照'),
    node('warm-baseline', 'process', 'CoinGecko · 计算升温日冻结基准'), node('warm-rank', 'process', '生成基础升温榜'),
    node('warming', 'table', 'leaderboard_warming'), node('content', 'process', '候选代币筛选')];
  const edges = [edge('markets','snapshot'), edge('snapshot','metrics'), edge('metrics','indicator'), edge('indicator','candidate'),
    edge('candidate','rank'), edge('rank','hot'), edge('indicator','alert'), edge('alert','signal'), edge('snapshot','discover'),
    edge('discover','new-rank'), edge('kaito','new-rank'), edge('new-rank','new'), edge('indicator','legacy'),
    edge('indicator','warm-candidate'), edge('warm-candidate','warm-baseline'), edge('warm-candidate','warm-rank'),
    edge('warm-baseline','warm-rank'), edge('warm-rank','warming'), edge('warming','content'), edge('hot','content')];
  const before = structuredClone({nodes,edges}), plan = crawlerLayout(nodes,edges);
  assert.deepEqual({nodes,edges},before);
  assert.deepEqual(crawlerLayout([...nodes].reverse(),[...edges].reverse()),plan);
  assert.equal(plan.positions.length,nodes.length);
  const market = plan.occurrences.filter(n => n.towerId === 'markets');
  const p = (id:string) => market.find(n => n.logicalId === id)!;
  assert.ok(p('candidate').position_y > p('indicator').position_y);
  assert.ok(p('rank').position_y > p('candidate').position_y && p('hot').position_y > p('rank').position_y);
  assert.ok(p('alert').position_x > p('rank').position_x);
  assert.ok(p('discover').position_x > p('alert').position_x);
  assert.ok(p('warm-candidate').position_x > p('discover').position_x);
  assert.ok(p('warm-baseline').position_y > p('warm-candidate').position_y);
  assert.ok(p('warm-rank').position_y > p('warm-baseline').position_y);
  assert.ok(p('warming').position_y > p('warm-rank').position_y);
  assert.ok(p('legacy').position_y > p('warming').position_y);
  for (const id of ['hot','new','warming']) assert.ok(plan.occurrences.some(n => n.logicalId === id && n.towerId === null));
  for (const a of plan.occurrences) for (const b of plan.occurrences) if (a.id !== b.id)
    assert.ok(Math.abs(a.position_x-b.position_x) >= 300 || Math.abs(a.position_y-b.position_y) >= 160);
  const view = crawlerPresentation(nodes.map(n => ({...n,...plan.positions.find(p => p.id === n.id)!})),edges);
  assert.deepEqual(new Set(view.edges.map(e => e.logicalEdgeId)),new Set(edges.map(e => e.id)));
  assert.equal(view.nodes.filter(n => n.logicalId === 'hot' && n.id === 'hot').length,1);
  assert.equal(view.nodes.filter(n => n.logicalId === 'new-rank' && n.towerId === 'kaito').length,1);
});


test('a replaced graph drops stale ReactFlow edges until occurrence state catches up',()=>{
 const retained={id:'retained'}, removed={id:'old-boundary'}, fresh={id:'new-boundary'};
 const visuals=new Map([['retained',{logicalEdgeId:'retained-relation'}],['new-boundary',{logicalEdgeId:'new-relation'}]]);
 const meanings=new Map([['retained-relation',{tone:'data'}],['new-relation',{tone:'write'}]]);
 const oldLocal=[retained,removed];
 assert.deepEqual(currentPresentationEdges(oldLocal,visuals,meanings),[retained]);
 assert.deepEqual(oldLocal,[retained,removed]);
 assert.deepEqual(currentPresentationEdges([retained,fresh],visuals,meanings),[retained,fresh]);
 assert.deepEqual(currentPresentationEdges([fresh],visuals,new Map()),[]);
});

test('Stocks forms one independent group, keeps legacy towers and shares identity cards', () => {
  const base=example(), before=crawlerLayout(base.nodes,base.edges);
  const stocks=[node('stock-list','source','coingecko.stocks.rwa_list'),node('stock-markets','source','coingecko.stocks.token_markets'),node('stock-identity','process','coingecko.stocks.identity')];
  const edges=[...base.edges,edge('stock-list','stock-identity'),edge('stock-markets','stock-identity'),edge('stock-identity','table')];
  const after=crawlerLayout([...base.nodes,...stocks],edges);
  assert.deepEqual(after.positions.filter(p=>!stocks.some(s=>s.id===p.id)),before.positions);
  assert.equal(after.occurrences.filter(p=>p.logicalId==='stock-identity').length,1);
  assert.equal(new Set(after.occurrences.filter(p=>stocks.some(s=>s.id===p.logicalId)).map(p=>p.towerId)).size,1);
  const view=crawlerPresentation([...base.nodes,...stocks],edges);
  const identityEdge=view.edges.find(e=>e.logicalEdgeId==='stock-identity-table')!;
  assert.equal(view.nodes.find(n=>n.id===identityEdge.upstream_id)!.towerId,view.nodes.find(n=>n.id===identityEdge.downstream_id)!.towerId);
  assert.equal(after.occurrences.filter(p=>p.logicalId==='table').length,before.occurrences.filter(p=>p.logicalId==='table').length+1);
});
