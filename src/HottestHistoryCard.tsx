import spec from '../catalog/hottest-history.v1.json';
import { BusinessTableRows } from './BusinessTableRows';
import type { GraphNode, Language } from './contracts';

export const hottestHistoryCard = (node: GraphNode) => Boolean((node.card_contract?.config.resource as Record<string, unknown> | undefined)?.hottest_history_key);
export const newHottestHistoryCard = (node: GraphNode) => hottestHistoryCard(node) && spec.cards.some(c => c.name === node.name);

export function HottestHistoryCard({ node, language }: { node: GraphNode; language: Language }) {
  if (!hottestHistoryCard(node)) return null;
  const zh = language === 'zh-CN';
  const card = spec.cards.find(c => c.name === node.name);
  const process = card?.kind === 'process';
  const fields = card?.fields || spec.cards[0]!.fields;
  return <section className="source-case-inspector" aria-label={zh ? '最热榜历史交接' : 'Heat history handoff'}>
    <p className="card-detail-provenance">{zh ? spec.limitations_zh : spec.limitations_en}</p>
    <h3>{zh ? '这一步负责什么' : 'Responsibility'}</h3>
    <p>{card ? zh ? card.description_zh : card.description_en : zh ? '现行评分与前50名保持；最终结果发布到结果通道，当前榜由独立业务消费组更新，历史由独立归档组保存。' : 'Scoring and top-50 membership stay unchanged. Publish final rounds to the result channel; independent business and archive groups update current and historical outputs.'}</p>
    {process && <>
      <h3>{zh ? '输入 → 输出' : 'Input → output'}</h3>
      <p>{card.key === 'query' ? zh ? '按币、时间范围和粒度读取历史 → 时间序列、进榜依据、归档水位与缺口。网站接口由Few绑定。' : 'Read asset history by range and resolution → points, membership evidence, watermark and gaps. Few supplies the website endpoint.' : card.key === 'archive' ? zh ? '完整结果消息 → 不可变历史批次；本卡是统一归档writer中的路由，不是另一个存储服务。' : 'Complete result message → immutable archived round. This card is a route in the shared archive writer, not another storage service.' : zh ? '完整成功轮次 → 原子替换#1009前50名；失败与成功空榜分开。' : 'Complete successful round → atomically replace the existing top-50 board; distinguish unavailable from empty success.'}</p>
    </>}
    {card && !process && <><h3>{zh ? '处理规则' : 'Rules'}</h3><p>{zh ? card.algorithm_zh : card.algorithm_en}</p></>}
    <details className="processing-advanced"><summary>{zh ? '字段与嵌套记录结构' : 'Fields and nested row structure'}</summary>
      <dl className="source-case-inspector-fields">{fields.map(f => <div key={f.name}><dt><code>{f.name}</code></dt><dd>{zh ? f.label_zh : f.label_en} · {f.data_type}</dd></div>)}</dl>
      <h4><code>rows_json[]</code></h4>
      <dl className="source-case-inspector-fields">{spec.row_fields.map(f => <div key={f.name}><dt><code>{f.name}</code></dt><dd>{zh ? f.label_zh : f.label_en} · {f.data_type}</dd></div>)}</dl>
    </details>
    <details className="processing-advanced"><summary>{zh ? '虚构贯通案例 · 非真实记录' : 'Synthetic walkthrough · not observed records'}</summary>
      <BusinessTableRows language={language} table={{ primary_key: ['at'], columns: [
        { name: 'at', label_zh: '观测时间UTC' }, { name: 'score', label_zh: '热度分' }, { name: 'rank', label_zh: '前50名次' },
        { name: 'in_top50', label_zh: '在榜' }, { name: zh ? 'note_zh' : 'note_en', label_zh: zh ? '解释' : 'Explanation' },
      ] }} rows={spec.examples} />
      <p>{zh ? '示例资产A，时间与分数均虚构；覆盖起始已在榜、持续、离榜、重进和失败缺口。它不是IOST的行情或历史。' : 'Fictional asset A and assumed timestamps/scores: initial unknown, continuity, exit, reentry and unavailable gap. This is not IOST data.'}</p>
    </details>
    {card?.key === 'query' && <details className="processing-advanced"><summary>{zh ? '网站请求与返回结构' : 'Website request and response'}</summary>
      <p>{zh ? '实际接口地址由Few实现后填写；以下为数据契约。字段中的_json在HTTP响应中展开为数组或对象。' : 'Few must supply the actual endpoint. Fields ending in _json are arrays or objects in the HTTP response.'}</p>
      <h4>{zh ? '请求' : 'Request'}</h4><pre>{JSON.stringify(spec.query_contract.request, null, 2)}</pre>
      <h4>{zh ? '返回' : 'Response'}</h4><pre>{JSON.stringify(spec.query_contract.response, null, 2)}</pre>
    </details>}
    <p>{zh ? '交给Few：绑定消息注册与两个独立消费组、统一归档存储、保留期与重放、网站只读历史接口。市场平均线口径另定。' : 'Few handoff: bind registry, independent consumer groups, shared archive storage, retention/replay and the read-only website history endpoint. Market baseline is a separate decision.'}</p>
  </section>;
}
