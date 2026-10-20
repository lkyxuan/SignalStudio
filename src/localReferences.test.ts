import test from 'node:test';
import assert from 'node:assert/strict';
import {crawlerPresentation,displayPositionUpdate} from './crawlerPresentation';
import {localReferenceId,localReferencePlan,parseLocalReference} from './localReferences';
import {processGraph} from './processFlows';
import {scopeGraph} from './featureTree';
import type {Graph} from './contracts';
const node=(id:string,name=id,kind='process')=>({id,name,kind,type:'Metric',reference_number:1000+id.length,definition:'shared definition',position_x:0,position_y:0,display_positions:{} as Record<string,{position_x:number;position_y:number}>});
const edge=(a:string,b:string)=>({id:`${a}-${b}`,upstream_id:a,downstream_id:b});
const graph=()=>({nodes:[node('input','input','table'),node('a'),node('b'),node('output','output','table')],edges:[edge('input','a'),edge('input','b'),edge('a','output'),edge('b','output')]});
const manual=(g:ReturnType<typeof graph>,anchor='a',target='input')=>{
 const id=localReferenceId(anchor,target);
 return {...g,nodes:g.nodes.map(n=>n.id===target?{...n,display_positions:{[id]:{position_x:450,position_y:550}}}:n)};
};
test('local references replace only the use-site edge and keep shared logical identity and every saved relation',()=>{
 const g=manual(graph()),before=JSON.stringify(g),view=crawlerPresentation(g.nodes,g.edges),id=localReferenceId('a','input');
 const copy=view.nodes.find(n=>n.id===id)!;
 assert.equal(copy.logicalId,'input');assert.equal(copy.referenceAnchor,'a');assert.equal(copy.definition,'shared definition');
 assert.ok(view.nodes.filter(n=>n.logicalId==='input').every(n=>n.shared));
 assert.ok(view.edges.some(e=>e.logicalEdgeId==='input-a'&&e.upstream_id===id&&e.downstream_id==='a'));
 assert.ok(!view.edges.some(e=>e.logicalEdgeId==='input-a'&&e.upstream_id==='input'));
 assert.ok(view.edges.some(e=>e.logicalEdgeId==='input-b'));
 assert.deepEqual(new Set(view.edges.map(e=>e.logicalEdgeId)),new Set(g.edges.map(e=>e.id)));
 assert.equal(JSON.stringify(g),before);
 const renamed=crawlerPresentation(g.nodes.map(n=>n.id==='input'?{...n,definition:'updated'}:n),g.edges);
 assert.ok(renamed.nodes.filter(n=>n.logicalId==='input').every(n=>n.definition==='updated'));
});
test('request and return remain a matched pair, with unchanged logical relationship and mappings',()=>{
 const g=manual(graph()),base={...g,bindings:[{id:'bind',edge_id:'input-a',kind:'read',config:{trigger:'none'}}]} as unknown as Graph;
 const p=processGraph(base),view=crawlerPresentation(g.nodes,g.edges,p.edges);
 const pair=view.edges.filter(e=>e.logicalEdgeId==='input-a'||e.logicalEdgeId==='read-request:input-a');
 assert.equal(pair.length,2);assert.equal(pair[0]!.relationship_id,pair[1]!.relationship_id);
 assert.equal(pair[0]!.upstream_id,pair[1]!.downstream_id);assert.equal(pair[0]!.downstream_id,pair[1]!.upstream_id);
 assert.equal(base.bindings?.length,1);
});
test('expansion is collision-free, idempotent and supports nested references without walking back through ancestors',()=>{
 const g=graph(),view=crawlerPresentation(g.nodes,g.edges),plan=localReferencePlan(view.nodes,g.edges,'a');
 assert.equal(plan.length,2);
 for(const p of plan)for(const other of [...view.nodes,...plan.filter(n=>n.id!==p.id)])
   assert.ok(Math.abs(p.position_x-other.position_x)>=324||Math.abs(p.position_y-other.position_y)>=184);
 const saved=g.nodes.map(n=>({...n,display_positions:Object.fromEntries(plan.filter(p=>p.node_id===n.id).map(p=>[p.id,{position_x:p.position_x,position_y:p.position_y}]))}));
 const expanded=crawlerPresentation(saved,g.edges),id=localReferenceId('a','input');
 assert.equal(localReferencePlan(expanded.nodes,g.edges,'a').length,0);
 const next=localReferencePlan(expanded.nodes,g.edges,id);
 assert.deepEqual(next.map(n=>n.node_id),['b']);
 const nested=saved.map(n=>({...n,display_positions:{...n.display_positions,...Object.fromEntries(next.filter(p=>p.node_id===n.id).map(p=>[p.id,p]))}}));
 const resolved=crawlerPresentation(nested,g.edges);
 assert.ok(resolved.nodes.some(n=>n.id===next[0]!.id));
 assert.ok(resolved.edges.some(e=>e.upstream_id===id&&e.downstream_id===next[0]!.id));
});
test('stale, malformed, disconnected and orphaned displays do not create graph cards or invented edges',()=>{
 const g=manual(graph(),'a','input');
 g.nodes.find(n=>n.id==='output')!.display_positions[localReferenceId('missing','output')]={position_x:1,position_y:2};
 const view=crawlerPresentation(g.nodes,g.edges.filter(e=>e.id!=='input-a'));
 assert.ok(!view.nodes.some(n=>n.referenceAnchor));
 for(const bad of ['local-reference:%','local-reference:null','local-reference:["a"]','local-reference:[1,2]'])assert.equal(parseLocalReference(bad),null);
});
test('automatic map copies are deterministic and survive arbitrary dragging without changing display or edge identity',()=>{
 const nodes=[node('markets','coingecko.coins_markets','source'),node('other','kaito.mcp.feed','source'),node('shared','asset_identifiers','table'),node('reader'),node('r2'),...Array.from({length:12},(_,i)=>node(`branch${i}`))];
 const edges=[edge('markets','reader'),edge('other','r2'),edge('shared','reader'),edge('shared','r2'),...Array.from({length:12},(_,i)=>[edge('markets',`branch${i}`),edge('shared',`branch${i}`)]).flat()];
 const before=JSON.stringify({nodes,edges}),view=crawlerPresentation(nodes,edges);
 assert.ok(view.nodes.some(n=>n.referenceAnchor));
 const reversed=crawlerPresentation([...nodes].reverse(),[...edges].reverse());
 assert.deepEqual(new Set(reversed.nodes.map(n=>n.id)),new Set(view.nodes.map(n=>n.id)));
 const moved=crawlerPresentation(nodes.map(n=>({...n,position_x:n.position_x+12345,position_y:-40000})),edges);
 assert.deepEqual(moved.nodes.map(n=>n.id),view.nodes.map(n=>n.id));assert.deepEqual(moved.edges,view.edges);
 assert.equal(JSON.stringify({nodes,edges}),before);
 const copy=view.nodes.find(n=>n.referenceAnchor)!,body=displayPositionUpdate(view.nodes,copy.id,{x:234,y:567});
 const positions=Object.fromEntries(body.initial_positions.map(p=>[p.id,{position_x:p.position_x,position_y:p.position_y}]));
 positions[copy.id]={position_x:234,position_y:567};
 const saved=nodes.map(n=>n.id===copy.logicalId?{...n,display_positions:positions}:n);
 const reloaded=crawlerPresentation(saved,edges);
 assert.equal(reloaded.nodes.find(n=>n.id===copy.id)!.position_x,234);
 for(const sibling of view.nodes.filter(n=>n.logicalId===copy.logicalId&&n.id!==copy.id)) {
  assert.equal(reloaded.nodes.find(n=>n.id===sibling.id)!.position_x,sibling.position_x);
  assert.equal(reloaded.nodes.find(n=>n.id===sibling.id)!.position_y,sibling.position_y);
 }
});
test('function views include only external references anchored inside the selected step',()=>{
 const nodes=[{id:'a',data:{id:'a'}},{id:'external',data:{id:'external'}},{id:'near',data:{id:'external',referenceAnchor:'a'}},{id:'far',data:{id:'a',referenceAnchor:'external'}}];
 const edges=[{id:'local',source:'near',target:'a'},{id:'far',source:'external',target:'far'}];
 const scoped=scopeGraph(nodes,edges,new Set(['a']));
 assert.deepEqual(scoped.nodes.map(n=>n.id),['a','near']);assert.deepEqual(scoped.edges.map(n=>n.id),['local']);
});
