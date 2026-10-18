import React from 'react';
import spec from '../catalog/dynamic-weights.v1.json';

export function DynamicWeightsNotes({ name, language }) {
  const card = spec.cards.find(item => item.name === name);
  if (!card) return null;
  const zh = language === 'zh-CN';
  const example = spec.examples[0];
  const rules = zh ? card.rules_zh : card.rules_en;
  return <section data-weight-design={name}>
    <p>{zh ? card.description_zh : card.description_en}</p>
    <h3>{zh ? '身份与权重的贯通案例' : 'Identity and weight example'}</h3>
    <p>{zh ? example.note_zh : example.note_en}</p>
    <div className="business-table-schema-scroll"><table>
      <thead><tr><th>{zh ? '对象' : 'Object'}</th><th>assets.asset_id</th><th>{zh ? '话题' : 'Topic'}</th><th>{zh ? '示例系数' : 'Example coefficient'}</th></tr></thead>
      <tbody>
        <tr><td>{zh ? '示例项目 P' : 'Example project P'}</td><td><code>{example.project_asset_id}</code></td><td>—</td><td>—</td></tr>
        {example.accounts.map((account, i) => <tr key={account.asset_id}><td>{zh ? account.name : `Example project P account ${i + 1}`}</td><td><code>{account.asset_id}</code></td><td>{account.topic}</td><td>{account.coefficient}</td></tr>)}
      </tbody>
    </table></div>
    <p>{zh ? '查账号权重直接使用账号 UUID，不必先找项目；消息谈论的目标项目另行判断。' : 'Look up an account directly by its UUID; message target assignment is a separate decision.'}</p>
    <h3>{zh ? '本表规则' : 'Table rules'}</h3>
    <ul>{rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
    <details><summary>{zh ? '批量读取与版本使用' : 'Batch lookup and version handling'}</summary>
      <ul>{(zh ? spec.performance_zh : spec.performance_en).map(rule => <li key={rule}>{rule}</li>)}</ul>
    </details>
    <p>{(zh ? spec.unknowns_zh : spec.unknowns_en).join(' ')}</p>
  </section>;
}
