import React from 'react';
import './source-field-card.css';

const compactValue = value => JSON.stringify(value);

export function SourceFieldCard({ name, path, purpose, useCase, exampleValue,
  exampleLabel, exampleStatus, exampleUrl, observed = false, showNullValue = false, language }) {
  const zh = language === 'zh-CN';
  const say = (cn, en) => zh ? cn : en;
  const hasValue = exampleValue !== undefined && (exampleValue !== null || showNullValue);
  const value = hasValue ? compactValue(exampleValue) : observed
    ? say('字段已返回，具体值未保留', 'Field returned; value not retained')
    : exampleStatus === 'unavailable' ? say('暂无已核实值', 'No verified value') : say('暂无案例值', 'No example value');
  const guidance = useCase || purpose || say('用途待核实', 'Usage needs review');
  const provenance = !observed && hasValue && exampleLabel ? ` · ${exampleLabel}` : '';
  return <article className="source-field-card" title={`${path}${purpose ? ` · ${purpose}` : ''}`}>
    <div className="source-field-line"><span>{say('名称', 'Name')}</span>
      {exampleUrl ? <a href={exampleUrl} target="_blank" rel="noopener noreferrer">{name}</a> : <strong>{name}</strong>}</div>
    <div className="source-field-line"><span>{say('具体数据', 'Data')}</span><code title={`${value}${provenance}`}>{value}{provenance && <em>{provenance}</em>}</code></div>
    <div className="source-field-line"><span>{say('怎么用', 'Use')}</span><p title={guidance}>{guidance}</p></div>
  </article>;
}
