import spec from '../catalog/coingecko-warming.v1.json' with { type: 'json' };

const p=spec.parameters, context=['source_id','source_object_id','quote_currency','coverage_key'];
const stamp=v=>typeof v==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(v)?Date.parse(v):NaN;
const iso=t=>new Date(t).toISOString();
const finite=(v,positive=false)=>typeof v==='number'&&Number.isFinite(v)&&(positive?v>0:v>=0);
const same=(a,b)=>context.every(k=>a[k]===b[k]);
const signature=r=>JSON.stringify([...context,'observation_id','asset_id','requested_at','collected_at','observed_at','total_volume'].map(k=>r[k]));

function historical(current,history,target,tolerance,availableAt=target) {
  const scoped=history.filter(r=>same(current,r)&&r.observation_id&&r.quality_status==='healthy'
    &&finite(r.total_volume)&&stamp(r.observed_at)<=target&&stamp(r.observed_at)<=stamp(r.collected_at)
    &&stamp(r.requested_at)<=stamp(r.collected_at)&&stamp(r.collected_at)<=availableAt
    &&stamp(r.requested_at)<=target&&stamp(r.requested_at)>=target-tolerance
    &&stamp(r.observed_at)>=target-tolerance);
  const identities=new Map();
  for(const r of scoped){if(identities.has(r.observation_id)&&identities.get(r.observation_id)!==signature(r))return {status:'conflicting_history',ref:null};identities.set(r.observation_id,signature(r));}
  scoped.sort((a,b)=>stamp(b.requested_at)-stamp(a.requested_at)||a.observation_id.localeCompare(b.observation_id));
  if(!scoped.length)return {status:'missing_history',ref:null};
  const r=scoped[0];
  return {status:'complete',ref:{target_at:iso(target),observation_id:r.observation_id,requested_at:r.requested_at,collected_at:r.collected_at,observed_at:r.observed_at,total_volume:r.total_volume}};
}

export function hourlyWarmingBaseline(current,history) {
  const anchor=stamp(current.requested_at);
  const result={warming_baseline_mean_7d:null,warming_baseline_days:0,baseline_hours:0,warming_baseline_refs_json:[],warming_baseline_at:Number.isFinite(anchor)?iso(anchor):null,warming_baseline_status:'invalid_context'};
  if(!Number.isFinite(anchor)||current.quote_currency!=='usd'||!context.every(k=>current[k]))return result;
  for(let target=Math.floor((anchor-p.baseline_exclusion_seconds*1000)/3600000)*3600000;target>=anchor-p.baseline_days*86400000;target-=3600000){
    const selected=historical(current,history,target,p.baseline_tolerance_seconds*1000,anchor);
    if(selected.status==='conflicting_history')return {...result,warming_baseline_status:selected.status};
    if(selected.ref)result.warming_baseline_refs_json.push(selected.ref);
  }
  const count=result.warming_baseline_refs_json.length;
  result.baseline_hours=count;result.warming_baseline_days=count/24;
  if(!count)return {...result,warming_baseline_status:'missing_history'};
  const mean=result.warming_baseline_refs_json.reduce((sum,r)=>sum+r.total_volume/count,0);
  if(!finite(mean,true))return {...result,warming_baseline_status:'zero_or_nonfinite_baseline'};
  return {...result,warming_baseline_mean_7d:mean,warming_baseline_status:'complete'};
}

export const isNewAsset=current=>Number.isFinite(stamp(current.asset_created_at))&&stamp(current.requested_at)>=stamp(current.asset_created_at)&&stamp(current.requested_at)-stamp(current.asset_created_at)<7*86400000;
export const warmingBaselineLabel=(hours,zh=true)=>hours>=167?(zh?'基准 7 天':'Baseline 7 days'):hours>=24?(zh?`基准 ${Number((hours/24).toFixed(2))} 天`:`Baseline ${Number((hours/24).toFixed(2))} days`):(zh?`基准 ${hours} 小时`:`Baseline ${hours} hours`);

