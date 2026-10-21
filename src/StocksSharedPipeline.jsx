import React from 'react';
import spec from '../catalog/stocks-shared-pipeline.v1.json';
import { nodeRef } from './graphRefs';
import './stocks-design.css';

// A reading aid on existing cards, not another processor or runtime binding.
export function StocksSharedPipeline({ node, graph, language, openNode }) {
  const zh = language === 'zh-CN';
  if (!spec.steps.some(step => step.name === node.name) && node.name !== 'coingecko.stocks.metrics') return null;
  const text = (a, b) => zh ? a : b;
  const example = spec.example;
  const input = ['source_object_id', 'current_price', 'total_volume', 'market_cap', 'price_change_percentage_24h'];
  const output = ['price_change_percentage_24h', 'volume_to_market_cap'];
  const fields = (keys) => <ol className="stocks-pipeline-fields">{keys.map(key => <li key={key}><code>{key}</code><strong>{String(example[key])}</strong></li>)}</ol>;
  return <section className="stocks-shared-pipeline" aria-label={text('Stocks 共用链路', 'Stocks shared pipeline')}>
    <h3>{text('Stocks 如何接入现有系统', 'How Stocks joins the existing system')}</h3>
    <p className="card-detail-provenance">{text('设计展示 · 以下共用卡片是同一逻辑对象；没有新增运行程序。', 'Design only · shared cards retain one logical identity; no new runtime program.')}</p>
    <ol className="stocks-pipeline-steps">{spec.steps.map((step, index) => {
      const target = graph.nodes.find(item => item.name === step.name);
      return <li key={step.name} aria-current={step.name === node.name ? 'step' : undefined}>
        {target ? <button type="button" onClick={() => openNode(target.id)}>{nodeRef(target)} {step[zh ? 'label_zh' : 'label_en']}</button> : <strong>{step[zh ? 'label_zh' : 'label_en']}</strong>}
        <p>{step[zh ? 'role_zh' : 'role_en']}</p>
      </li>;
    })}</ol>
    <h4>{text('同一轮启动，分别确认完成', 'Start one round, verify each task separately')}</h4>
    <p>{spec.round_design[zh ? 'rule_zh' : 'rule_en']}</p>
    <p>{spec.round_design[zh ? 'cadence_zh' : 'cadence_en']}</p>
    <div className="stocks-pipeline-io">
      <section><h4>{text('输入 · 假设行情', 'Input · hypothetical market observation')}</h4>{fields(input)}</section>
      <section><h4>{text('输出 · 由上述数值推导的指标', 'Output · metrics derived from those inputs')}</h4>{fields(output)}<p>{text('12% ≥ 10%，满足“大涨”条件。身份及其他准入检查通过后才可产生资产级信号。', '12% ≥ 10% meets the price-rise condition. Asset-level signals still require valid identity and eligibility.')}</p></section>
    </div>
    <p>{text('假设案例，不是真实采集或已发送消息。成交额市值比 = 3,000,000 ÷ 10,000,000 = 0.3；24h涨幅直接沿用来源字段。', 'Hypothetical case, not a collected record or emitted message. Turnover = 3,000,000 / 10,000,000 = 0.3; 24h price change is copied from the source.')}</p>
    <h4>{text('共用计算，范围仍能区分', 'Shared computation, distinguishable scopes')}</h4>
    <p>{text('Stocks 成员资格决定哪些对象属于股票板块；任务、轮次和覆盖记录说明这批数据从哪里来。它们的物理保存方式待 Few 核验。相同 Topic 或 Header 不会自动合并候选池。', 'Stocks membership determines the stock view; task, round and coverage identify the collected batch. Their physical storage awaits Few verification. Sharing a Topic or Header does not automatically merge candidate pools.')}</p>
    <p>{text('固定阈值策略可共用；最热榜等相对排名要先选定候选池再计算。Stocks 榜不能从总榜 Top N 事后筛选得到。本批不改变原 Crypto 榜单。', 'Fixed-threshold strategies can be shared. Relative rankings first select a cohort, then calculate. A Stocks board cannot be obtained by filtering an overall Top N. This batch does not change the Crypto boards.')}</p>
    {node.kind === 'channel' && <>
      <h4>{text('这个 Topic 的 Headers 怎么用', 'Headers on this Topic')}</h4>
      {node.name === spec.steps[1].name ? <><p><code>source=coingecko · type=market · category=spot</code></p><p>{text('这是已有行情链的代码参考，部署未复核。同一接口、结构及消息含义可复用兼容路由；不为 Stocks 展示随意改成 source=stocks。', 'Existing market-chain code reference, not deployment verification. The same interface, structure and semantics can reuse compatible routing; a Stocks view does not require source=stocks.')}</p></>
        : <p>{text('复用兼容的指标注册项。精确 source/type/category 取值尚未核验，不在此编造；指标版本仍按各消费者合同校验。', 'Reuse a compatible indicator registry entry. Exact source/type/category values remain unverified; validate the metric version required by each consumer.')}</p>}
    </>}
    <p className="card-detail-provenance">{spec[zh ? 'limits_zh' : 'limits_en']}</p>
    <details><summary>{text('设计依据', 'Design reference')}</summary><a href={spec.rationale_url} target="_blank" rel="noreferrer">SS-138</a></details>
  </section>;
}
