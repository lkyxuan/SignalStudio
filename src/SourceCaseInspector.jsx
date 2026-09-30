import React, { useEffect, useState } from 'react';
import { Maximize2 } from 'lucide-react';
import { interpretCall, interpretRecord } from './sourceCaseInterpretations';
import './source-case-inspector.css';

const FIELD_NAMES = {
  id: ['内容 ID', 'Content ID'], doc_id: ['文档 ID', 'Document ID'],
  type: ['内容类型', 'Content type'], title: ['标题', 'Title'],
  summary: ['内容摘要', 'Content summary'], source: ['新闻来源', 'News source'],
  author_username: ['作者账号', 'Author handle'], author_name: ['作者名称', 'Author name'],
  author_user_id: ['作者用户 ID', 'Author user ID'],
  engagement: ['互动量', 'Engagement'], smart_engagement: ['智能互动量', 'Smart engagement'],
  sentiment_score: ['情绪分数', 'Sentiment score'],
  created_at: ['发布时间', 'Published at'], url: ['原文链接', 'Original URL'],
  tokens: ['关联代币', 'Related tokens'],
};

function valueText(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function rowLabel(row, index) {
  const subject = row?.author_username ? `@${row.author_username}` : row?.title || row?.source || row?.id || '';
  return `${index + 1} · ${row?.type || '—'} · ${subject}`;
}

export function SourceCaseInspector({ language, purpose, onOpenFull }) {
  const zh = language === 'zh-CN';
  const [cases, setCases] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [caseIndex, setCaseIndex] = useState(0);
  const [rowIndex, setRowIndex] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/source-cases/016', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Unable to load response');
        const data = await response.json();
        setCases(data.cases || []);
      })
      .catch(reason => { if (reason.name !== 'AbortError') setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);

  const example = cases[caseIndex];
  const requestFields = Object.entries(example?.request || {});
  const rows = Array.isArray(example?.response?.results) ? example.response.results : [];
  const row = rows[rowIndex];

  if (loading) return <p className="source-case-inspector-status">{zh ? '正在读取调用记录…' : 'Loading calls…'}</p>;
  if (error || !cases.length) return <div className="source-case-inspector" role="status"><section className="source-case-inspector-section"><h3>{zh ? '输入' : 'Input'}</h3><p className="source-case-inspector-status">{zh ? '本机暂无完整调用参数。' : 'No complete local request is available.'}</p></section><section className="source-case-inspector-section"><h3>{zh ? '输出' : 'Output'}</h3><p className="source-case-inspector-status">{zh ? '本机暂无完整调用返回。' : 'No complete local response is available.'}</p></section><section className="source-case-inspector-explanation source-case-inspector-purpose"><h3>{zh ? '这张爬虫卡做什么' : 'What this source does'}</h3><p>{purpose}</p><h3>{zh ? '这次查到了什么' : 'What this call found'}</h3><p>{zh ? '尚无保存的完整调用案例。' : 'No complete call case has been saved.'}</p><h3>{zh ? '所选记录怎么读' : 'How to read the selected record'}</h3><p>{zh ? '尚无返回记录可解读。' : 'There is no returned record to interpret.'}</p></section></div>;

  return <div className="source-case-inspector">
    <label className="source-case-inspector-picker">{zh ? '调用案例' : 'Call'}
      <select value={caseIndex} onChange={event => { setCaseIndex(Number(event.target.value)); setRowIndex(0); }} aria-label={zh ? '选择调用案例' : 'Select call'}>
        {cases.map((item, index) => <option key={index} value={index}>{index + 1} · {zh ? item.case_label_zh : item.case_label_en || item.case_label_zh}</option>)}
      </select>
    </label>
    <section className="source-case-inspector-section">
      <h3>{zh ? '输入' : 'Input'}</h3>
      {requestFields.length ? <dl className="source-case-inspector-fields">{requestFields.map(([key, value], index) => <div key={key}><dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span><code>{key}</code></dt><dd>{valueText(value)}</dd></div>)}</dl>
        : <p className="source-case-inspector-status">{zh ? '本次未传参数' : 'No parameters sent'}</p>}
    </section>
    <section className="source-case-inspector-section">
      <div className="source-case-inspector-heading"><h3>{zh ? '输出' : 'Output'}</h3><span>{zh ? `${rows.length} 条` : `${rows.length} rows`}</span></div>
      <select className="source-case-inspector-row-picker" value={rowIndex} onChange={event => setRowIndex(Number(event.target.value))} aria-label={zh ? '选择返回记录' : 'Select result row'}>
        {rows.map((item, index) => <option key={`${item.id || index}-${index}`} value={index}>{rowLabel(item, index)}</option>)}
      </select>
      {row && <dl className="source-case-inspector-fields">{Object.entries(row).map(([key, value], index) => <div key={key}><dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span>{(FIELD_NAMES[key] || [key, key])[zh ? 0 : 1]} <code>{key}</code></dt><dd>{key === 'url' && typeof value === 'string' && /^https:\/\//.test(value) ? <a href={value} target="_blank" rel="noopener noreferrer">{value}</a> : valueText(value)}</dd></div>)}</dl>}
    </section>
    <section className="source-case-inspector-explanation source-case-inspector-purpose"><h3>{zh ? '这张爬虫卡做什么' : 'What this source does'}</h3><p>{purpose}</p><h3>{zh ? '这次查到了什么' : 'What this call found'}</h3><p>{interpretCall(example, caseIndex, language)}</p>{row && <><h3>{zh ? '这条内容说了什么，怎么用' : 'What this record says and how to use it'}</h3><p>{interpretRecord(row, language)}</p></>}</section>
    <button type="button" className="source-case-inspector-open" onClick={() => onOpenFull(caseIndex)}><Maximize2 size={14} />{zh ? '查看这次调用的完整 JSON' : 'View full call JSON'}</button>
  </div>;
}
