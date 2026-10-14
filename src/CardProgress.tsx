import React from 'react';
import type { CardProgress } from './contracts';
import './card-progress.css';

import { labels, progressStatus } from './cardProgressModel';
export { progressStatus } from './cardProgressModel';
export function CardProgressBadge({progress,language}:{progress?:CardProgress;language:string}) {
  const zh=language==='zh-CN',status=progressStatus(progress);
  const reason=progress?.stale ? (zh?'历史报告与当前设计版本不匹配，需重新核实':'Historical reports do not match the current design') : progress?.report?.summary;
  return <span className={`card-progress-badge progress-${status}`} title={reason || (zh?'没有当前有效的逐卡报告':'No current per-card report')}>{labels[status]![zh?0:1]}</span>;
}
export function CardProgressNote({progress,language}:{progress?:CardProgress;language:string}) {
  const zh=language==='zh-CN',r=progress?.report;
  const date=(value?:string)=>value ? `${new Date(value).toLocaleString(zh?'zh-CN':'en-GB',{timeZone:'Asia/Shanghai',hour12:false})} (UTC+8)` : '';
  const evidence=(value:string)=>/^https?:\/\//i.test(value) ? <a href={value} target="_blank" rel="noreferrer">{value}</a> : value;
  return <div className="card-progress-note">
    <CardProgressBadge progress={progress} language={language}/>
    {progress?.conflict && <p role="status">{zh?'同一版本存在冲突报告，请查看双方依据；不能按最后提交直接判定通过。':'Reports conflict for this version. Inspect both; the last report does not establish a pass.'}</p>}
    {progress?.stale ? <p>{zh?'历史报告与当前设计版本不匹配，等待重新核实；这不表示代码一定未完成。':'Historical reports do not match the current design. Recheck; this does not establish incomplete code.'}</p> : r ? <>
      <p>{r.summary || (zh?'已提交核对报告。':'A report was submitted.')}</p>
      <small>{r.reported_by || (zh?'未注明报告方':'Unspecified reporter')} · {r.reporter_role==='reviewer' ? (zh?'审核回报':'Review report') : (zh?'实现回报':'Implementation report')} · {date(r.reported_at)}</small>
      <details><summary>{zh?'版本与核验依据':'Versions and evidence'}</summary>
        <dl><dt>{zh?'设计版本':'Design revision'}</dt><dd>{r.definition_revision || '—'}</dd>
          <dt>{zh?'代码仓库':'Code repository'}</dt><dd>{r.code_repository || (zh?'旧报告未注明':'Not specified in legacy report')}</dd>
          <dt>{zh?'代码版本':'Code revision'}</dt><dd>{r.code_revision}</dd>
          <dt>{zh?'报告编号':'Report ID'}</dt><dd>{r.id || '—'}</dd>
          {r.implementation_report_id && <><dt>{zh?'对应实现报告':'Implementation report'}</dt><dd>{r.implementation_report_id}</dd></>}
        </dl><p>{evidence(r.evidence_ref)}</p>
        {!!r.checks?.length && <ul>{r.checks.map((c,i)=><li key={i}>{c.requirement} · {zh?({pass:'通过',fail:'失败',unverified:'未验证'} as Record<string,string>)[c.result]:c.result}<br/>{evidence(c.evidence_ref)}</li>)}</ul>}
        {!!r.differences?.length && <p>{zh?'具体差异：':'Differences: '}{r.differences.join('；')}</p>}
        {!!r.unverified_items?.length && <p>{zh?'未验证：':'Unverified: '}{r.unverified_items.join('；')}</p>}
        <p>{zh?'报告方及角色由调用方声明。结论仅针对记录的设计、代码版本及检查项，不代表身份已认证、已部署或持续运行正常。':'Reporter identities and roles are declared. Conclusions cover the recorded design, commit and checks; they do not authenticate identity or establish deployment/runtime health.'}</p>
      </details>
    </> : !progress?.stale && <p>{zh?'尚无当前有效的逐卡报告，新卡默认待核实。':'No current per-card report. New cards default to unconfirmed.'}</p>}
    <small>{zh?'当前设计版本：':'Current design revision: '}{progress?.definition_revision || '—'}</small>
    {!!progress?.history?.length && <details><summary>{zh?`报告历史（${progress.history.length}）`:`Report history (${progress.history.length})`}</summary>
      <ol>{progress.history.map(h=><li key={h.id}>
        <strong>{h.reported_by || '—'} · {h.reporter_role || (zh?'旧版回报':'Legacy report')} · {h.status && labels[h.status] ? labels[h.status]![zh?0:1] : h.observations?.implementation}</strong>
        <small>{date(h.reported_at)}</small><p>{h.summary}</p>
        <dl><dt>{zh?'报告编号':'Report ID'}</dt><dd>{h.id}</dd><dt>{zh?'设计版本':'Design revision'}</dt><dd>{h.definition_revision || '—'}</dd>
          <dt>{zh?'代码仓库 / 版本':'Repository / commit'}</dt><dd>{h.code_repository || '—'} / {h.code_revision}</dd></dl>
        {h.evidence_ref && <p>{evidence(h.evidence_ref)}</p>}
        <small>{h.definition_revision !== progress.definition_revision ? (zh?'历史设计版本，未用于当前结论':'Historical design; excluded from current conclusion') : progress.active_report_ids && !progress.active_report_ids.includes(h.id) ? (zh?'历史版本或已替代报告，未用于当前结论':'Historical target or superseded report') : (zh?'当前设计版本报告':'Report for current design')}</small>
      </li>)}</ol></details>}
  </div>;
}
