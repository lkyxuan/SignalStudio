import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import {renderToStaticMarkup} from 'react-dom/server';
import {ApplicationInterfaceCard} from './ApplicationInterfaceCard';
import definitions from '../catalog/application-interfaces.v1.json';
import {cardKind,kindLabel} from './cardModel';
import {detailKind} from './cardDetailModel';
import {displayNodeName} from './i18n';
import {edgePresentation} from './edgePresentation';
const graph:any={nodes:[],edges:[],bindings:[],ports:[],fields:[]};
function node(index:number){const spec=definitions.cards[index]!;return {id:`ui${index}`,name:spec.name,type:'Application Interface',kind:'interface',definition:spec.purpose_zh,card_contract:{config:{definition_refs:[{path:'catalog/supabase-score-sync.v1.json'}],interface:spec}}};}
test('interface kind and bilingual purpose are recognized independently of historical numbering',()=>{
 const n=node(0);
 assert.equal(cardKind(n),'interface'); assert.equal(detailKind(n),'interface');
 assert.equal(kindLabel('interface','zh-CN'),'应用界面');
 assert.equal(displayNodeName('en',n.name),'Asset scores page');
 assert.equal(cardKind({type:'Application Interface'}),'interface');
});
test('score UI renders existing read contract, gaps and read-only actions without a live approval control',()=>{
 const html=renderToStaticMarkup(<ApplicationInterfaceCard node={node(0)} graph={graph} language="zh-CN"/>);
 for(const text of ['180','100','calculated_at','score_value DESC','稳定分数','实际页面地址：待绑定','只读']) assert.ok(html.includes(text),text);
 assert.ok(!html.includes('<button')); assert.ok(!html.includes('<form'));
 const en=renderToStaticMarkup(<ApplicationInterfaceCard node={node(0)} graph={graph} language="en"/>);
 assert.ok(en.includes('Read fresh total_heat')); assert.ok(en.includes('API: unbound'));
});
test('review UI explains explicit human decisions and guarded execution without inventing storage/API',()=>{
 const html=renderToStaticMarkup(<ApplicationInterfaceCard node={node(1)} graph={graph} language="zh-CN"/>);
 for(const text of ['批准、暂缓或驳回','不作决定','记录','重审','API','不表示直连数据、自动触发']) assert.ok(html.includes(text),text);
 assert.ok(!html.includes('<button')); assert.ok(!html.includes('<form'));
});
test('generic interface remains editable as a draft with missing definition rather than fabricated records',()=>{
 const n={...node(0),card_contract:{config:{}}};
 const html=renderToStaticMarkup(<ApplicationInterfaceCard node={n} graph={graph} language="zh-CN"/>);
 assert.ok(html.includes('展示字段尚未定义')); assert.ok(html.includes('实际 API：待绑定'));
});
test('review surface reference describes association without an execution trigger',()=>{
 const ui=node(1),decision={...node(0),id:'decision',kind:'decision'},edge:any={id:'e',upstream_id:ui.id,downstream_id:decision.id,reference_number:102};
 const g:any={...graph,nodes:[ui,decision],edges:[edge],bindings:[{edge_id:'e',kind:'reference',branch:'',config:{role:'human_review_surface',trigger:'none'}}]};
 const result=edgePresentation(g,edge,'zh-CN');
 assert.ok(JSON.stringify(result).includes('人工审核界面 · 不自动触发'));
});

test('homepage preview has four side boards and two center signals without invented content',async()=>{
 const {default:homepage}=await import('../catalog/homepage-layout.v1.json');
 const n={...node(0),name:homepage.interface.name,card_contract:{config:{interface:homepage.interface}}};
 for(const language of ['zh-CN','en']){
  const html=renderToStaticMarkup(<ApplicationInterfaceCard node={n} graph={graph} language={language}/>);
  assert.equal((html.match(/data-homepage-slot=/g)||[]).length,6);
  assert.ok(html.includes('leaderboard_warming'));assert.ok(html.includes('leaderboard_hottest'));
  assert.ok(html.includes('signal.data'));assert.ok(!html.includes('<button'));assert.ok(!html.includes('<form'));
  assert.ok(!html.includes('leaderboard_emerging'));
 }
 assert.equal(displayNodeName('en',n.name),'Boards and signals home');
 assert.equal(homepage.slots[3]!.source_name,'leaderboard_new_uuid');
 assert.deepEqual(homepage.slots.map(s=>s.kind),['board','signal','board','board','signal','board']);
});
