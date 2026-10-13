import test from 'node:test';
import assert from 'node:assert/strict';
import {cardTypeGroups,cardTypeKey,matchesCardType} from './cardTypeFilters';

const module=(id:string,name:string,kind:string,path:string)=>({id,name,kind,type:'Metric',card_contract:{config:{definition_refs:[{path}]}}});
test('sidebar subtypes partition source providers and separate CoinGecko processing from shared processing',()=>{
 const nodes=[{id:'cg',name:'coingecko.coins_markets',kind:'source',type:'Source'}, {id:'k',name:'kaito.resource.tokens',kind:'source',type:'Source'},
 module('metric','Polars · 计算 CoinGecko 量价指标','process','catalog/polars-indicator-current.v1.json'),
 module('score','计算当前资产评分','process','catalog/score-rollup.v1.json'),
 module('base','assets','table','catalog/business-tables.v1.json'),module('board','leaderboard_new_uuid','table','catalog/new-uuid-board.v1.json')];
 const before=JSON.stringify(nodes),groups=cardTypeGroups(nodes,'zh-CN');
 assert.equal(groups.reduce((n,g)=>n+g.count,0),nodes.length);
 for(const group of groups)assert.equal(group.children.reduce((n,c)=>n+c.count,0),group.count);
 assert.deepEqual(nodes.filter(n=>matchesCardType(n,'source/coingecko')).map(n=>n.id),['cg']);
 assert.deepEqual(nodes.filter(n=>matchesCardType(n,'process/public-score')).map(n=>n.id),['score']);
 assert.deepEqual(nodes.filter(n=>matchesCardType(n,'process/cg-metrics')).map(n=>n.id),['metric']);
 assert.deepEqual(nodes.filter(n=>matchesCardType(n,'table/board')).map(n=>n.id),['board']);
 assert.equal(nodes.filter(n=>matchesCardType(n,'table')).length,2);
 assert.equal(nodes.filter(n=>matchesCardType(n,'All types')).length,6);
 assert.equal(cardTypeGroups([nodes[0]!,nodes[0]!],'en')[0]!.count,1);
 assert.equal(JSON.stringify(nodes),before);
});
test('renamed, detached or future modules remain visible as unclassified instead of inheriting a historical number',()=>{
 const original=module('known','assets','table','catalog/business-tables.v1.json');
 const renamed={...original,id:'renamed',name:'my draft',reference_number:1001};
 const detached={...original,id:'detached',card_contract:null};
 const future={...original,id:'future',kind:'future'};
 assert.equal(cardTypeKey(renamed),'table/unknown');assert.equal(cardTypeKey(detached),'table/unknown');
 const groups=cardTypeGroups([renamed,detached,future],'en');
 assert.equal(groups.find(g=>g.id==='table')!.children[0]!.label,'Unclassified');
 assert.equal(groups.find(g=>g.id==='unknown')!.count,1);assert.ok(matchesCardType(future,'unknown'));
});
