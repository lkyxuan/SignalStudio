import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeGraph, mergeDetails, detailsReady, collections } from './graphTransport';
import { cachedSourceContracts } from './sourceContractCache';
import { serverGraph } from './testFixtures';
import { readFileSync } from 'node:fs';

test('delta reconstruction validates references, deletes entities, preserves order and loaded detail only by hash', () => {
  const raw = serverGraph();
  const base = {...raw,revision:'a',transport:'canvas.v1',nodes:raw.nodes.map(n=>({...n,detail_revision:n.id,detail_loaded:true}))};
  const next = {...base,revision:'b',nodes:base.nodes.map((n,i)=>i===0?{...n,name:'changed',detail_loaded:false,detail_revision:'new'}:{...n,detail_loaded:false})};
  const {nodes:_,edges:__,fields:___,field_usages:____,requirements:_____,ports:______,bindings:_______,data_schemas:________,...meta}=next;
  const delta = {...meta,transport:'delta.v1',base_revision:'a',changes:Object.fromEntries(collections.map(key=>[key,{upsert:key==='nodes'?[next.nodes[0]]:[],delete:[] as string[]}])),order:Object.fromEntries(collections.map(key=>[key,(next[key]||[]).map(n=>n.id)]))};
  const decoded = decodeGraph(delta,base);
  assert.equal(decoded.nodes[0]!.name,'changed'); assert.equal(decoded.nodes[0]!.detail_loaded,false);
  assert.equal(decoded.nodes[1]!.detail_loaded,true);
  assert.throws(()=>decodeGraph({...delta,base_revision:'wrong'},base),/base/);
  const broken=structuredClone(delta); broken.order.nodes!.push('unknown'); assert.throws(()=>decodeGraph(broken,base),/order/);
  const deleted=structuredClone(delta); deleted.changes.requirements!.delete=base.requirements.map(n=>n.id); deleted.order.requirements=[];
  assert.equal(decodeGraph(deleted,base).requirements.length,0);
});
test('detail hydration never overwrites a newer entity or bypasses graph references', () => {
  const raw=serverGraph(), node=raw.nodes[0]!;
  const graph={...raw,revision:'a',nodes:raw.nodes.map(n=>({...n,detail_revision:n.id,detail_loaded:false}))};
  const value={revision:'a',workspace:{project_root:'/test',database_path:'/test/db'},nodes:[{...node,notes:'loaded',detail_revision:node.id,detail_loaded:true}],fields:[],field_usages:[],requirements:[]};
  assert.equal(detailsReady(graph,[node.id]),false);
  const loaded=mergeDetails(graph,value); assert.equal(detailsReady(loaded,[node.id]),true);
  assert.equal(loaded.nodes[0]!.notes,'loaded');
  assert.equal(mergeDetails({...graph,nodes:[{...graph.nodes[0]!,detail_revision:'new'},...graph.nodes.slice(1)]},value).nodes[0]!.detail_loaded,false);
});
test('directory cache reuses its independent revision and refetches corrupted or obsolete payloads', async () => {
  const directory=JSON.parse(readFileSync(new URL('../catalog/source-contracts.v1.json',import.meta.url),'utf8'));
  const map=new Map<string,string>(); const store={getItem:(key:string)=>map.get(key)??null,setItem:(key:string,value:string)=>{map.set(key,value);}};
  let reads=0;
  const read=async(path:string)=>path.endsWith('/meta')?{revision:directory.revision}:(reads++,directory);
  await cachedSourceContracts(read,store); await cachedSourceContracts(read,store); assert.equal(reads,1);
  map.set('signalstudio:source-directory:v1','broken'); await cachedSourceContracts(read,store); assert.equal(reads,2);
  const entry=JSON.parse(map.get('signalstudio:source-directory:v1')!); entry.body=entry.body.replace('SignalStudio','Corrupted'); map.set('signalstudio:source-directory:v1',JSON.stringify(entry));
  await cachedSourceContracts(read,store); assert.equal(reads,3);
  await assert.rejects(cachedSourceContracts(async(path)=>path.endsWith('/meta')?{revision:'sha256:'+'0'.repeat(64)}:directory,store),/changed/);
});

test('validated deltas reuse unchanged entities across reordering without mutating a baseline', () => {
  const raw=serverGraph();
  const base=decodeGraph({...raw,revision:'a',transport:'canvas.v1'});
  const before=JSON.stringify(base);
  const updated={...base.nodes[0]!,name:'new title'};
  const delta={transport:'delta.v1',base_revision:'a',revision:'b',changes:Object.fromEntries(collections.map(key=>[key,{upsert:key==='nodes'?[updated]:[],delete:[]}])) ,order:{nodes:base.nodes.map(n=>n.id).reverse()}};
  const next=decodeGraph(delta,base);
  assert.equal(JSON.stringify(base),before);
  const changed=next.nodes.find(n=>n.id===updated.id)!;
  assert.notEqual(changed,base.nodes[0]);assert.equal(changed.name,'new title');
  assert.equal(changed.card_contract,base.nodes[0]!.card_contract);
  assert.equal(next.nodes.find(n=>n.id===base.nodes[1]!.id),base.nodes[1]);
  assert.equal(next.fields,base.fields);assert.equal(next.edges,base.edges);
  assert.deepEqual(next.nodes.map(n=>n.id),delta.order.nodes);
  const bad={...delta,changes:{...delta.changes,edges:{upsert:[{...base.edges[0]!,upstream_id:'missing'}],delete:[]}}};
  assert.throws(()=>decodeGraph(bad,base),/reference/);
  assert.equal(JSON.stringify(base),before);
});

test('detail hydration replaces only changed entities and keeps unrelated collections stable', () => {
  const raw=serverGraph();const node=raw.nodes[0]!;
  const base=decodeGraph({...raw,revision:'a',transport:'canvas.v1',nodes:raw.nodes.map(n=>({...n,detail_revision:n.id,detail_loaded:false}))});
  const loaded=mergeDetails(base,{revision:'a',workspace:{project_root:'/test',database_path:'/test/db'},nodes:[{...node,notes:'loaded',detail_revision:node.id,detail_loaded:true}],fields:[],field_usages:[],requirements:[]});
  assert.notEqual(loaded.nodes[0],base.nodes[0]);assert.equal(loaded.nodes[1],base.nodes[1]);
  assert.equal(loaded.edges,base.edges);assert.equal(loaded.fields,base.fields);
  assert.equal(base.nodes[0]!.detail_loaded,false);
});
