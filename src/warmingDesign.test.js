import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { warmingExample, warmingCases, dailyWarmingBaseline, warmingMetrics, rankWarming, warmingSnapshotIsCurrent } from './warmingDesign.js';

test('rank growth, allow hottest overlap, explain acceleration without changing rank',()=>{
  const c=warmingExample();
  assert.equal(c.batch.status,'success');
  assert.deepEqual(c.batch.rows.map(r=>r.asset_id),[c.current[2].asset_id,c.current[1].asset_id,c.current[0].asset_id]);
  assert.ok(c.batch.rows.some(r=>c.hottestAssetIds.includes(r.asset_id)));
  assert.deepEqual(c.batch.rows.map(r=>r.growth_change_status),['slowing','steady','accelerating']);
  assert.ok(c.batch.rows.every(r=>r.score===r.growth_1h));
  const noTwo=warmingExample('missing_2h');
  assert.deepEqual(noTwo.batch.rows.map(r=>[r.asset_id,r.score]),c.batch.rows.map(r=>[r.asset_id,r.score]));
  assert.ok(noTwo.batch.rows.every(r=>r.growth_change_pp===null&&r.growth_change_status==='unknown'));
  assert.ok(warmingExample('steady').batch.rows.some(r=>r.asset_id===c.current[0].asset_id&&r.growth_change_status==='steady'));
});

test('above normal is not new growth; warmup, empty and bad coverage remain distinct',()=>{
  for(const key of ['plateau','falling']){const b=warmingExample(key).batch;assert.equal(b.status,'success');assert.equal(b.rows.length,0);assert.equal(b.warming_warmup,false);}
  for(const key of ['warmup','missing_day','missing_1h','zero_history']){const b=warmingExample(key).batch;assert.equal(b.status,'insufficient_history');assert.equal(b.rows.length,0);assert.equal(b.warming_warmup,true);}
  assert.equal(warmingExample('empty').batch.status,'success');assert.equal(warmingExample('empty').batch.warming_warmup,false);
  assert.equal(warmingExample('partial').batch.status,'unavailable');assert.equal(warmingExample('stale').batch.status,'unavailable');
});

test('baseline is day-anchored, no lookahead, same-day frozen missing result, independent of hottest RVOL',()=>{
  const c=warmingExample(),base=dailyWarmingBaseline(c.focus,c.history);
  assert.equal(base.warming_baseline_days,7);assert.equal(base.warming_baseline_mean_7d,1e6);
  const later={...c.focus,requested_at:'2026-10-14T23:00:00Z',rvol_7d:999};
  assert.deepEqual(dailyWarmingBaseline(later,c.history),base);
  const empty={...c.focus,...dailyWarmingBaseline(c.focus,[])};
  assert.equal(dailyWarmingBaseline(later,c.history,empty).warming_baseline_status,'missing_history');
  assert.equal(dailyWarmingBaseline({...later,requested_at:'2026-10-15T00:00:00Z'},c.history,empty).warming_baseline_status,'invalid_frozen_baseline');
  const late=c.history.map(r=>r.source_object_id===c.focus.source_object_id&&r.observation_id.endsWith('day-1')?{...r,collected_at:'2026-10-14T00:00:00Z'}:r);
  assert.equal(dailyWarmingBaseline(c.focus,late).warming_baseline_status,'missing_history');
  const scoped=c.history.map(r=>({...r,coverage_key:'other'}));assert.equal(dailyWarmingBaseline(c.focus,scoped).warming_baseline_days,0);
  const zero=c.history.map(r=>({...r,total_volume:0}));assert.equal(dailyWarmingBaseline(c.focus,zero).warming_baseline_status,'zero_or_nonfinite_baseline');
  const broken={...c.focus,...base,warming_baseline_mean_7d:null};assert.equal(dailyWarmingBaseline(c.focus,c.history,broken).warming_baseline_status,'invalid_frozen_baseline');
  const next=warmingExample('rollover'),previous={...next.focus,requested_at:'2026-10-14T23:59:00Z'};
  assert.equal(dailyWarmingBaseline(previous,next.history).warming_baseline_mean_7d,1e6);
  assert.ok(Math.abs(next.baseline.warming_baseline_mean_7d-1028571.4285714285)<1e-8);
});

