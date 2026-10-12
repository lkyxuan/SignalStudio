import React from 'react';
import spec from '../catalog/coingecko-identity-handoff.v1.json';
import { ProcessingCardFrame } from './ProcessingCardFrame';

export function IdentityHandoffNotes({ node, language }) {
  const key = node.card_contract?.config.resource?.identity_handoff?.key;
  if (!key) return null;
  const zh = language === 'zh-CN';
  return <section className="source-case-inspector-section">
    <h3>{zh ? 'UUID与新资产处理' : 'UUID and asset discovery'}</h3>
    <p>{spec.cards[key].description}</p>
    {['entry', 'assembly', 'channel', 'gate'].includes(key) && <p>{zh ? '有映射就带已有UUID；确认无映射则asset_id=null、identity_status=source_only；查询失败是lookup_error，冲突是conflict。空UUID指标由下游核实，不直接加分。' : 'Reuse an existing UUID. Confirmed missing mapping: asset_id=null and identity_status=source_only. Lookup failure: lookup_error; conflict: conflict. Downstream verifies null-UUID records before scoring.'}</p>}
    {key === 'channel' && <p>{zh ? '消息以observation_id/metric_id标识；不以可空UUID作组装键或消息键。' : 'Identify messages by observation_id/metric_id, never by a nullable UUID.'}</p>}
    <p className="processing-io-case-caption">{zh ? 'SS-79工作台设计；无后台执行结果。CoinGecko起始分值未配置，3009保持待处理，不套用Kaito +100或market_v1 +20。' : 'SS-79 workspace design; no backend execution observed. CoinGecko initial-score configuration remains pending; do not reuse Kaito +100 or market_v1 +20.'}</p>
  </section>;
}

export function IdentityHandoffCard(props) {
  const { node, graph, language } = props;
  const zh = language === 'zh-CN';
  const incoming = new Set(graph.edges.filter(e => e.downstream_id === node.id).map(e => e.id));
  const used = new Set(graph.field_usages.filter(u => incoming.has(u.edge_id)).map(u => u.source_field_id));
  const inputs = graph.fields.filter(f => used.has(f.id));
  const outputs = graph.fields.filter(f => f.node_id === node.id);
  return <ProcessingCardFrame {...props} algorithm={node.formula}>
    <IdentityHandoffNotes node={node} language={language}/>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>{zh ? '输入 · 本步骤使用的字段' : 'Input · fields used by this step'}</h3>
        <dl className="source-case-inspector-fields">{inputs.map(f => <div key={f.id}><dt><code>{f.name}</code></dt><dd>{f.definition || f.data_type}</dd></div>)}</dl>
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出 · 待实现的结构' : 'Output · required schema'}</h3>
        <dl className="source-case-inspector-fields">{outputs.map(f => <div key={f.id}><dt><code>{f.name}</code></dt><dd>{f.definition || f.data_type}</dd></div>)}</dl>
      </section>
    </div>
    <details className="processing-advanced"><summary>{zh ? '其他设置 · 身份规则与假设案例' : 'Other settings · identity rules and hypothetical cases'}</summary>
      {spec.rules.map(rule => <p key={rule}>{rule}</p>)}
      {spec.examples.map(example => <p key={example.label}>{example.label} · <code>{JSON.stringify(example.input)}</code> → {example.result}</p>)}
      <a href={spec.rationale_url} target="_blank" rel="noreferrer">SS-79</a>
    </details>
  </ProcessingCardFrame>;
}