export function warmingMetrics(current,history) {
  const result={...hourlyWarmingBaseline(current,history),is_new_asset:isNewAsset(current),is_new:isNewAsset(current),warming_multiple:null,history_1h_volume:null,history_1h_ref_json:null,history_2h_volume:null,history_2h_ref_json:null,growth_1h:null,previous_growth_1h:null,growth_change_pp:null,growth_change_status:'unknown',warming_status:'invalid_current_volume'};
  if(!finite(current.total_volume))return result;
  if(result.warming_baseline_status!=='complete')return {...result,warming_status:result.warming_baseline_status};
  result.warming_multiple=current.total_volume/result.warming_baseline_mean_7d;
  const at=stamp(current.requested_at),lookback=p.history_window_seconds*1000,tolerance=p.history_tolerance_seconds*1000;
  const one=historical(current,history,at-lookback,tolerance);
  result.history_1h_ref_json=one.ref;result.history_1h_volume=one.ref?.total_volume??null;
  if(one.status!=='complete')return {...result,warming_status:one.status==='conflicting_history'?'conflicting_1h_history':'missing_1h_history'};
  if(!finite(result.history_1h_volume,true))return {...result,warming_status:'zero_1h_history'};
  result.growth_1h=current.total_volume/result.history_1h_volume-1;
  if(!Number.isFinite(result.growth_1h)||!finite(result.warming_multiple))return {...result,growth_1h:null,warming_multiple:null,warming_status:'nonfinite_metrics'};
  const two=historical(current,history,at-2*lookback,tolerance);
  result.history_2h_ref_json=two.ref;result.history_2h_volume=two.ref?.total_volume??null;
  if(two.status==='complete'&&finite(result.history_2h_volume,true)){
    const previous=result.history_1h_volume/result.history_2h_volume-1,change=(result.growth_1h-previous)*100;
    if(Number.isFinite(previous)&&Number.isFinite(change)){result.previous_growth_1h=previous;result.growth_change_pp=change;result.growth_change_status=Math.abs(change)<=p.growth_change_epsilon_pp?'steady':change>0?'accelerating':'slowing';}
  }
  return {...result,warming_status:'complete'};
}