test('fixed history windows tolerate 3/12-minute sampling but reject late and zero latest samples',()=>{
  for(const key of ['cadence3','cadence12']){const c=warmingExample(key);assert.equal(c.batch.rows.length,3);assert.equal(c.batch.candidates[0].growth_1h,warmingExample().metrics.growth_1h);}
  const c=warmingExample(),one=c.history.find(r=>r.source_object_id===c.focus.source_object_id&&r.observation_id.endsWith(':1h'));
  const target=Date.parse(c.focus.requested_at)-3600000;
  const newest={...one,observation_id:'newest-zero',requested_at:new Date(target-30000).toISOString(),collected_at:new Date(target-29000).toISOString(),observed_at:new Date(target-30000).toISOString(),total_volume:0};
  assert.equal(warmingMetrics(c.focus,[...c.history,newest]).warming_status,'zero_1h_history','do not fall back to older positive history');
  assert.equal(warmingMetrics(c.focus,c.history.map(r=>r===one?{...r,collected_at:c.focus.requested_at}:r)).warming_status,'missing_1h_history');
  const conflict={...one,total_volume:one.total_volume+1};assert.equal(warmingMetrics(c.focus,[...c.history,conflict]).warming_status,'conflicting_1h_history');
});

test('latest invalid current observation cannot fall back, conflicts fail, ordering is deterministic',()=>{
  const c=warmingExample();
  assert.deepEqual(rankWarming([...c.current].reverse(),[...c.history].reverse(),c.calculatedAt),c.batch);
  const invalid={...c.current[0],observation_id:'later',requested_at:'2026-10-14T12:04:30Z',collected_at:'2026-10-14T12:04:31Z',total_volume:null};
  const b=rankWarming([...c.current,invalid],c.history,c.calculatedAt);assert.ok(!b.rows.some(r=>r.asset_id===invalid.asset_id));
  assert.equal(rankWarming([...c.current,{...c.current[0],total_volume:99}],c.history,c.calculatedAt).reason,'conflicting_observation');
  assert.equal(rankWarming([...c.current,{...c.current[0],observation_id:'conflict',asset_id:'other'}],c.history,c.calculatedAt).reason,'conflicting_identity');
  const mixed=c.current.map((r,i)=>i===0?{...r,coverage_key:'other'}:r);assert.equal(rankWarming(mixed,c.history,c.calculatedAt).reason,'mixed_batch_context');
  assert.equal(rankWarming([...c.current,{...c.current[0],requested_at:null}],c.history,c.calculatedAt).reason,'invalid_observation_time');
  assert.equal(warmingSnapshotIsCurrent(c.batch,'2026-10-14T12:19:59Z'),true);
  assert.equal(warmingSnapshotIsCurrent(c.batch,'2026-10-14T12:20:00Z'),false);
  assert.equal(warmingSnapshotIsCurrent(c.batch,'2026-10-14T12:04:59Z'),false);
});

test('independent Python reference agrees on all cases, actual times, baselines and growth',()=>{
  const cases=warmingCases.map(([k])=>warmingExample(k));
  const script=`import sys,json,math
sys.path.insert(0,'server')
from warming_reference import board,daily_baseline,metrics,snapshot_is_current
def compare(a,b,path=''):
 if isinstance(a,dict):
  assert a.keys()==b.keys(),(path,a.keys(),b.keys())
  for k in a: compare(a[k],b[k],path+'/'+k)
 elif isinstance(a,list):
  assert len(a)==len(b),path
  for i,(x,y) in enumerate(zip(a,b)):compare(x,y,path+'/'+str(i))
 elif isinstance(a,(float,int)) and not isinstance(a,bool):assert math.isclose(a,b,abs_tol=1e-10), (path,a,b)
 else:assert a==b,(path,a,b)
for c in json.load(sys.stdin):
 result=board(c['current'],c['history'],c['calculatedAt'],'partial' if c['key']=='partial' else 'healthy')
 compare(result,c['batch'],c['key'])
 compare(daily_baseline(c['focus'],c['history']),c['baseline'],c['key']+'/baseline')
 compare(metrics(c['focus'],c['history']),c['metrics'],c['key']+'/metrics')
 assert not snapshot_is_current(result,'2026-10-15T00:20:00Z')
print('Python/JS complete cases agree')`;
  const r=spawnSync('python3',['-c',script],{input:JSON.stringify(cases),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

test('ties use stable IDs, top-ten follows the full cohort, no size gate or acceleration weight',()=>{
  const c=warmingExample(),history=[],current=[];
  for(let i=0;i<12;i++){
    const asset_id=`coin-${String(i).padStart(2,'0')}`,source_object_id=`long-tail-${i}`;
    current.push({...c.focus,asset_id,source_object_id,observation_id:`current-${i}`,market_cap:10,current_price:.0001});
    history.push(...c.history.filter(r=>r.source_object_id===c.focus.source_object_id).map(r=>({...r,asset_id,source_object_id,observation_id:`${r.observation_id}-${i}`})));
  }
  const b=rankWarming(current.reverse(),history,c.calculatedAt);
  assert.equal(b.sample_count,12);assert.equal(b.rows.length,10);
  assert.deepEqual(b.rows.map(r=>r.asset_id),Array.from({length:10},(_,i)=>`coin-${String(i).padStart(2,'0')}`));
});
