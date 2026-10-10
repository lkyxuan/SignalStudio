import test from 'node:test';
import assert from 'node:assert/strict';
import { detailKind, cardRelations, decisionBranches, decisionActor, resourceSettings, isCatalogSource, cardExplanation } from './cardDetailModel';

test('explicit kinds control details; unknown imported kinds stay read-only candidates', () => {
  assert.equal(detailKind({kind:'process',type:'Asset Resolution'}),'process');
  assert.equal(detailKind({kind:'future',type:'Score'}),'unknown');
  assert.equal(detailKind({kind:'table',type:'Redis Window'}),'table');
  assert.ok(isCatalogSource('kaito.mcp.kaito_smart_following_market'));
  assert.ok(isCatalogSource('kaito.resource.tokens'));
  assert.equal(isCatalogSource('kaito.mcp.invented'),false);
});
test('shared visual edge resolves each stable branch; invalid ports cannot invent routes', () => {
  const node={id:'a',name:'custom',kind:'decision',type:'Rule Evaluation',card_contract:{config:{branches:[{id:'first'},{id:'due'},{id:'skip',terminal:true},{id:'missing'}]}}};
  const graph={nodes:[node,{id:'b',name:'worker'}],edges:[{id:'e',upstream_id:'a',downstream_id:'b'}],ports:[{id:'out',node_id:'a'},{id:'in',node_id:'b'}],bindings:[{edge_id:'e',source_port_id:'out',target_port_id:'in',branch:'first',kind:'control'},{edge_id:'e',source_port_id:'out',target_port_id:'in',branch:'due',kind:'control'},{edge_id:'e',source_port_id:'in',target_port_id:'out',branch:'missing',kind:'control'}]};
  const before=JSON.stringify(graph);
  const branches=decisionBranches(node,graph,'zh-CN');
  assert.deepEqual(branches.map((b:{targets:{id:string}[]})=>b.targets.map(t=>t.id)),[['b'],['b'],[],[]]);
  assert.equal(branches[2].terminal,true);
  assert.equal(cardRelations(node,graph)[0].bindings.length,2);
  assert.equal(JSON.stringify(graph),before);
  assert.equal(decisionActor({...node,name:'刷新判断',card_contract:{config:{definition_refs:[{path:'unrelated.json'}]}}}),'unknown');
});
test('fallback copy requires module identity; broken legacy resource notes stay unknown', () => {
  assert.equal(cardExplanation({name:'提交评分事件',formula:'',card_contract:{config:{definition_refs:[]}}},'zh-CN'),'');
  assert.deepEqual(resourceSettings({notes:'not json'}),{});
  assert.deepEqual(resourceSettings({notes:'[]'}),{});
  assert.deepEqual(resourceSettings({notes:'{"old":1}',card_contract:{config:{resource:{topic:'explicit'}}}}),{topic:'explicit'});
});
