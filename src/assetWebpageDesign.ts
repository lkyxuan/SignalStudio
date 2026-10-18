// Pure webpage decision example; no storage, crawler, scheduler or generator calls.
export type CurrentPage = {asset_id:string;page_ref:string;updated_at:string|null};
export function decideCurrentPages(ids:string[], pages:CurrentPage[], now:string, intervalSeconds:number|null, completeRead=true) {
  const at=Date.parse(now);
  return [...new Set(ids)].map(asset_id=>{
    const matches=pages.filter(p=>p.asset_id===asset_id);
    const page=matches[0];
    const time=page?.updated_at==null?NaN:Date.parse(page.updated_at);
    let action='blocked',reason='read_unavailable';
    if(completeRead && Number.isFinite(at)) {
      if(matches.length>1)reason='duplicate_current_rows';
      else if(!page){action='generate';reason='missing_page';}
      else if(!page.page_ref.trim() || !Number.isFinite(time) || time>at)reason='unknown_or_invalid_page_time';
      else if(intervalSeconds==null || !Number.isFinite(intervalSeconds) || intervalSeconds<=0)reason='page_interval_unconfigured';
      else if(at-time>=intervalSeconds*1000){action='refresh';reason='page_expired';}
      else {action='skip';reason='page_fresh';}
    }
    return {asset_id,page_ref:page?.page_ref??null,action,reason,
      age_minutes:Number.isFinite(at)&&Number.isFinite(time)&&time<=at?(at-time)/60000:null};
  });
}
