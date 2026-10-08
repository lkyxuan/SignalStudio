import React from 'react';
import catalog from '../catalog/coingecko-implemented-signals.v1.json';
import { ProcessingCardFrame } from './ProcessingCardFrame';

export const isCoinGeckoReference = name => [...catalog.cards, ...catalog.topics].some(item => item.name === name);

function Rows({ record }) {
  return <dl className="source-case-inspector-fields">{Object.entries(record).map(([name, value], index) => <div key={name}>
    <dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span><code>{name}</code></dt>
    <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
  </div>)}</dl>;
}

export function CoinGeckoReferenceCard(props) {
  const { node, graph, openNode } = props;
  const card = catalog.cards.find(item => item.name === node.name);
  const topic = catalog.topics.find(item => item.name === node.name);
  const links = names => names.map(name => graph.nodes.find(item => item.name === name)).filter(Boolean).map(item =>
    <button key={item.id} onClick={() => openNode(item.id)}>#{item.reference_number} {item.name}</button>);
  const evidence = <><p className="processing-io-case-caption">{catalog.evidence_note}</p>
    <details className="processing-advanced"><summary>其他设置 · 代码依据与待讨论问题</summary>
      <p><code>fewunderstand@{catalog.source_revision}</code> · {catalog.reviewed_at}</p>
      <p><code>catalog/coingecko-implemented-signals.v1.json</code></p>
      {catalog.source_paths.map(path => <p key={path}><code>{path}</code></p>)}
      <ul>{catalog.shared_notes.map(note => <li key={note}>{note}</li>)}</ul>
    </details></>;
  if (topic) return <div className="redpanda-topic-card">
    <h3>Redpanda 数据通道 · 现有实现参考</h3>
    <Rows record={{ topic: topic.topic, schema: topic.schema, consumer_group: topic.consumer_group,
      message_key: '本轮未核验', headers: topic.headers || '本轮未核验', retention: '本轮未核验' }} />
    <h3>记录字段 · 代码定义</h3><Rows record={Object.fromEntries(topic.fields.map(name => [name, '代码字段，非实际消息值']))} />
    <p>{topic.definition}</p><p>{topic.notes}</p>
    <div className="processing-input-source-heading processing-source-links">{links(topic === catalog.topics[0] ? ['coingecko.coins_markets'] : catalog.cards.map(item => item.name))}</div>
    {evidence}
  </div>;
  return <ProcessingCardFrame {...props} algorithm={card.algorithm}>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>输入 · 假设案例</h3>
        <div className="processing-input-source-heading processing-source-links">{links([catalog.topics[0].name])}</div>
        <p className="processing-io-case-caption">仅列本规则使用的指标、身份和时间；身份/建档状态来自前置处理，不是 CoinGecko API 原生字段。</p>
        <Rows record={card.input} />
      </section>
      <section className="source-case-inspector-section"><h3>输出 · 按代码演算</h3>
        <div className="processing-input-source-heading processing-source-links">{links([catalog.topics[1].name])}</div>
        <Rows record={card.output} />
        <p className="processing-io-case-caption">此处聚焦判定结果；完整输出字段、展示文案与 schema 说明见输出 Topic 卡片。资产 ID 为示例占位，未实际建档。</p>
      </section>
    </div>
    <section className="processing-goal-readonly"><h3>信号条件</h3><p>{card.condition}</p>
      <h3>不触发案例</h3><Rows record={card.negative_input} /><p>其余输入沿用上例。{card.negative_result}</p>
      <h3>运行触发</h3><p>收到行情消息后批处理；行情规则先经过身份路由。当前卡片只还原实现，没有批准新阈值或部署。</p>
      <h3>强度值如何得到</h3><p>{card.confidence_formula}</p>
    </section>
    {evidence}
  </ProcessingCardFrame>;
}
