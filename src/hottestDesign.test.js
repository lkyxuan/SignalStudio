import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { hottestExample, hottestCases, normalize, rankHottest, baseline7d } from './hottestDesign.js';

test('robust normalization retains distance, clips extremes and handles MAD zero',()=>{
  const n=normalize([0,1,2,3,1000000]);assert.equal(n.z_clipped[4],3);assert.ok(n.z_raw[4]>3);
  assert.deepEqual(normalize([2,2,2]).z_clipped,[0,0,0]);assert.equal(normalize([2,2,2]).status,'normalization_degenerate');
});
test('seven days are complete, as-of, scoped and nonduplicated',()=>{
  const c=hottestExample();assert.ok(Math.abs(c.focus.rvol_7d-3)<1e-12);assert.equal(c.focus.baseline_days_7d,7);
  const history=c.histories[0].map(r=>({...r}));history[0].collected_at=c.focus.requested_at;
  assert.equal(baseline7d(c.focus,history).rvol_7d,null);
  assert.equal(baseline7d(c.focus,c.histories[0].slice(0,6)).baseline_days_7d,6);
  assert.equal(hottestExample('baseline_zero').focus.rvol_7d_status,'zero_baseline');
});
test('batch failures, zeros, partial history, ties and exact ranking behavior',()=>{
  const c=hottestExample();assert.equal(c.batch.status,'success');assert.equal(c.batch.rows.length,6);
  for(const r of c.batch.rows){assert.ok(r.score>=-3&&r.score<=3);assert.ok(Math.abs(r.score-Object.values(r.score_components_json).reduce((s,x)=>s+x.contribution,0))<1e-12);}
  assert.equal(hottestExample('missing').batch.sample_count,6);assert.equal(hottestExample('zero').batch.sample_count,6);
  assert.equal(hottestExample('partial').batch.status,'unavailable');assert.equal(hottestExample('degenerate').batch.reason,'incomparable_batch');
  assert.equal(hottestExample('stale').batch.sample_count,5);assert.equal(hottestExample('empty').batch.status,'success');
  const input=[...c.current,{...c.current[0],observation_id:'later',metric_id:'later/market_indicators_v2',requested_at:'2026-10-13T00:04:30Z',collected_at:'2026-10-13T00:04:31Z',rvol_7d:null,rvol_7d_status:'missing_history'}];
  assert.equal(rankHottest(input,c.calculatedAt).sample_count,6,'latest incomplete observation must not fall back to old complete one');
  assert.deepEqual(rankHottest(c.current,c.calculatedAt),rankHottest([...c.current].reverse(),c.calculatedAt));
});
test('independent Python reference agrees on every synthetic case and contribution',()=>{
  const cases=hottestCases.map(([k])=>hottestExample(k));
  const script=`import json,sys,math
sys.path.insert(0,'server')
from hottest_reference import board,baseline_7d,snapshot_is_current
for c in json.load(sys.stdin):
 result=board(c['current'],c['calculatedAt'],'partial' if c['key']=='partial' else 'healthy')
 expected=c['batch']
 assert result['status']==expected['status'],c['key']
 assert result.get('reason')==expected.get('reason'),c['key']
 assert result['sample_count']==expected['sample_count'],c['key']
 assert result['rvol_warmup']==expected['rvol_warmup'],c['key']
 assert result['normalization_json'].keys()==expected['normalization_json'].keys()
 assert [r['asset_id'] for r in result['rows']]==[r['asset_id'] for r in expected['rows']],c['key']
 for a,b in zip(result['rows'],expected['rows']):
  assert math.isclose(a['score'],b['score'],abs_tol=1e-12),(c['key'],a['score'],b['score'])
  for key in a['score_components_json']:
   for field in ['value','log1p','z_raw','z_clipped','contribution']:
    av,bv=a['score_components_json'][key][field],b['score_components_json'][key][field]
    assert (av is None and bv is None) or math.isclose(av,bv,abs_tol=1e-12)
   assert a['score_components_json'][key]['status']==b['score_components_json'][key]['status']
 baseline=baseline_7d(c['focus'],c['histories'][0])
 assert baseline['rvol_7d_status']==c['baseline']['rvol_7d_status']
 assert (baseline['rvol_7d'] is None and c['baseline']['rvol_7d'] is None) or math.isclose(baseline['rvol_7d'],c['baseline']['rvol_7d'],abs_tol=1e-12)
 assert not snapshot_is_current(result,'2026-10-13T00:20:00Z')
print('Python/JS math, baselines, cohort ranking and expiry agree')`;
  const r=spawnSync('python3',['-c',script],{input:JSON.stringify(cases),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

test('missing RVOL stays neutral without distorting statistics or other factors',()=>{
  const normal=hottestExample(),mixed=hottestExample('missing'),warm=hottestExample('warmup');
  for(const c of [mixed,warm,hottestExample('baseline_zero'),hottestExample('one_valid')]){
    assert.equal(c.batch.status,'success');assert.equal(c.batch.sample_count,6);assert.equal(c.batch.excluded_count,0);
    for(const r of c.batch.rows){
      const original=normal.batch.rows.find(x=>x.asset_id===r.asset_id);
      for(const k of ['volume_to_market_cap','total_volume','abs_price_pct'])assert.deepEqual(r.score_components_json[k],original.score_components_json[k]);
      if(r.rvol_7d===null){const v=r.score_components_json.rvol_7d;assert.deepEqual([v.value,v.log1p,v.z_raw,v.z_clipped,v.contribution,v.weight,v.status],[null,null,0,0,0,.35,'unavailable_neutral']);}
    }
  }
  const valid=mixed.current.filter(r=>r.rvol_7d!==null).map(r=>r.rvol_7d),n=normalize(valid);
  assert.equal(mixed.batch.normalization_json.rvol_7d.median,n.median);
  assert.equal(mixed.batch.normalization_json.rvol_7d.mad,n.mad);
  assert.equal(mixed.batch.rvol_warmup,false);assert.equal(warm.batch.rvol_warmup,true);
  assert.equal(warm.batch.normalization_json.rvol_7d.median,null);
  assert.ok(warm.batch.rows.every(r=>r.rvol_warmup));
  assert.equal(hottestExample('empty').batch.rvol_warmup,false);
  assert.equal(rankHottest(normal.current,normal.calculatedAt).rvol_warmup,false,'history recovery restores four metrics');
  const invalid=normal.current.map(r=>({...r,rvol_7d:999,rvol_7d_status:'zero_baseline'}));
  assert.equal(rankHottest(invalid,normal.calculatedAt).rvol_warmup,true,'noncomplete status cannot use stale numeric RVOL');
  assert.equal(rankHottest(warm.current.slice(0,1),warm.calculatedAt).reason,'incomparable_batch');
  const many=Array.from({length:21},(_,i)=>({...warm.current[i%6],asset_id:`coin-${i}`,source_object_id:`coin-${i}`,observation_id:`obs-${i}`,metric_id:`metric-${i}`}));
  many[20]={...many[20],rvol_7d:3,rvol_7d_status:'complete',baseline_days_7d:7,baseline_mean_volume_7d:10};
  assert.equal(rankHottest(many,warm.calculatedAt).rvol_warmup,false,'warmup uses cohort before top-20');
});