export function rankWarming(rows,history,calculatedAt,coverage='healthy') {
  const at=stamp(calculatedAt);
  const result={algorithm_version:spec.version,calculated_at:calculatedAt,status:'unavailable',reason:null,rows:[],candidates:[],excluded:[],sample_count:0,excluded_count:0,warming_warmup:false};
  if(!Number.isFinite(at)||coverage!=='healthy')return {...result,reason:Number.isFinite(at)?'coverage_unavailable':'invalid_calculation_time'};
  const latest=new Map(),observations=new Map(),identities=new Map(),assetSources=new Map();
  for(const row of rows){
    if(!row.asset_id||!row.source_object_id){result.excluded.push({asset_id:row.asset_id??null,reason:'identity_unresolved'});continue;}
    if(!Number.isFinite(stamp(row.requested_at))||!Number.isFinite(stamp(row.collected_at)))return {...result,reason:'invalid_observation_time'};
    if(stamp(row.collected_at)>at||stamp(row.requested_at)>at){result.excluded.push({asset_id:row.asset_id,reason:'future_observation'});continue;}
    const source=`${row.source_id}/${row.source_object_id}`,observation=`${source}/${row.observation_id}`;
    const sig=JSON.stringify(row);
    if(observations.has(observation)&&observations.get(observation)!==sig)return {...result,reason:'conflicting_observation'};
    observations.set(observation,sig);
    if(identities.has(source)&&identities.get(source)!==row.asset_id||assetSources.has(row.asset_id)&&assetSources.get(row.asset_id)!==source)return {...result,reason:'conflicting_identity'};
    identities.set(source,row.asset_id);assetSources.set(row.asset_id,source);
    const prior=latest.get(row.asset_id);
    if(!prior||stamp(row.requested_at)>stamp(prior.requested_at)||stamp(row.requested_at)===stamp(prior.requested_at)&&String(row.observation_id)<String(prior.observation_id))latest.set(row.asset_id,row);
  }
  let complete=0;const ranked=[],scopes=new Set();
  for(const row of [...latest.values()].sort((a,b)=>a.asset_id.localeCompare(b.asset_id))){
    let reason=null;
    if(row.identity_status!=='resolved'||row.object_kind!=='coin')reason='identity_unresolved';
    else if(row.metric_version!==spec.metric_version)reason='unsupported_metric_version';
    else if(row.quality_status!=='healthy'||row.quote_currency!=='usd'||!context.every(k=>row[k]))reason='invalid_quality_or_context';
    else if(!(stamp(row.requested_at)<=stamp(row.collected_at)&&stamp(row.collected_at)<=at&&stamp(row.observed_at)<=stamp(row.collected_at)&&stamp(row.observed_at)>=at-p.max_source_age_seconds*1000))reason='invalid_or_stale_time';
    else if(!row.observation_id||!row.metric_id||!row.snapshot_ref||!finite(row.total_volume)||!finite(row.current_price,true)||!finite(row.market_cap,true))reason='invalid_current_values';
    if(reason){result.excluded.push({asset_id:row.asset_id,reason});continue;}
    result.sample_count++;scopes.add(JSON.stringify([row.source_id,row.quote_currency,row.coverage_key]));
    const metrics=warmingMetrics(row,history);
    const candidate={...row,...metrics};result.candidates.push(candidate);
    if(metrics.warming_status!=='complete')reason=metrics.warming_status;
    else {complete++;if(metrics.warming_multiple<=p.minimum_multiple_exclusive)reason='not_above_baseline';else if(metrics.growth_1h<=p.minimum_growth_exclusive)reason='not_growing';}
    if(reason){result.excluded.push({asset_id:row.asset_id,reason});continue;}
    ranked.push(candidate);
  }
  if(scopes.size>1)return {...result,reason:'mixed_batch_context',candidates:[],sample_count:0};
  result.excluded_count=result.excluded.length;
  result.warming_warmup=result.sample_count>0&&complete===0;
  if(result.warming_warmup)return {...result,status:'insufficient_history',reason:'no_complete_metrics'};
  if(rows.length&&result.sample_count===0)return {...result,reason:'no_valid_current_candidates'};
  ranked.sort((a,b)=>b.growth_1h-a.growth_1h||b.warming_multiple-a.warming_multiple||a.asset_id.localeCompare(b.asset_id));
  result.status='success';
  result.rows=ranked.slice(0,p.top_n).map((r,i)=>({...r,object_key:`asset/${r.asset_id}`,rank:i+1,score:r.growth_1h,algorithm_version:spec.version,calculation_status:'success',snapshot_id:`${r.coverage_key}/${calculatedAt}/${spec.version}`,calculated_at:calculatedAt,source_as_of:calculatedAt,sample_count:result.sample_count,excluded_count:result.excluded_count,excluded_reasons_json:result.excluded,warming_warmup:false,reason:`1h growth ${(r.growth_1h*100).toFixed(2)}%; baseline ${r.warming_multiple.toFixed(2)}x`,trend_status:'warming',price_direction:typeof r.price_change_percentage_24h!=='number'?'unknown':r.price_change_percentage_24h>0?'up':r.price_change_percentage_24h<0?'down':'flat',observation_refs_json:[r.observation_id,...r.warming_baseline_refs_json.map(x=>x.observation_id),r.history_1h_ref_json.observation_id,...(r.history_2h_ref_json?[r.history_2h_ref_json.observation_id]:[])],run_id:r.run_id??`design:round:${calculatedAt}`,window_label:'rolling_24h_with_1h_comparison',window_start:null,window_end:null}));
  return result;
}

