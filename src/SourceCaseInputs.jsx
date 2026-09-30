import React from 'react';
import inputSchemas from '../catalog/kaito-mcp-input-schemas.json';
import { INPUT_EXPLANATIONS_ZH, INPUT_GROUPS } from './sourceCaseInputGuide';

const schema = inputSchemas.tools.find(tool => tool.name === 'kaito_advanced_search')?.inputSchema;

function formatValue(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function formatType(property, zh) {
  const type = { string: zh ? '文本' : 'string', number: zh ? '数字' : 'number',
    integer: zh ? '整数' : 'integer', boolean: zh ? '布尔值' : 'boolean' }[property?.type] || property?.type || '—';
  const details = [];
  if (property?.enum) details.push(property.enum.join(' / '));
  if (property?.minimum != null || property?.maximum != null) details.push(`${property.minimum ?? '−∞'}–${property.maximum ?? '∞'}`);
  if (property?.minLength != null || property?.maxLength != null) details.push(`${property.minLength ?? 0}–${property.maxLength ?? '∞'} ${zh ? '字符' : 'chars'}`);
  return [type, ...details].join(' · ');
}

export function SourceCaseInputs({ operation, cases, example, language }) {
  if (!schema) return null;
  const zh = language === 'zh-CN';
  const byName = new Map((operation.inputs || []).map(input => [input.name, input]));
  const properties = schema.properties || {};
  const names = Object.keys(properties);
  const observed = name => cases.filter(item => Object.hasOwn(item.request || {}, name));
  return <section className="source-case-inputs" id="source-case-inputs">
    <div className="source-case-inputs-heading">
      <div><span className="source-case-kicker">{zh ? '完整输入契约' : 'Complete input contract'}</span><h2>{zh ? `可以传什么 · ${names.length} 个参数` : `Available inputs · ${names.length} parameters`}</h2></div>
      <a href="#source-case-title">{zh ? '返回案例 ↑' : 'Back to examples ↑'}</a>
    </div>
    <p className="source-case-inputs-intro">{zh
      ? `以下来自 Kaito 在线 MCP tools/list 的 inputSchema，${names.length} 个参数均未标为必填。上面的 ${cases.length} 组是实际发送并保存了返回的调用；表中的“本次未传”不等于 API 不支持。参数可组合使用，但未调用的组合还没有实际返回可展示。`
      : `These ${names.length} optional inputs come from Kaito's MCP tools/list inputSchema. The ${cases.length} calls above are observed examples; an omitted input remains available, but untried combinations have no observed response here.`}</p>
    {INPUT_GROUPS.map(group => <section className="source-case-input-group" key={group.title}>
      <h3>{zh ? group.title : group.title_en}</h3>
      <div className="source-case-input-list">{group.names.filter(name => properties[name]).map(name => {
        const input = byName.get(name);
        const used = observed(name);
        const sent = Object.hasOwn(example?.request || {}, name);
        return <div className="source-case-input-row" key={name}>
          <div className="source-case-input-name"><code>{name}</code><strong>{zh ? input?.label_zh || name : name}</strong></div>
          <div className="source-case-input-details"><p>{zh ? INPUT_EXPLANATIONS_ZH[name] || input?.description_en : input?.description_en || properties[name].description}</p><small>{formatType(properties[name], zh)}</small></div>
          <div className="source-case-input-observation"><span>{zh ? '本次发送' : 'This call'}</span><code>{sent ? formatValue(example.request[name]) : zh ? '未传' : 'omitted'}</code><small>{zh ? `${cases.length} 组中 ${used.length} 组已传` : `Sent in ${used.length} of ${cases.length} calls`}</small>{!sent && used.length > 0 && <small>{zh ? '其他实测值' : 'Other observed value'}：{formatValue(used[0].request[name])}</small>}</div>
        </div>;
      })}</div>
    </section>)}
  </section>;
}
