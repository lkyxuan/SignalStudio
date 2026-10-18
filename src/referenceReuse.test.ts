import test from 'node:test';
import assert from 'node:assert/strict';
import { reuseCanvasNodes, reuseEntities } from './referenceReuse';

test('canvas reconciliation keeps measurements and selection, updates geometry and removes deleted cards', () => {
  const previous=[{id:'a',position:{x:0,y:0},data:{title:'A'},measured:{width:200,height:80},selected:true},
    {id:'b',position:{x:20,y:20},data:{title:'B'},measured:{width:200,height:80},selected:false}];
  const unchanged=previous.map(({measured,selected,...n})=>structuredClone(n));
  assert.equal(reuseCanvasNodes(unchanged,previous),previous);
  const next=reuseCanvasNodes([{...unchanged[0]!,position:{x:80,y:0}},unchanged[1]!],previous);
  assert.notEqual(next[0],previous[0]);assert.equal(next[1],previous[1]);
  assert.deepEqual(next[0]!.position,{x:80,y:0});
  assert.equal((next[0] as typeof previous[0]).measured,previous[0]!.measured);
  assert.deepEqual(previous[0]!.position,{x:0,y:0});
  assert.equal(reuseCanvasNodes([unchanged[1]!],previous)[0],previous[1]);
});

test('edge reconciliation updates changed meaning/ports but retains unrelated arcs and stable click handler', () => {
  const click=()=>{};
  const previous=[{id:'a',data:{meaning:'read',sourcePort:{percent:50},onSelect:click}},{id:'b',data:{meaning:'write',sourcePort:{percent:50},onSelect:click}}];
  const next=reuseEntities([{id:'a',data:{meaning:'return',sourcePort:{percent:60},onSelect:click}},{id:'b',data:{meaning:'write',sourcePort:{percent:50},onSelect:click}}],previous);
  assert.notEqual(next[0],previous[0]);assert.equal(next[1],previous[1]);
  assert.equal(previous[0]!.data.meaning,'read');
});