export const warmingCases=[['normal','双榜重叠 · 增长速度与加快','Overlap · growth and acceleration'],['steady','持续快速增长 · 不再加快','Fast steady growth'],['plateau','高位持续 · 无近期增长','High plateau without new growth'],['falling','仍高于常态 · 已回落','Above normal but falling'],['missing_day','短历史 · 有多少用多少','Short history still ranks'],['missing_1h','缺1h比较历史','Missing 1h history'],['missing_2h','缺2h解释 · 仍排名','Missing 2h history still ranks'],['warmup','全部缺历史 · 预热','All history missing'],['zero_history','1h历史为0','Zero 1h denominator'],['partial','覆盖不完整','Partial coverage'],['stale','来源过期','Stale source'],['empty','完整覆盖成功空批','Healthy empty batch'],['cadence12','12分钟采样','12-minute sampling'],['cadence3','3分钟采样','3-minute sampling'],['rollover','跨日逐请求重算','Recompute across midnight']];
export function warmingExample(key='normal') {
  const calculatedAt=key==='rollover'?'2026-10-15T00:05:00.000Z':'2026-10-14T12:05:00.000Z',anchor=Date.parse(calculatedAt)-60000;
  const raw=[],history=[];
  const values=[[130,110,100,100,5],[144,120,100,100,-7],[130,100,50,80,1],[120,120,100,100,0]];
  for(let i=0;i<values.length;i++){
    let [volume,one,two,base,change]=values[i];
    if(key==='steady'&&i===0){volume=144;one=120;two=100;}
    if(key==='plateau'){volume=130;one=130;}
    if(key==='falling'){volume=120;one=150;}
    if(key==='zero_history')one=0;
    const r={observation_id:`design:ss102:${key}:${i}`,asset_id:`00000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,asset_name:`假设币 ${String.fromCharCode(65+i)} / Example ${String.fromCharCode(65+i)}`,asset_created_at:iso(anchor-(i===0?2:10)*86400000),identity_status:'resolved',object_kind:'coin',source_id:'coingecko.coins_markets',source_object_id:`design-coin-${i}`,quote_currency:'usd',coverage_key:'design:ss102:complete-universe',requested_at:iso(anchor),collected_at:iso(anchor+1000),observed_at:iso(anchor),quality_status:'healthy',total_volume:volume*10000,current_price:2,market_cap:15e6,price_change_percentage_24h:change,metric_id:`design:ss102:${key}:${i}/market_indicators_v2`,metric_version:spec.metric_version,snapshot_ref:`design:ss102:${key}:raw:${i}`};
    if(key==='stale')r.observed_at=iso(anchor-1200000);
    raw.push(r);
    const append=(at,value,suffix)=>history.push({...r,observation_id:`design:ss102:history:${i}:${suffix}`,requested_at:iso(at),collected_at:iso(at+1000),observed_at:iso(at),total_volume:value*10000});
    const sampling=key==='cadence12'?11*60000:key==='cadence3'?2*60000:60000;
    for(let hour=3;hour<=(key==='missing_day'?3:168);hour++)if(key!=='warmup')append(Math.floor(anchor/3600000)*3600000-hour*3600000-sampling,base,`hour-${hour}`);
    if(key!=='warmup'&&key!=='missing_1h')append(anchor-3600000-sampling,one,'1h');
    if(key!=='warmup'&&key!=='missing_2h')append(anchor-7200000-sampling,two,'2h');
  }
  const current=key==='empty'?[]:raw;
  const batch=rankWarming(current,history,calculatedAt,key==='partial'?'partial':'healthy');
  return {key,current,history,focus:raw[0],baseline:hourlyWarmingBaseline(raw[0],history),metrics:warmingMetrics(raw[0],history),batch,calculatedAt,hottestAssetIds:raw.slice(0,2).map(r=>r.asset_id)};
}
export const warmingCard=node=>spec.cards.find(c=>c.key===node.card_contract?.config.resource?.warming_key);
export const warmingSnapshotIsCurrent=(batch,now)=>batch.status==='success'&&stamp(now)>=stamp(batch.calculated_at)&&stamp(now)-stamp(batch.calculated_at)<p.expiry_seconds*1000;
