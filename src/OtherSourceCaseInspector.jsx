import React, { useEffect, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { interpretOtherCall, interpretOtherRow, otherResponseRows, otherRowLabel } from './otherSourceCaseData';
import identityPilot from '../catalog/identity-flow-case.v1.json';
import './source-case-inspector.css';

function display(value) {
  if (value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function fieldLabel(contract, key) {
  if (contract?.id === 'kaito.mcp.kaito_events') {
    const eventLabels = { ticker: '关联代币', date: '事件日期', start_date: '事件开始日期', end_date: '事件结束日期', catalyst_list: '事件类别', earliestRef: '最早参考资料', reference_list: '参考资料列表' };
    if (eventLabels[key]) return eventLabels[key];
  }
  return contract?.fields?.find(field => field.path === key || field.path.endsWith(`.${key}`) || field.path.endsWith(`[].${key}`))?.label_zh;
}

function displayedFields(operationId, row) {
  if (operationId === 'kaito.mcp.kaito_smart_following_market') {
    const flatten = (key, value) => value && !Array.isArray(value) && typeof value === 'object'
      ? Object.entries(value).flatMap(([part, nested]) => flatten(`${key}.${part}`, nested))
      : [[key, value]];
    return Object.entries(row).filter(([key]) => key !== 'raw')
      .flatMap(([key, value]) => flatten(key, value));
  }
  return Object.entries(row).filter(([key]) => key !== 'raw');
}

export function OtherSourceCaseInspector({ operationId, language, purpose, onOpenFull }) {
  const zh = language === 'zh-CN';
  const [contract, setContract] = useState(null);
  const [liveCases, setLiveCases] = useState([]);
  const [caseIndex, setCaseIndex] = useState(0);
  const [rowIndex, setRowIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setContract(null); setLiveCases([]); setCaseIndex(0); setRowIndex(0); setLoading(true);
    const kind = operationId.startsWith('kaito.resource.') ? 'resources' : 'operations';
    Promise.all([
      fetch(`/api/source-contracts/v1/${kind}/${encodeURIComponent(operationId)}`).then(response => response.json()),
      fetch(`/api/source-cases/v1/${encodeURIComponent(operationId)}`).then(response => response.ok ? response.json() : { cases: [] }),
    ]).then(([definition, data]) => { if (active) { setContract(definition.operation || definition.resource); setLiveCases(data.cases || []); } })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [operationId]);
  const isIdentitySource = operationId === 'kaito.mcp.kaito_smart_following_market';
  const pilotCase = isIdentitySource ? [{
    case_label_zh: '本次真实调用 · 两条记录用于身份案例',
    request: identityPilot.source.request,
    response: identityPilot.cases.map(item => item.source_record),
    response_excerpt: true,
    response_count: identityPilot.source.response_count,
    observed_at: identityPilot.source.observed_at,
  }] : [];
  const cases = [...pilotCase, ...(liveCases.length ? liveCases : contract?.call_examples || [])];
  const example = cases[caseIndex];
  const requestFields = Object.entries(example?.request || {});
  const rows = otherResponseRows(operationId, example);
  const row = rows[rowIndex] || rows[0];
  const visibleFields = row ? displayedFields(operationId, row) : [];
  if (loading) return <p className="source-case-inspector-status">{zh ? '正在读取案例…' : 'Loading case…'}</p>;
  return <div className="source-case-inspector">
    {example ? <>
      {cases.length > 1 && <label className="source-case-inspector-picker">{zh ? operationId === 'taoli.funding_page' ? '网页观察' : '调用案例' : 'Call'}<select value={caseIndex} onChange={event => { setCaseIndex(Number(event.target.value)); setRowIndex(0); }} aria-label={zh ? operationId === 'taoli.funding_page' ? '选择网页观察' : '选择调用案例' : 'Select call'}>{cases.map((item, index) => <option value={index} key={index}>{index + 1} · {item.case_label_zh || `案例 ${index + 1}`}</option>)}</select></label>}
      <section className="source-case-inspector-section"><h3>{zh ? '输入' : 'Input'}</h3>
        {requestFields.length ? <dl className="source-case-inspector-fields">{requestFields.map(([key, value], index) => <div key={key}><dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span>{zh && contract?.inputs?.find(field => field.name === key)?.label_zh} <code>{key}</code></dt><dd>{display(value)}</dd></div>)}</dl>
          : <p className="source-case-inspector-status">{zh ? '本次未传参数' : 'No parameters sent'}</p>}</section>
      <section className="source-case-inspector-section"><div className="source-case-inspector-heading"><h3>{zh ? '输出' : 'Output'}</h3><span>{example.response_excerpt ? `${zh ? '真实返回' : 'Actual response'} ${example.response_count} · ${zh ? '保存' : 'saved'} ${rows.length}` : example.observation_complete ? zh ? '网页可见表格' : 'Observed page table' : example.response_complete ? zh ? '完整返回' : 'Complete response' : zh ? '保存的返回片段' : 'Saved excerpt'}{(example.response_complete || example.observation_complete) ? ` · ${rows.length} ${zh ? '条' : 'rows'}` : ''}</span></div>
        {rows.length > 1 && <select className="source-case-inspector-row-picker" value={Math.min(rowIndex, rows.length - 1)} onChange={event => setRowIndex(Number(event.target.value))} aria-label={zh ? example.observation_complete ? '选择网页记录' : '选择返回记录' : 'Select returned row'}>{rows.map((item, index) => <option key={index} value={index}>{otherRowLabel(item, index)}</option>)}</select>}
        {row ? <dl className="source-case-inspector-fields">{visibleFields.map(([key, value], index) => <div key={key}><dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span>{zh && fieldLabel(contract, key)} <code>{key}</code></dt><dd>{typeof value === 'string' && /^https:\/\//.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a> : display(value)}</dd></div>)}</dl> : <pre>{example.response_format === 'xml' ? String(example.response).slice(0, 1200) : JSON.stringify(example.response, null, 2)?.slice(0, 1200)}</pre>}
      </section>
    </> : <><section className="source-case-inspector-section"><h3>{zh ? '输入' : 'Input'}</h3><p className="source-case-inspector-status">{zh ? '尚无成对保存的调用参数' : 'No paired request has been saved.'}</p></section><section className="source-case-inspector-section"><h3>{zh ? '输出' : 'Output'}</h3><p className="source-case-inspector-status">{zh ? contract?.call_status_note_zh || '当前没有实际调用返回。' : 'No paired response has been saved.'}</p></section></>}
    <section className="source-case-inspector-explanation source-case-inspector-purpose"><h3>{zh ? '这张爬虫卡做什么' : 'What this source does'}</h3><p>{purpose}</p><h3>{zh ? '这次查到了什么' : 'What this call found'}</h3><p>{example ? zh ? interpretOtherCall(contract, example, rows) : example.explanation_en || 'Review the saved response.' : zh ? '尚无成对保存的调用案例。' : 'No paired call case has been saved.'}</p><h3>{zh ? '所选记录怎么读' : 'How to read the selected record'}</h3><p>{row ? zh ? interpretOtherRow(operationId, row) : 'This row comes from the response.' : zh ? '尚无返回记录可解读。' : 'There is no returned record to interpret.'}</p>{operationId === 'kaito.mcp.kaito_events' && row?.earliestRef?.url?.startsWith('https://') && <p><a href={row.earliestRef.url} target="_blank" rel="noopener noreferrer">{zh ? '打开本次返回中最早的参考资料 ↗' : 'Open earliest returned reference ↗'}</a></p>}</section>
    {!example?.response_excerpt && <button type="button" className="source-case-inspector-open" onClick={() => onOpenFull(caseIndex - pilotCase.length)}><Maximize2 size={14} />{zh ? example?.observation_complete ? '展开网页表格与筛选解释' : example?.response_complete ? '展开输入、完整返回与参数解释' : '展开案例与参数解释' : 'Open case and parameter guide'}</button>}
  </div>;
}
