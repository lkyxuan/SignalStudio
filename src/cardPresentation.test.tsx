import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { cardPresentation } from './cardPresentation';
import { CardPresentationDetails } from './CardPresentationDetails';
import { serverGraph } from './testFixtures';

const table=(name:string)=>({name,type:'Ranking Table',kind:'table',card_contract:{config:{definition_refs:[{path:'catalog/business-tables.v1.json'}]}}});
test('purpose and origin stay separate; shared internal records do not inherit a provider',()=>{
  const asset=cardPresentation(table('assets'),'zh-CN');
  assert.equal(asset.label,'数据表 · 基础资料'); assert.equal(asset.origin,'internal_data');
  const history={...table('coingecko_market_history'),card_contract:{config:{definition_refs:[{path:'catalog/market-current.v1.json'}]}}};
  assert.equal(cardPresentation(history,'zh-CN').origin,'coingecko');
  assert.equal(cardPresentation(history,'en').label,'Table · History');
  assert.equal(cardPresentation({...history,name:'Renamed draft',reference_number:1013},'zh-CN').origin,'pending');
  assert.equal(cardPresentation({...history,card_contract:null},'zh-CN').subtype,'pending');
  assert.equal(cardPresentation({...history,kind:'process'},'zh-CN').subtype,'pending');
});
test('source providers and operation / resource purposes come from the declared catalog',()=>{
  for(const [name,origin,subtype] of [['coingecko.coins_markets','coingecko','api'],['coingecko.search_trending','coingecko','api'],['kaito.resource.tokens','kaito','resource'],['telegram.bot.message','telegram','feed']]){
    const result=cardPresentation({name:name!,type:'Source',kind:'source'},'en');
    assert.equal(result.origin,origin); assert.equal(result.subtype,subtype);
  }
  const check=cardPresentation({name:'定期 AI 检查资产地图',type:'Evidence Check',kind:'process',card_contract:{config:{definition_refs:[{path:'catalog/identity-flow-case.v1.json'}]}}},'zh-CN');
  assert.equal(check.label,'处理 · AI 核查');
});
test('field references require the saved edge and correct field owners; rendering remains read only',()=>{
  const graph=serverGraph();
  const source={...graph.nodes[0]!,id:'up',name:'assets',kind:'table'};
  const node={...graph.nodes[0]!,id:'focus',name:'consumer',kind:'process'};
  const edge={...graph.edges[0]!,id:'link',upstream_id:'up',downstream_id:'focus'};
  Object.assign(graph,{nodes:[source,node],edges:[edge],ports:[{id:'out',node_id:'up'},{id:'in',node_id:'focus'}],bindings:[{edge_id:'link',source_port_id:'out',target_port_id:'in',kind:'read'}],fields:[{id:'asset',node_id:'up',name:'asset_id'},{id:'foreign',node_id:'outside',name:'wrong_owner'},{id:'target',node_id:'focus',name:'target'}],field_usages:[{edge_id:'link',source_field_id:'asset',target_field_id:'target'},{edge_id:'link',source_field_id:'foreign',target_field_id:'target'}]});
  const before=JSON.stringify(graph);
  const html=renderToStaticMarkup(<CardPresentationDetails node={node} graph={graph} language="zh-CN" openNode={()=>{throw Error('Must not navigate during render');}}/>);
  assert.ok(html.includes('asset_id')); assert.ok(!html.includes('wrong_owner'));
  assert.ok(html.includes('上游与引用字段')); assert.equal(JSON.stringify(graph),before);
});
