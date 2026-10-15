import React from 'react';
import spec from '../catalog/worth-reading-translation.v1.json';
const path = 'catalog/worth-reading-translation.v1.json';
export function translationCard(node) {
  const key = node.card_contract?.config.resource?.translation_key;
  return node.card_contract?.config.definition_refs?.some(ref => ref.path === path)
    ? spec.cards.find(card => card.key === key && card.name === node.name) : undefined;
}
export function WorthReadingTranslationCard({node, graph, language}) {
  const card = translationCard(node);
  if (!card) return null;
  const zh = language === 'zh-CN';
  const ref = spec.implementation_reference;
  return <section className="card-detail-translation" data-translation-key={card.key}>
    <p className="card-detail-provenance">{zh ? '代码映射 · 测试网验证为 Fewunderstand 回报 · Studio 未独立复验' : 'Code mapping · testnet verification reported by Fewunderstand · not revalidated by Studio'}</p>
    <h3>{zh ? card.name : card.name_en}</h3>
    <p>{zh ? card.description_zh : card.description_en}</p>
    <h3>{zh ? '处理与显示规则' : 'Processing and display rules'}</h3>
    <p>{zh ? card.rule_zh : card.rule_en}</p>
    {card.kind === 'process' && <section><h3>{zh ? '使用的输入与对应输出' : 'Used inputs and corresponding outputs'}</h3>
      {['input','output'].map(direction => {
        const edges = graph.edges.filter(edge => direction === 'input' ? edge.downstream_id === node.id : edge.upstream_id === node.id);
        return <div key={direction}><h4>{direction === 'input' ? (zh ? '输入来源' : 'Input sources') : (zh ? '输出去向' : 'Output destinations')}</h4>
          {edges.map(edge => {
            const other = graph.nodes.find(n => n.id === (direction === 'input' ? edge.upstream_id : edge.downstream_id));
            const used = graph.field_usages.filter(u => u.edge_id === edge.id).map(u => graph.fields.find(f => f.id === u.source_field_id)?.name).filter(Boolean);
            return <p key={edge.id}>{other?.name} · <code>{used.length ? used.join(', ') : (zh ? '额度/依赖引用，非消息传输' : 'Budget/dependency reference, not a message')}</code></p>;
          })}
        </div>;
      })}
      <p>{zh ? '列出的字段是固定代码使用的子集，不是本次执行的输入/输出记录。译文写入字段见 content.translations.text；摘要与正文独立保存状态。' : 'Fields are a subset used by the fixed code, not execution input/output records. Translation output is content.translations.text; summary and body states are independent.'}</p>
    </section>}
    <h3>{zh ? '字段定义 · 非在线记录' : 'Declared fields · not live records'}</h3>
    <div style={{overflowX:'auto'}}><table><thead><tr><th>{zh ? '字段' : 'Field'}</th><th>{zh ? '类型' : 'Type'}</th><th>{zh ? '用途' : 'Meaning'}</th></tr></thead><tbody>{card.fields.map(f => <tr key={f.name}><td><code>{f.name}</code></td><td>{f.data_type}</td><td>{zh ? f.label_zh : f.label_en}</td></tr>)}</tbody></table></div>
    <h3>{zh ? '代码依据与限制' : 'Code references and limits'}</h3>
    <p><a href={`https://github.com/${ref.repository}/tree/${ref.commit}/consumer/content_translator`} target="_blank" rel="noreferrer">Fewunderstand · {ref.commit.slice(0,7)}</a></p>
    <p>{zh ? '摘要翻译、正文翻译和同步属于同一服务；图卡不是三个独立定时任务。翻译器不读写 Redpanda，不因打开详情调用模型。生产、长期稳定性和供应商额度未核验。' : 'Summary translation, body translation and projection belong to one service, not three scheduled jobs. The translator does not use Redpanda; opening details never calls a model. Production, sustained health and provider quota remain unverified.'}</p>
    <details className="processing-advanced"><summary>{zh ? '配置与契约引用' : 'Configuration and contract references'}</summary><pre>{JSON.stringify({service:spec.service, references:ref.paths},null,2)}</pre></details>
  </section>;
}
