import test from 'node:test';
import assert from 'node:assert/strict';
import { tableDefinition, tableFlow, tableRecordsEndpoint, tableRecordsResult, tableTechnology } from './tableDetailsModel';

test('business schema survives missing graph fields, including constraints and all snapshot columns', () => {
  const assets = tableDefinition({name:'assets'}, {fields:[]});
  assert.equal(assets.columns.length,5);
  assert.deepEqual(assets.primary_key,['asset_id']);
  assert.equal(assets.columns.find((c: {name:string})=>c.name==='asset_id')?.required,true);
  const scores = tableDefinition({name:'asset_scores_current'}, {fields:[]});
  assert.deepEqual(scores.columns.map((c: {name:string})=>c.name),['asset_id','asset_name','score_key','score_value','calculated_at']);
});

test('custom table retains saved field order and values without treating examples as records', () => {
  const fields=[{node_id:'x',name:'later',ordinal:2,data_type:'Text',definition:'Later',example_value:'fake'},
    {node_id:'other',name:'unrelated',ordinal:0},{node_id:'x',name:'first',ordinal:1,data_type:'Decimal',unit:'USD',min_value:0}];
  const original=JSON.stringify(fields);
  const table=tableDefinition({id:'x',name:'custom'}, {fields});
  assert.deepEqual(table.columns.map((c: {name:string})=>c.name),['first','later']);
  assert.equal(table.columns[0].min_value,0);
  assert.equal(table.columns[0].unit,'USD');
  assert.equal(JSON.stringify(fields),original);
  assert.ok(!('example_value' in table.columns[1]));
});

test('only the existing current-score interface is queried', () => {
  assert.equal(tableRecordsEndpoint({name:'asset_scores_current'}),'/table-backfills/1006');
  for(const name of ['assets','coingecko.stocks.history','leaderboard_warming']) assert.equal(tableRecordsEndpoint({name}),null);
});

test('database snapshots retain zero scores, precision and source; replay cannot appear as actual data', () => {
  const rows=[{asset_id:'a',score_value:0},{asset_id:'b',score_value:98.5949783943184}];
  const source={system:'fewunderstand',environment:'testnet',location:'postgres asset_score.current_score',captured_at:'2026-10-07T19:47:46Z'};
  const result=tableRecordsResult({rows,snapshot:{evidence_kind:'database_snapshot',source}});
  assert.equal(result.status,'snapshot');assert.equal(result.rows,rows);assert.equal(result.source,source);
  assert.deepEqual(tableRecordsResult({rows,snapshot:{evidence_kind:'offline_replay'}}),{status:'replay',rows:[]});
  assert.deepEqual(tableRecordsResult({rows:[],snapshot:null}),{status:'empty',rows:[]});
  assert.throws(()=>tableRecordsResult({rows,snapshot:null}));
  assert.throws(()=>tableRecordsResult({rows,snapshot:{evidence_kind:'design'}}));
  assert.throws(()=>tableRecordsResult({rows,snapshot:{evidence_kind:'database_snapshot',source:{}}}));
});

test('read request/result edges deduplicate readers; a card may both read and write; references stay separate', () => {
  const other={id:'reader'},writer={id:'writer'},reference={id:'reference'};
  const flow=tableFlow([
    {other,incoming:false,bindings:[{kind:'read'}]},
    {other,incoming:true,bindings:[{kind:'read'}]},
    {other,incoming:true,bindings:[{kind:'write'}]},
    {other:writer,incoming:true,bindings:[{kind:'write'}]},
    {other:reference,incoming:true,bindings:[{kind:'reference'}]},
    {other:reference,incoming:false,bindings:[]},
  ]);
  assert.deepEqual(flow.readers,[other]);assert.deepEqual(flow.writers,[other,writer]);
  assert.deepEqual(flow.references,[reference]);
});

test('technology does not invent a database choice or claim live access', () => {
  assert.equal(tableTechnology({name:'assets'},true).storage,'待确定');
  const score=tableTechnology({name:'asset_scores_current'},true);
  assert.equal(score.storage,'PostgreSQL');assert.match(score.note,/快照.*尚未接入实时查询/);
  assert.equal(tableTechnology({name:'archive',card_contract:{config:{resource:{technology:'Delta/Parquet'}}}},true).storage,'Delta/Parquet');
});
