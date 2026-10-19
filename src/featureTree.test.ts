import test from 'node:test';
import assert from 'node:assert/strict';
import {buildFeatureTree, featureLocation, graphSearchIndex, scopeGraph} from './featureTree';
import type {GraphNode} from './contracts';
const node=(id:string,name:string,kind='process')=>({id,name,kind,reference_number:42,type:'Metric'} as GraphNode);
test('every node is discoverable; renamed/future cards stay in library instead of inheriting a number',()=>{
 const nodes=[node('read','读取已有资料'),node('gap','判断资料缺口'),node('search','搜索补缺'),node('store','搜索资料暂存','table'),node('assemble','组装生成资料'),node('future','my new idea'),node('source','binance.usdm.klines','source')];
 const before=JSON.stringify(nodes),tree=buildFeatureTree(nodes);
 const members=tree.flatMap(f=>f.steps.flatMap(s=>s.nodes));
 assert.equal(members.length,nodes.length);assert.equal(new Set(members.map(n=>n.id)).size,nodes.length);
 assert.deepEqual(tree.find(f=>f.id==='webpage')!.steps.find(s=>s.id==='materials')!.nodes.map(n=>n.id),['read','gap','search','store','assemble']);
 assert.deepEqual(featureLocation(tree,'future'),{featureId:'library',stepId:'other'});
 assert.deepEqual(featureLocation(tree,'source'),{featureId:'library',stepId:'binance'});
 assert.equal(featureLocation(tree,'missing'),null);assert.equal(JSON.stringify(nodes),before);
});
test('scope removes off-scope ReactFlow entities without mutating identities, positions or crossing relationships',()=>{
 const nodes=[{id:'a-copy',data:{id:'a'},position:{x:100,y:200}},{id:'b',data:{id:'b'}},{id:'c',data:{id:'c'}},{id:'far-a',data:{id:'a'},position:{x:15000,y:15000}}];
 const edges=[{id:'ab',source:'a-copy',target:'b'},{id:'bc',source:'b',target:'c'}];
 const before=JSON.stringify({nodes,edges});const scoped=scopeGraph(nodes,edges,new Set(['a','b']));
 assert.deepEqual(scoped.nodes.map(n=>n.id),['a-copy','b']);assert.deepEqual(scoped.edges.map(e=>e.id),['ab']);
 assert.equal(scoped.nodes[0],nodes[0]);assert.equal(JSON.stringify({nodes,edges}),before);
 assert.equal(scopeGraph(nodes,edges,new Set()).nodes.length,0);
});
test('search indexes fields and requirements once, including cards outside the visible feature',()=>{
 const nodes=[node('a','读取已有资料'),node('b','unrelated')];
 const index=graphSearchIndex(nodes,[{node_id:'b',name:'asset_id',definition:'stable identity'}],[{node_id:'b',name:'evidence',purpose:'source freshness'}],name=>'translated '+name);
 assert.ok(index.get('b')!.includes('asset_id'));assert.ok(index.get('b')!.includes('source freshness'));
 assert.ok(index.get('a')!.includes('translated'));assert.ok(index.get('a')!.includes('#42'));
});

test('webpage writer module contains nine separate cards with one minimal business handoff',async()=>{
 const {default:spec}=await import('../catalog/asset-webpage-board.v1.json');
 const cards=spec.cards.slice(2).map((c,i)=>node(String(i),c.name,c.kind));
 const tree=buildFeatureTree(cards);
 const writer=tree.find(f=>f.id==='webpage')!.steps.find(s=>s.id==='writer')!;
 assert.equal(writer.nodes.length,9);
 assert.equal(new Set(writer.nodes.map(n=>n.id)).size,9);
 assert.deepEqual(spec.handoff.input_fields,['asset_id','action','page_ref']);
 assert.equal(spec.cards.slice(2).some(c=>c.fields.some(f=>['reason','run_id','expected_page_ref'].includes(f.name))),false);
});
