// Read-only verification against the visible graph, including every declared output field.
import {createServer} from 'vite';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const graph=JSON.parse(readFileSync(process.argv[2],'utf8'));
const vite=await createServer({server:{middlewareMode:true},appType:'custom'});
try {
 const {buildCoinGeckoCase,designCases,previewRefs,previewColumns,previewInputs,nullReason}=await vite.ssrLoadModule('/src/coingeckoPreviewModel.js');
 const {CoinGeckoDesignPreview}=await vite.ssrLoadModule('/src/CoinGeckoDesignPreview.jsx');
 let records=0,fields=0;
 for(const ref of previewRefs){
  const node=graph.nodes.find(n=>n.reference_number===ref);assert.ok(node,`Missing #${ref}`);
  for(const sample of designCases){
   const c=buildCoinGeckoCase(sample.key);
   const columns=ref===3005?previewColumns(graph.nodes.find(n=>n.reference_number===1006),graph):previewColumns(node,graph);
   for(const row of c.rows[ref])for(const name of columns){
    assert.notEqual(row[name],undefined,`#${ref}/${sample.key} missing ${name}`);fields++;
    if(row[name]===null)assert.ok(nullReason(name,'zh-CN'),`#${ref}/${sample.key} unexplained null ${name}`);
   }
   for(const input of previewInputs(ref,c))for(const row of input.rows)for(const name of input.fields)assert.notEqual(row[name],undefined,`#${ref}/${sample.key} input ${name}`);
   for(const row of c.rows[ref])for(const value of Object.values(row))if(typeof value==='number')assert.ok(Number.isFinite(value),`#${ref} nonfinite number`);
   records+=c.rows[ref].length;
  }
  for(const language of ['zh-CN','en']){
   const html=renderToStaticMarkup(createElement(CoinGeckoDesignPreview,{node,graph,language,openNode:()=>{throw Error('Render must not navigate')}}));
   assert.ok(!html.includes('Design gap')&&!html.includes('设计缺口'),`#${ref} incomplete rendering`);
  }
 }
 const up=buildCoinGeckoCase('up');
 assert.equal(up.metrics.volume_to_market_cap,.5);assert.equal(up.metrics.volume_ratio,2);assert.equal(up.metrics.abs_price_pct,12);
 assert.deepEqual(up.decisions.map(d=>d.score_delta),[20,10,10,20]);
 assert.ok(Math.abs(up.score-60*2**(-1/30))<1e-10);
 assert.deepEqual(up.rows[5005].map(s=>s.signal_type),['price_move_up','volume_spike','near_ath']);
 assert.deepEqual(up.rows[5005].map(s=>s.confidence),[.62,.9,.76]);
 assert.equal(up.rows[3001][0].turnover_ratio_24h,.5);assert.equal(buildCoinGeckoCase('quiet').rows[3001].length,0);
 assert.equal(up.rows[3010][0].score_value,up.rows[1006][0].score_value);assert.equal(up.rows[1007][0].calculated_at,up.rows[1006][0].calculated_at);
 const down=buildCoinGeckoCase('down');assert.deepEqual(down.rows[5005].map(s=>s.signal_type),['price_move_down','volume_spike','deep_from_ath']);
 assert.equal(buildCoinGeckoCase('quiet').rows[5005].length,0);
 const fresh=buildCoinGeckoCase('new');assert.equal(fresh.rows[5007][0].asset_id,null);assert.equal(fresh.rows[3043][0].action,'created');
 assert.equal(fresh.rows[1001][0].asset_id,fresh.rows[3043][0].asset_id);assert.equal(fresh.rows[3032].length,0);assert.equal(fresh.rows[3009].length,0);
 assert.deepEqual(fresh.rows[5005].map(s=>s.signal_type),['new_asset_discovered']);
 const next=buildCoinGeckoCase('next');assert.equal(next.shared.asset_id,fresh.creation.asset_id);assert.equal(next.rows[3016].length,0);assert.notEqual(next.metrics.observation_id,fresh.metrics.observation_id);
 const missing=buildCoinGeckoCase('no_baseline');assert.equal(missing.metrics.volume_ratio,null);assert.equal(missing.decisions.length,3);assert.equal(missing.rows[5005].length,3);
 for(const key of ['lookup_error','conflict'])for(const ref of [5007,3042,3043,3016,3032,5005,1001,1002])assert.equal(buildCoinGeckoCase(key).rows[ref].length,0,`${key} must not publish/create/score`);
 for(const c of designCases.map(s=>buildCoinGeckoCase(s.key))){
  for(const e of c.events){assert.ok(c.decisions.some(d=>d.decision_ref===e.decision_ref));assert.ok(e.event_key.startsWith('design:ss83:'));assert.equal(e.created_at,c.events[0].created_at);}
  for(const metric of c.rows[5007])assert.equal(metric.metric_id,metric.observation_id+'/'+metric.metric_version);
  if(c.baseline){const target=Date.parse(c.shared.requested_at)-86400000;assert.ok(Date.parse(c.baseline.collected_at)<=target);assert.ok(target-Date.parse(c.baseline.requested_at)<=1800000);}
 }
 const oracle=spawnSync('python3',['-c',`
import json, sys, math
sys.path.insert(0, 'server')
from market_scoring_reference import calculate_indicators, contributions, rollup, alert_conditions
for c in json.load(sys.stdin):
 m=calculate_indicators(c['shared'],[c['baseline']] if c['baseline'] else [],c['metrics']['calculated_at'])
 if c['sample']['identity'] in ['lookup_error','conflict']:
  assert m is None
  continue
 for key in ['volume_to_market_cap','abs_price_pct','volume_ratio','baseline_observation_id','baseline_volume','metric_id']:
  assert m[key]==c['metrics'][key],(c['sample']['key'],key)
 decisions=contributions(m,m['calculated_at'])
 assert [d['score_delta'] for d in decisions]==[d['score_delta'] for d in c['decisions']]
 actual=rollup(c['events'],c['rows']['1006'][0]['calculated_at']) if c['events'] else {}
 if actual: assert math.isclose(actual[c['shared']['asset_id']]['activity_score'],c['score'])
 expected=set(alert_conditions(m,m['calculated_at']))
 shown={r['signal_type'] for r in c['rows']['5005'] if r['signal_type']!='new_asset_discovered'}
 assert expected==shown,(expected,shown)
print('Python reference: indicators, alerts, contribution tiers and decay agree for all cases')
`],{input:JSON.stringify(designCases.map(s=>buildCoinGeckoCase(s.key))),encoding:'utf8'});
 assert.equal(oracle.status,0,oracle.stderr);console.log(oracle.stdout.trim());
 console.log(JSON.stringify({cards:previewRefs.length,cases:designCases.length,records,output_fields_checked:fields,languages:2,math_identity_branches:true}));
} finally {await vite.close()}
