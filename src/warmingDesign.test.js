import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { warmingExample, warmingCases, hourlyWarmingBaseline, warmingMetrics, rankWarming, warmingSnapshotIsCurrent, isNewAsset, warmingBaselineLabel } from './warmingDesign.js';

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
  for(const key of ['warmup','missing_1h','zero_history']){const b=warmingExample(key).batch;assert.equal(b.status,'insufficient_history');assert.equal(b.rows.length,0);assert.equal(b.warming_warmup,true);}
  assert.equal(warmingExample('empty').batch.status,'success');assert.equal(warmingExample('empty').batch.warming_warmup,false);
  assert.equal(warmingExample('partial').batch.status,'unavailable');assert.equal(warmingExample('stale').batch.status,'unavailable');
});

test('hourly baseline uses all available healthy samples, excludes H1, recomputes after late data',()=>{
  const c=warmingExample(),r=c.focus,at=Date.parse(r.requested_at),target=Math.floor((at-75*60000)/3600000)*3600000;
  const sample=(delta,volume,id,extra={})=>({...r,observation_id:id,requested_at:new Date(target+delta).toISOString(),observed_at:new Date(target+delta).toISOString(),collected_at:new Date(target+delta+1000).toISOString(),total_volume:volume,...extra});
  const first=sample(-60000,100,'first');
  const single=hourlyWarmingBaseline(r,[first]);assert.equal(single.baseline_hours,1);assert.equal(single.warming_baseline_mean_7d,100);
  const second=sample(-3600000-60000,300,'second');
  const history=[first,second,sample(-120000,900,'older'),sample(-1800001,999,'outside-tolerance'),sample(3600000-60000,999,'recent')];
  const baseline=hourlyWarmingBaseline(r,history);assert.equal(baseline.baseline_hours,2);assert.equal(baseline.warming_baseline_mean_7d,200);
  assert.equal(hourlyWarmingBaseline(r,[sample(-60000,0,'zero')]).warming_baseline_status,'zero_or_nonfinite_baseline');
  assert.equal(hourlyWarmingBaseline(r,[sample(-60000,-1,'negative'),sample(-60000,Infinity,'infinite'),sample(-60000,100,'bad',{quality_status:'error'}),sample(-60000,100,'scope',{coverage_key:'other'})]).baseline_hours,0);
  assert.equal(hourlyWarmingBaseline(r,[first,{...first,total_volume:101}]).warming_baseline_status,'conflicting_history');
  const late={...first,collected_at:new Date(at+60000).toISOString()};
  assert.equal(hourlyWarmingBaseline(r,[late]).baseline_hours,0);
  assert.equal(hourlyWarmingBaseline({...r,requested_at:new Date(at+120000).toISOString()},[late]).baseline_hours,1);
  assert.equal(single.baseline_hours,1,'previous published inputs stay unchanged');
  const short=warmingExample('missing_day');assert.equal(short.batch.status,'success');assert.equal(short.baseline.baseline_hours,1);
  const lower=at-7*86400000;
  const edge=sample(0,100,'lower',{requested_at:new Date(lower-60000).toISOString(),observed_at:new Date(lower-60000).toISOString(),collected_at:new Date(lower-59000).toISOString()});
  assert.equal(hourlyWarmingBaseline(r,[edge]).baseline_hours,0,'hourly targets before the seven-day lower bound are excluded');
});

test('hour boundaries include the seven-day endpoint, latest in tolerance, and 167 samples form a week',()=>{
 const focus={...warmingExample().focus,requested_at:'2026-10-14T12:00:00.000Z'},at=Date.parse(focus.requested_at),history=[];
 for(let hour=2;hour<=168;hour++){
  const target=at-hour*3600000;
  history.push({...focus,observation_id:`full-${hour}`,requested_at:new Date(target-1800000).toISOString(),observed_at:new Date(target-1800000).toISOString(),collected_at:new Date(target-1799000).toISOString(),total_volume:hour});
 }
 const b=hourlyWarmingBaseline(focus,history);assert.equal(b.baseline_hours,167);assert.equal(b.warming_baseline_mean_7d,85);assert.equal(b.warming_baseline_refs_json.at(-1).target_at,'2026-10-07T12:00:00.000Z');
 const tooOld=history.map(r=>({...r,requested_at:new Date(Date.parse(r.requested_at)-1).toISOString()}));assert.equal(hourlyWarmingBaseline(focus,tooOld).baseline_hours,0);
 const near={...history[0],observation_id:'latest',requested_at:'2026-10-14T10:00:00.000Z',observed_at:'2026-10-14T10:00:00.000Z',collected_at:'2026-10-14T10:00:01.000Z',total_volume:100};
 assert.equal(hourlyWarmingBaseline(focus,[history[0],near]).warming_baseline_mean_7d,100);
 const notYet={...focus,requested_at:'2026-10-14T11:14:59.999Z'};assert.equal(hourlyWarmingBaseline(notYet,[near]).baseline_hours,0);
 const exactly={...focus,requested_at:'2026-10-14T11:15:00.000Z'};assert.equal(hourlyWarmingBaseline(exactly,[near]).baseline_hours,1);
});

test('new asset is based on registration age only; baseline labels support partial and full weeks',()=>{
 const r=warmingExample().focus,at=Date.parse(r.requested_at);
 for(const [age,expected] of [[0,true],[7*86400000-1,true],[7*86400000,false],[-1,false]])assert.equal(isNewAsset({...r,asset_created_at:new Date(at-age).toISOString()}),expected);
 assert.equal(isNewAsset({...r,asset_created_at:null}),false);
 const c=warmingExample(),normal=rankWarming(c.current.map(r=>({...r,asset_created_at:null})),c.history,c.calculatedAt);
 assert.deepEqual(normal.rows.map(r=>[r.asset_id,r.score]),c.batch.rows.map(r=>[r.asset_id,r.score]));
 assert.ok(c.batch.rows.some(r=>r.is_new&&r.is_new_asset));
 assert.equal(warmingBaselineLabel(1),'基准 1 小时');assert.equal(warmingBaselineLabel(48),'基准 2 天');assert.equal(warmingBaselineLabel(167),'基准 7 天');
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
from warming_reference import board,hourly_baseline,metrics,snapshot_is_current
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
 compare(hourly_baseline(c['focus'],c['history']),c['baseline'],c['key']+'/baseline')
 compare(metrics(c['focus'],c['history']),c['metrics'],c['key']+'/metrics')
 assert not snapshot_is_current(result,'2026-10-15T00:20:00Z')
print('Python/JS complete cases agree')`;
  const r=spawnSync('python3',['-c',script],{input:JSON.stringify(cases),encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

test('ties use stable IDs, top-50 follows the full cohort, no size gate or acceleration weight',()=>{
  const c=warmingExample(),history=[],current=[];
  for(let i=0;i<60;i++){
    const asset_id=`coin-${String(i).padStart(2,'0')}`,source_object_id=`long-tail-${i}`;
    current.push({...c.focus,asset_id,source_object_id,observation_id:`current-${i}`,market_cap:10,current_price:.0001});
    history.push(...c.history.filter(r=>r.source_object_id===c.focus.source_object_id).map(r=>({...r,asset_id,source_object_id,observation_id:`${r.observation_id}-${i}`})));
  }
  const b=rankWarming(current.reverse(),history,c.calculatedAt);
  assert.equal(b.sample_count,60);assert.equal(b.rows.length,50);
  assert.deepEqual(b.rows.map(r=>r.asset_id),Array.from({length:50},(_,i)=>`coin-${String(i).padStart(2,'0')}`));
});
