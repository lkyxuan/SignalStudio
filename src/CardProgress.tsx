import React from 'react';
import type { CardProgress } from './contracts';
import './card-progress.css';

const labels:Record<string,[string,string]> = {
  unknown:['待核实','Unconfirmed'], implemented:['已实现','Implemented'],
  not_implemented:['未实现','Not implemented'], disputed:['有分歧','Disputed'],
  mismatch:['与卡片不一致','Differs from card'],
};
export function progressStatus(progress?:CardProgress) {
  if(progress?.stale || !progress?.report) return 'unknown';
  const status=progress.report.observations.implementation;
  // Legacy verification is a report, never an independent acceptance here.
  if(status==='verified') return 'implemented';
  if(status==='not_started' || status==='in_progress') return 'not_implemented';
  if(status==='partial') return 'mismatch';
  return status && labels[status] ? status : 'unknown';
}
export function CardProgressBadge({progress,language}:{progress?:CardProgress;language:string}) {
  const zh=language==='zh-CN',status=progressStatus(progress);
  const reason=progress?.stale ? (zh?'旧版回报待重新核实':'Earlier report needs rechecking') : progress?.report?.summary;
  return <span className={`card-progress-badge progress-${status}`} title={reason || (zh?'由实现侧核实并回报':'Reported by the implementing side')}>{labels[status]![zh?0:1]}</span>;
}
export function CardProgressNote({progress,language}:{progress?:CardProgress;language:string}) {
  const zh=language==='zh-CN',r=progress?.report;
  return <div className="card-progress-note">
    <CardProgressBadge progress={progress} language={language}/>
    {progress?.stale ? <p>{zh?'卡片已变更，等待 Few 重新核实。':'The card changed; awaiting a new Few report.'}</p> : r ? <>
      <p>{r.summary || (zh?'实现侧已提交核对结果。':'The implementing side reported a result.')}</p>
      <small>{r.reported_by==='few_understand'?'Few Understand':r.reported_by || (zh?'实现侧回报':'Implementation report')}{r.reported_at ? ` · ${new Date(r.reported_at).toLocaleString(zh?'zh-CN':'en-GB',{timeZone:'Asia/Shanghai',hour12:false})} (UTC+8)` : ''}</small>
      <details><summary>{zh?'查看依据':'View evidence'}</summary><p>{/^https?:\/\//i.test(r.evidence_ref) ? <a href={r.evidence_ref} target="_blank" rel="noreferrer">{r.evidence_ref}</a> : r.evidence_ref}</p><small>{zh?'代码版本：':'Code revision: '}{r.code_revision}</small><p>{zh?'此为实现侧回报，不代表本侧独立验收或运行成功。':'This is an implementation-side report; it does not establish independent acceptance or runtime success.'}</p></details>
    </> : <p>{zh?'等待 Few Understand 核实。':'Awaiting verification by Few Understand.'}</p>}
  </div>;
}
