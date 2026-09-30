import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, X } from 'lucide-react';
import { interpretCall, interpretInput, interpretRecord } from './sourceCaseInterpretations';
import { SourceCaseInputs } from './SourceCaseInputs';
import './source-case-page.css';

const OPERATION_ID = 'kaito.mcp.kaito_advanced_search';

export function SourceCasePage({ language, initialCaseIndex = 0, onClose }) {
  const zh = language === 'zh-CN';
  const [contract, setContract] = useState(null);
  const [liveCases, setLiveCases] = useState([]);
  const [error, setError] = useState('');
  const [caseIndex, setCaseIndex] = useState(initialCaseIndex);
  const closeButton = useRef(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/source-contracts/v1/operations/${encodeURIComponent(OPERATION_ID)}`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Unable to load source case');
        if (active) setContract(data);
      })
      .catch(reason => { if (active) setError(reason.message); });
    fetch('/api/source-cases/016')
      .then(async response => {
        if (!response.ok) throw new Error('Unable to load complete responses');
        const data = await response.json();
        if (active) setLiveCases(data.cases || []);
      })
      .catch(() => { /* Saved call excerpts remain available. */ });
    closeButton.current?.focus();
    const onKeyDown = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => { active = false; window.removeEventListener('keydown', onKeyDown); };
  }, [onClose]);

  const operation = contract?.operation;
  const cases = liveCases.length ? liveCases : operation?.call_examples || [];
  const example = cases[caseIndex];
  const complete = Boolean(example?.response_complete);
  const resultRows = complete && Array.isArray(example.response?.results) ? example.response.results : [];
  const resultCount = complete ? resultRows.length : example?.result_count;

  return <div className="source-case-page" role="dialog" aria-modal="true" aria-labelledby="source-case-title">
    <header className="source-case-topbar">
      <button type="button" onClick={onClose} ref={closeButton}><ArrowLeft size={17} />{zh ? '返回设计图' : 'Back to graph'}</button>
      <span>SignalStudio / {zh ? 'API 调用案例' : 'API call examples'}</span>
      <button type="button" className="source-case-close" onClick={onClose} aria-label={zh ? '关闭案例页' : 'Close case page'}><X size={19} /></button>
    </header>
    <main className="source-case-content">
      <div className="source-case-intro">
        <span className="source-case-kicker">#2012 · KAITO MCP</span>
        <h1 id="source-case-title">{zh ? '高级内容搜索' : 'Advanced content search'}</h1>
        <code>{OPERATION_ID}</code>
        <a className="source-case-input-jump" href="#source-case-inputs">{zh ? '查看全部输入参数与本次传值 ↓' : 'See every input and this call’s values ↓'}</a>
      </div>
      {error && <p role="alert" className="source-case-error">{error}</p>}
      {!error && !operation && <p className="source-case-loading">{zh ? '正在读取案例…' : 'Loading cases…'}</p>}
      {operation && <>
        {!complete && <p className="source-case-panel-note">{zh ? '当前只找到旧调用留下的返回片段。' : 'Only an excerpt from the earlier call is available.'}</p>}
        <nav className="source-case-tabs" aria-label={zh ? '实际调用案例' : 'Observed call cases'}>
          {cases.map((item, index) => <button type="button" key={`${item.observed_at}-${index}`} aria-current={index === caseIndex ? 'page' : undefined} onClick={() => setCaseIndex(index)}><span>{String(index + 1).padStart(2, '0')}</span>{zh ? item.case_label_zh || `案例 ${index + 1}` : item.case_label_en || `Case ${index + 1}`}</button>)}
        </nav>
        {example && <>
          <div className="source-case-comparison">
            <section className="source-case-panel">
              <div className="source-case-panel-head"><div><span>{zh ? '输入' : 'Input'}</span><h2>{zh ? '这次发送了什么' : 'What was sent'}</h2></div><small>{example.observed_at}</small></div>
              <pre>{JSON.stringify(example.request, null, 2)}</pre>
              <div className="source-case-input-explanation"><h3>{zh ? '这次参数是什么意思' : 'What these inputs mean'}</h3><p>{interpretInput(example, caseIndex, language)}</p></div>
            </section>
            <section className="source-case-panel">
              <div className="source-case-panel-head"><div><span>{zh ? '返回' : 'Output'}</span><h2>{complete ? (zh ? 'API 实际返回了什么' : 'Full API response') : (zh ? '旧案例留下的片段' : 'Saved excerpt')}</h2></div><small>{zh ? `API 返回 ${resultCount} 条` : `API returned ${resultCount} rows`}</small></div>
              {!complete && <p className="source-case-panel-note">{zh ? '这是第 1 条记录当时留下的片段，不是完整 API 响应。' : 'This is a saved excerpt of row 1, not the complete API response.'}</p>}
              <pre className={complete ? 'source-case-full-json' : ''}>{JSON.stringify(example.response, null, 2)}</pre>
              {!complete && <p className="source-case-path">{zh ? '对应的返回位置' : 'Response path'}：<code>{example.response_path || '—'}</code></p>}
            </section>
          </div>
          {complete && <section className="source-case-interpretation">
            <h2>{zh ? '这次查到了什么' : 'What this call found'}</h2>
            <p>{interpretCall(example, caseIndex, language)}</p>
            {resultRows[0] && <><h2>{zh ? '第一条内容说了什么，怎么用' : 'What the first record says and how to use it'}</h2><p>{interpretRecord(resultRows[0], language)}</p></>}
          </section>}
        </>}
        {example && <SourceCaseInputs operation={operation} cases={cases} example={example} language={language} />}
        <div className="source-case-footer"><span>{zh ? '这是上游 API 的调用案例，不能证明爬虫已经采集。' : 'These upstream API calls do not establish crawler collection.'}</span><a href={operation.documentation_url} target="_blank" rel="noopener noreferrer">{zh ? '上游接口说明' : 'Upstream documentation'} <ArrowUpRight size={15} /></a></div>
      </>}
    </main>
  </div>;
}
