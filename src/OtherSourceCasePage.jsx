import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowUpRight, X } from 'lucide-react';
import inputSchemas from '../catalog/kaito-mcp-input-schemas.json';
import { explainOtherInput } from './otherSourceCaseGuide';
import { interpretOtherCall, interpretOtherRow, otherResponseRows, otherRowLabel } from './otherSourceCaseData';
import './source-case-page.css';

function display(value) {
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function inputType(operation, input) {
  const toolName = operation.id.startsWith('kaito.mcp.') ? operation.id.slice('kaito.mcp.'.length) : '';
  const schema = inputSchemas.tools.find(tool => tool.name === toolName)?.inputSchema;
  const property = schema?.properties?.[input.name];
  const parts = [];
  if (property?.type) parts.push({ string: '文本', number: '数字', integer: '整数', boolean: '布尔值' }[property.type] || property.type);
  if (property?.enum) parts.push(property.enum.join(' / '));
  if (property?.minimum != null || property?.maximum != null) parts.push(`${property.minimum ?? '−∞'}–${property.maximum ?? '∞'}`);
  if (input.accepted_values) parts.push(input.accepted_values);
  return [...new Set(parts)].join(' · ');
}

export function OtherSourceCasePage({ operationId, initialCaseIndex = 0, language, onClose }) {
  const zh = language === 'zh-CN';
  const [contract, setContract] = useState(null);
  const [liveCases, setLiveCases] = useState([]);
  const [casesLoaded, setCasesLoaded] = useState(false);
  const [caseIndex, setCaseIndex] = useState(initialCaseIndex);
  const [rowIndex, setRowIndex] = useState(0);
  const [error, setError] = useState('');
  const closeButton = useRef(null);
  useEffect(() => {
    let active = true;
    const kind = operationId.startsWith('kaito.resource.') ? 'resources' : 'operations';
    fetch(`/api/source-contracts/v1/${kind}/${encodeURIComponent(operationId)}`)
      .then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Unable to load contract'); if (active) setContract(data); })
      .catch(reason => { if (active) setError(reason.message); });
    fetch(`/api/source-cases/v1/${encodeURIComponent(operationId)}`)
      .then(async response => { if (!response.ok) throw new Error('Unable to load call records'); const data = await response.json(); if (active) setLiveCases(data.cases || []); })
      .catch(() => { /* Existing contract excerpts remain visible. */ })
      .finally(() => { if (active) setCasesLoaded(true); });
    closeButton.current?.focus();
    const onKeyDown = event => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => { active = false; window.removeEventListener('keydown', onKeyDown); };
  }, [operationId, onClose]);

  const operation = contract?.operation || contract?.resource;
  const cases = !casesLoaded ? [] : liveCases.length ? liveCases : operation?.call_examples || [];
  const example = cases[caseIndex];
  const rows = operation && example ? otherResponseRows(operationId, example) : [];
  const selectedRow = rows[rowIndex] || rows[0];
  const isLive = Boolean(example?.response_complete || example?.observation_complete);
  const pageObservation = example?.evidence === 'live_page_observation';
  const responseText = example ? example.response_format === 'xml' ? example.response : JSON.stringify(example.response, null, 2) : '';
  const largeResponse = responseText.length > 200000;
  return <div className="source-case-page" role="dialog" aria-modal="true" aria-labelledby="other-source-case-title">
    <header className="source-case-topbar">
      <button type="button" onClick={onClose} ref={closeButton}><ArrowLeft size={17} />{zh ? '返回设计图' : 'Back to graph'}</button>
      <span>SignalStudio / {zh ? '上游调用案例' : 'Upstream call examples'}</span>
      <button type="button" className="source-case-close" onClick={onClose} aria-label={zh ? '关闭案例页' : 'Close case page'}><X size={19} /></button>
    </header>
    <main className="source-case-content">
      <div className="source-case-intro"><span className="source-case-kicker">{contract?.source?.label_zh || operationId.split('.')[0]}</span><h1 id="other-source-case-title">{zh ? operation?.label_zh || operationId : operationId}</h1><code>{operationId}</code><a className="source-case-input-jump" href="#other-source-inputs">{zh ? '查看全部参数与本次传值 ↓' : 'See all parameters and values ↓'}</a></div>
      {error && <p className="source-case-error" role="alert">{error}</p>}
      {!error && !operation && <p className="source-case-loading">{zh ? '正在读取案例…' : 'Loading examples…'}</p>}
      {operation && !casesLoaded && <p className="source-case-loading">{zh ? '正在读取完整返回…' : 'Loading complete response…'}</p>}
      {operation && casesLoaded && <>
        {cases.length ? <>
          <nav className="source-case-tabs" aria-label={zh ? '实际案例' : 'Observed examples'}>{cases.map((item, index) => <button type="button" key={`${item.observed_at}-${index}`} aria-current={index === caseIndex ? 'page' : undefined} onClick={() => { setCaseIndex(index); setRowIndex(0); }}><span>{String(index + 1).padStart(2, '0')}</span>{item.case_label_zh || (zh ? `案例 ${index + 1}` : `Case ${index + 1}`)}</button>)}</nav>
          {!isLive && <p className="source-case-panel-note">{pageObservation ? '这组案例只保存了当时网页可见的一行，不是完整表格或底层 API 返回。' : '当前只有之前调用留下的返回节选；下方不会把它标为完整 API 响应。'}</p>}
          <div className="source-case-comparison">
            <section className="source-case-panel"><div className="source-case-panel-head"><div><span>{zh ? '输入' : 'Input'}</span><h2>{zh ? '这次传入了什么' : 'What was sent'}</h2></div><small>{example.observed_at}</small></div><pre>{JSON.stringify(example.request, null, 2)}</pre>
              <div className="source-case-input-explanation"><h3>{zh ? '每个传值是什么意思' : 'Meaning of sent inputs'}</h3>{Object.entries(example.request || {}).length ? <dl className="other-source-sent-inputs">{Object.entries(example.request).map(([name, value]) => {
                const input = operation.inputs?.find(field => field.name === name);
                return <div key={name}><dt><code>{name}</code> <span>{display(value)}</span></dt><dd>{input ? explainOtherInput(operation, input) : zh ? '这是实际传入的值；当前参数目录未列出该名称。' : 'Sent value; absent from the saved input contract.'}</dd></div>;
              })}</dl> : <p>{zh ? '这次没有传筛选参数（空对象）。' : 'No inputs were sent.'}</p>}</div>
            </section>
            <section className="source-case-panel"><div className="source-case-panel-head"><div><span>{zh ? pageObservation ? '网页所见' : '返回' : 'Output'}</span><h2>{isLive ? pageObservation ? (zh ? '实际可见表格' : 'Observed page table') : largeResponse ? (zh ? '实际返回预览' : 'Response preview') : (zh ? '实际完整返回' : 'Complete response') : (zh ? '当时保存的返回片段' : 'Saved response excerpt')}</h2></div>{isLive && <small>{zh ? `${rows.length} 条可查看记录` : `${rows.length} viewable rows`}</small>}</div>{largeResponse && <p className="source-case-panel-note">{zh ? '这次返回很大；下方预览前 3 万字符，可用“逐条看返回内容”检查每条记录。' : 'This response is large. The preview shows its first 30,000 characters; inspect rows below.'} <a href={`/api/source-cases/v1/${encodeURIComponent(operationId)}/responses/${caseIndex}`} target="_blank" rel="noopener noreferrer">{zh ? '在新页查看完整原始返回 ↗' : 'Open complete raw response ↗'}</a></p>}<pre className="source-case-full-json">{largeResponse ? `${responseText.slice(0, 30000)}\n…（预览到此；完整返回见上方链接）` : responseText}</pre></section>
          </div>
          <section className="source-case-interpretation"><h2>{zh ? '这次查到了什么' : 'What this call found'}</h2><p>{zh ? interpretOtherCall(operation, example, rows) : example.explanation_en || 'The request and response from this call are shown above.'}</p></section>
          {isLive && rows.length > 0 && <section className="other-source-record-section"><div className="other-source-record-head"><h2>{zh ? pageObservation ? '逐行看网页内容' : '逐条看返回内容' : pageObservation ? 'Inspect an observed row' : 'Inspect a returned row'}</h2><span>{rows.length} {zh ? '条' : 'rows'}</span></div><select aria-label={zh ? pageObservation ? '选择网页记录' : '选择返回记录' : pageObservation ? 'Select observed row' : 'Select returned row'} value={Math.min(rowIndex, rows.length - 1)} onChange={event => setRowIndex(Number(event.target.value))}>{rows.map((row, index) => <option key={index} value={index}>{otherRowLabel(row, index)}</option>)}</select><pre>{JSON.stringify(selectedRow, null, 2)}</pre><p>{zh ? interpretOtherRow(operationId, selectedRow) : 'The selected row comes from the observation above.'}</p>{operationId === 'kaito.mcp.kaito_events' && selectedRow?.earliestRef?.url?.startsWith('https://') && <p><a href={selectedRow.earliestRef.url} target="_blank" rel="noopener noreferrer">{zh ? '打开本次返回中最早的参考资料 ↗' : 'Open earliest returned reference ↗'}</a></p>}</section>}
        </> : <section className="source-case-interpretation"><h2>{zh ? '尚无实际返回' : 'No observed response'}</h2><p>{zh ? operation.call_status_note_zh || '当前没有保存同一次请求与返回的实测记录。下面只列出已知参数定义。' : operation.call_status_note_en || 'No paired call and response has been saved.'}</p></section>}
        <section className="source-case-inputs" id="other-source-inputs"><div className="source-case-inputs-heading"><div><span className="source-case-kicker">{zh ? '输入参数' : 'Input contract'}</span><h2>{zh ? pageObservation ? `可以设置什么 · ${operation.inputs?.length || 0} 个筛选项` : `可以传什么 · ${operation.inputs?.length || 0} 个参数` : `Available inputs · ${operation.inputs?.length || 0}`}</h2></div><a href="#other-source-case-title">{zh ? '返回案例 ↑' : 'Back to example ↑'}</a></div><p className="source-case-inputs-intro">{zh ? example ? pageObservation ? '下表解释网页筛选项，并标明这次实际设置了什么。筛选项定义不能证明网页始终按预期筛选。' : '下表解释接口允许传入的参数，并标明这次实际传了什么。未传不表示接口不支持；参数定义也不能证明筛选一定按预期生效。' : '下表只有已知的参数定义；当前没有实际调用，因此没有传值或返回可对照。' : 'These are the documented inputs; only values from an observed call are marked as sent.'}</p>
          {operation.inputs?.length ? <div className="source-case-input-list">{operation.inputs.map(input => {
            const sent = Object.prototype.hasOwnProperty.call(example?.request || {}, input.name);
            const observed = cases.filter(item => Object.prototype.hasOwnProperty.call(item.request || {}, input.name));
            return <div className="source-case-input-row" key={input.name}><div className="source-case-input-name"><code>{input.name}</code><strong>{zh ? input.label_zh : input.name}</strong><small>{zh ? input.required ? '必填' : '可省略' : input.required ? 'Required' : 'Optional'}</small></div><div className="source-case-input-details"><p>{zh ? explainOtherInput(operation, input) : input.description_en || input.label_zh}</p>{inputType(operation, input) && <small>{inputType(operation, input)}</small>}{input.default !== undefined && <small>{zh ? '默认／预设：' : 'Default: '}{input.default}</small>}{input.condition_zh && <small>{input.condition_zh}</small>}</div><div className="source-case-input-observation"><span>{zh ? example ? '本次传入' : '调用状态' : example ? 'This call' : 'Call status'}</span><code>{!example ? zh ? '暂无调用' : 'No call' : sent ? display(example.request[input.name]) : zh ? '未传' : 'omitted'}</code><small>{!cases.length ? zh ? '尚无实测调用' : 'No observed call' : zh ? `${cases.length} 组中 ${observed.length} 组已传` : `Sent in ${observed.length} of ${cases.length} calls`}</small>{!sent && observed.length > 0 && <small>{zh ? '其他实测值：' : 'Other observed value: '}{display(observed[0].request[input.name])}</small>}</div></div>;
          })}</div> : <p className="source-case-inputs-intro">{zh ? operation.input_coverage === 'unverified' ? '当前没有可核对的完整参数定义。' : '此接口没有调用参数。' : 'No verified input parameters are listed.'}</p>}</section>
        <div className="source-case-footer"><span>{zh ? '以上是上游调用或网页观察，不证明爬虫已采集。' : 'These upstream observations do not establish crawler collection.'}</span>{operation.documentation_url && <a href={operation.documentation_url} target="_blank" rel="noopener noreferrer">{zh ? '上游说明' : 'Documentation'} <ArrowUpRight size={15} /></a>}</div>
      </>}
    </main>
  </div>;
}
