import React, { useState } from 'react';
import catalog from '../catalog/coingecko-trending-contribution.v1.json';
import collectionPlans from '../catalog/source-collection-plans.v1.json';
import { ProcessingCardFrame } from './ProcessingCardFrame';
import { previewTrending, previewDecayedSum, trendingCases } from './coingeckoTrendingDesign';

export const isCoinGeckoTrending = name => name === catalog.node.name;

function Rows({ record }) {
  return <dl className="source-case-inspector-fields">{Object.entries(record).map(([name, value], index) =>
    <div key={name}><dt><span className="source-case-field-number">{String(index + 1).padStart(2, '0')}</span><code>{name}</code></dt>
      <dd>{value === null ? '—' : String(value)}</dd></div>)}</dl>;
}

const explanations = {
  accepted: '已得到可交付的评分决定。先持久保存完整判定，再交给评分提交步骤；本页只演算，不实际入账。',
  retry: '复用同轮已保存的决定，新增0分；发布重试继续使用原事件键及首次入账时间。',
  not_listed: '成功快照中没有此币，本轮不新增贡献；已有贡献继续自然衰减。',
  source_failed: '本轮来源失败，不新增贡献。已有分继续衰减，但不能把断采当作真实降温。',
  identity_pending: '身份未唯一确认，保存待处理依据；不按ticker猜测、不自动建档、不提交分数。',
  invalid_or_late: '快照跨过原采集槽才到达，只保存采集证据；不补发漏采轮的奖励。',
};

export function CoinGeckoTrendingCard(props) {
  const [selected, setSelected] = useState(0);
  const sample = trendingCases[selected];
  const result = previewTrending(sample.input, sample.accepted);
  const links = names => names.map(name => props.graph.nodes.find(item => item.name === name)).filter(Boolean).map(node =>
    <button key={node.id} onClick={() => props.openNode(node.id)}>#{node.reference_number} {node.name}</button>);
  const interval = collectionPlans.plans[catalog.source].interval_minutes;
  const events = [0, 30, 60, 90].map(minutes => ({ score_delta: 10, half_life_minutes: 30,
    created_at: new Date(Date.parse('2026-10-10T00:00:05Z') + minutes * 60_000).toISOString() }));
  return <ProcessingCardFrame {...props} algorithm={props.node.formula || catalog.node.formula}>
    <label>假设案例<select aria-label="CoinGecko评分案例" value={selected} onChange={event => setSelected(Number(event.target.value))}>
      {trendingCases.map((item, index) => <option value={index} key={item.label}>{item.label}</option>)}</select></label>
    <div className="source-case-inspector processing-io-case">
      <section className="source-case-inspector-section"><h3>输入 · 本规则使用的字段</h3>
        <div className="processing-input-source-heading processing-source-links">{links([catalog.source, 'asset_identifiers', 'assets'])}</div>
        <Rows record={sample.input} />
        <p className="processing-io-case-caption">coin_id和名次来自coins[].item；其余为采集元数据、身份映射和本案例状态，不是API原生字段。</p>
      </section>
      <section className="source-case-inspector-section"><h3>输出 · 假设演算</h3>
        <div className="processing-input-source-heading processing-source-links">{links([catalog.downstream])}</div>
        <Rows record={result.decision || { status: result.status, new_score_delta: result.added }} />
        <p className="processing-io-case-caption">{explanations[result.status]}</p>
        {result.status === 'retry' && <p>新增贡献：0；右侧保留原决定供发布恢复，不再生成第二笔。</p>}
        <p className="processing-io-case-caption">七项决定交给发布步骤；event_key和created_at由该步骤首次接受时生成，本卡不填造。</p>
      </section>
    </div>
    <section className="processing-goal-readonly"><h3>给最热榜增加什么</h3>
      <p>{props.node.definition || catalog.node.definition}</p><p>{catalog.source_meaning_zh}</p>
      <p>前15名等额加10分，0基名次只保留追溯。自有榜单最多显示50个有数据的资产，单轮来源15个；不为填满榜单补币。</p>
      <h3>运行触发与时间</h3>
      <p>采集计划每{interval}分钟一次，UTC整点/半点划槽；收到本槽首次有效成功快照后逐币判定。同槽重试复用，下一槽可以再加；不补发漏采奖励。单笔半衰期30分钟，既有汇总每60秒刷新是另一设置，即时触发仍以既有实现状态为准。</p>
      <h3>连续上榜时的来源贡献</h3>
      <Rows record={Object.fromEntries(events.map((event, index) => [`第${index + 1}轮加分后`, previewDecayedSum(events.slice(0, index + 1), event.created_at).toFixed(2)]))} />
      <p>假设每轮准时入账，从零开始：持续上榜时加分后趋近20、下次加分前趋近10。最后一次入账后停止上榜，上例18.75分在30分钟后为9.375；离榜不产生扣分事件。</p>
      <p>只展示本来源的贡献。总分还会叠加其他规则：原建档+100、7天半衰期保留，各笔分别衰减后相加，不能对合计分统一减半。</p>
      <h3>后台如何解释这笔分</h3>
      <p>decision_ref应能查到规则版本、原始快照、采集轮次/时间、coin ID、来源名次、身份映射证据和加分原因。后台可按总分→规则小计→逐笔贡献→判定依据追溯；本次只定义契约，实际查询服务和界面仍由Fewunderstand实现。</p>
      <h3>真实执行证据</h3><p>{catalog.runtime_status_zh}</p><p>本规则已接受事件：未取得。真实运行结果：未取得。</p>
    </section>
    <details className="processing-advanced"><summary>其他设置 · 完整判定与执行边界</summary>
      <Rows record={catalog.rule} />
      <p>详细判定字段：{catalog.decision_record_fields.join('、')}</p>
      <p>原始快照及详细判定的存储、解析API、套餐鉴权、运行调度与验收须在Fewunderstand接入时落实。最热榜沿用现有total_heat排序和同分规则。</p>
      <a href={catalog.rationale_url} target="_blank" rel="noreferrer">查看已批准的Notion卡片</a>
    </details>
  </ProcessingCardFrame>;
}
