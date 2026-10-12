import test from 'node:test';
import assert from 'node:assert/strict';
import type { Graph, GraphNode } from './contracts';
import { taskRoles, taskStarts, taskRegions } from './taskPresentation';
import { taskLayout } from './taskLayout';
import { processGraph, processFlow } from './processFlows';
const node = (id: string, kind = 'process', name = id, path = '', start = 'unspecified'): GraphNode => ({ id, kind, name, type: 'Metric', position_x: 0, position_y: 0,
  card_contract: { config: { definition_refs: path ? [{path, revision: 'test'}] : [], trigger: {kind: start} } } } as GraphNode);
const graph = (nodes: GraphNode[], links: [string, string, string, string, boolean?][]): Graph => ({ nodes,
  edges: links.map(([upstream_id, downstream_id], i) => ({ id: `e${i}`, reference_number: i + 1, upstream_id, downstream_id })),
  bindings: links.map(([, , kind, trigger, incomplete], i) => ({ id: `b${i}`, edge_id: `e${i}`, kind, config: { trigger, ...(incomplete ? {unresolved: ['missing']} : {}) } })),
} as Graph);
const identity = 'catalog/identity-flow-case.v1.json';
test('crawler event lineage crosses channels and calls, never shared storage or plain data', () => {
  const g = graph([node('s', 'source'), node('topic', 'channel'), node('p'), node('q'), node('table', 'table'), node('reader'), node('plain'), node('changed'), node('broken')],
    [['s','topic','publish','none'], ['topic','p','consume','event'], ['p','q','control','event'], ['p','table','write','none'], ['table','reader','read','none'], ['s','plain','data','none'], ['table','changed','read','change'], ['s','broken','data','event',true]]);
  const roles = taskRoles(g);
  assert.equal(roles.get('s'), 'collection'); assert.equal(roles.get('topic'), 'resource');
  assert.equal(roles.get('p'), 'result'); assert.equal(roles.get('q'), 'result');
  for (const id of ['reader', 'plain', 'changed', 'broken']) assert.equal(roles.get(id), 'unknown');
  assert.deepEqual(taskStarts(g, g.nodes.find(n=>n.id==='broken')!), ['unknown']);
});
test('maintenance is module-bound, supports manual/event entries and blocks inherited crawler role', () => {
  const g = graph([node('s','source'), node('ai','process','定期 AI 检查资产地图',identity), node('review','decision','人工审核资产纠错建议',identity), node('correct','process','执行获批资产纠错',identity)],
    [['s','review','control','event'], ['ai','review','data','none'], ['review','correct','control','event']]);
  const roles = taskRoles(g);
  for (const id of ['ai','review','correct']) assert.equal(roles.get(id), 'maintenance');
  assert.deepEqual(taskStarts(g, g.nodes[1]!), ['schedule']);
  assert.deepEqual(taskStarts(g, g.nodes[2]!), ['manual','event']);
  assert.deepEqual(taskStarts(g, g.nodes[3]!), ['event']);
  g.nodes[1]!.card_contract!.config.definition_refs = [];
  assert.equal(taskRoles(g).get('ai'), 'unknown'); assert.deepEqual(taskStarts(g,g.nodes[1]!), ['unknown']);
});
test('a schedule does not turn a crawler or a scoring task into maintenance', () => {
  const g=graph([node('s','source','custom','', 'schedule'),node('score','process','score','', 'schedule'),node('multi','process','multi','', 'schedule')], [['s','multi','data','event']]);
  assert.deepEqual([...taskRoles(g).values()], ['collection','business','business']);
  assert.deepEqual(taskStarts(g,g.nodes[2]!), ['schedule','event']);
  assert.deepEqual(taskStarts(g,node('ref','source','kaito.resource.narratives')), []);
});
test('cycle and multiple event entries terminate deterministically without reclassifying unknown origins', () => {
  const g=graph([node('s','source'),node('a'),node('b'),node('x'),node('y')], [['s','a','data','event'],['a','b','control','event'],['b','a','control','event'],['x','y','data','event'],['y','x','data','event']]);
  assert.equal(taskRoles(g).get('b'),'result'); assert.equal(taskRoles(g).get('x'),'unknown');
  assert.deepEqual(taskRoles({...g,nodes:[...g.nodes].reverse(),edges:[...g.edges].reverse(),bindings:[...g.bindings!].reverse()}).get('a'),'result');
});
test('regions follow saved positions, never enclose unrelated roles or resource cards', () => {
  const g=graph([node('a','source'),node('b','source'),node('resource','table')],[]);
  g.nodes[0]!.position_x=0;g.nodes[1]!.position_x=760;g.nodes[2]!.position_x=380;
  const before=structuredClone(g), regions=taskRegions(g);
  assert.equal(regions.length,2); assert.equal(regions.reduce((n,r)=>n+r.count,0),2);
  assert.deepEqual(g,before);
  g.nodes[2]!.position_y=600; g.nodes[1]!.position_x=380;
  assert.equal(taskRegions(g).length,1);
});
test('arrange preserves all graph data, unique cards, event and read pairs, and stable repeated output', () => {
  const g=graph([node('s','source'),node('ai','process','定期 AI 检查资产地图',identity),node('table','table','assets'),node('review','decision','人工审核资产纠错建议',identity),node('p')],
    [['s','p','data','event'],['table','ai','read','none'],['ai','review','data','none'],['p','review','control','event']]);
  const before=structuredClone(g), positions=taskLayout(g);
  assert.equal(new Set(positions.map(p=>p.id)).size,g.nodes.length);
  assert.deepEqual(g,before);
  assert.deepEqual(taskLayout({...g,nodes:[...g.nodes].reverse(),edges:[...g.edges].reverse()}),positions);
  const positioned={...g,nodes:g.nodes.map(n=>({...n,...positions.find(p=>p.id===n.id)!}))};
  assert.deepEqual(taskLayout(positioned),positions);
  const projected=processGraph(positioned);
  assert.equal(projected.edges.length,g.edges.length+1);
  assert.equal(processFlow(projected,'ai').edgeIds.size,3);
  assert.equal(processFlow(projected,'review').edgeIds.size,2);
  for (const a of positions) for(const b of positions) if(a.id!==b.id) assert.ok(Math.abs(a.position_x-b.position_x)>=300||Math.abs(a.position_y-b.position_y)>=160);
});
test('compact 224px side/library rows have disjoint responsibility backgrounds', () => {
  const g=graph(Array.from({length:8},(_,i)=>({...node(`s${i}`,'source'),position_x:i%2*380,position_y:Math.floor(i/2)*224})),[]);
  const regions=taskRegions(g);
  assert.equal(regions.reduce((sum,r)=>sum+r.count,0),8);
  for(const a of regions)for(const b of regions)if(a.id!==b.id)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
});
test('filters retain full-graph role evidence and overlapping resources suppress misleading regions', () => {
  const g=graph([node('s','source'),{...node('p'),position_y:300}], [['s','p','data','event']]);
  const regions=taskRegions(g,new Set(['p']));
  assert.equal(regions.length,1);assert.equal(regions[0]!.role,'result');
  g.nodes.push({...node('table','table'),position_y:300});
  assert.equal(taskRegions(g,new Set(['p','table'])).length,0);
});
