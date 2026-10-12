import React from 'react';
import spec from '../catalog/polars-indicator-module.v1.json';
import { ProcessingCardFrame } from './ProcessingCardFrame';
import { nodeRef } from './graphRefs';

const resource = node => node.card_contract?.config.resource || {};
export const isPolarsModuleCard = node => node.card_contract?.config.definition_refs?.some(ref => ref.path === 'catalog/polars-indicator-module.v1.json') && Boolean(resource(node).parent_module || resource(node).module_children || resource(node).publisher_module_id);

export function PolarsIndicatorDependency({ node, language }) {
  const dependency = resource(node).indicator_dependency;
  if (!dependency) return null;
  const zh = language === 'zh-CN';
  return <section className="source-case-inspector-section">
    <h3>{zh ? '从5007实际读取哪些字段' : 'Fields actually read from 5007'}</h3>
    <p>{dependency.purpose}</p>
    <p>{zh ? '业务使用的量价指标：' : 'Business market metrics: '}{dependency.metric_fields.length ? dependency.metric_fields.map(name => <code key={name}>{name} </code>) : zh ? '无；此节点的排序或发现判断使用其他输入。' : 'None; ranking or discovery decisions use other inputs.'}</p>
    <details><summary>{zh ? '校验、准入与追溯字段' : 'Validation, admission and lineage fields'}</summary>
      <p>{dependency.validation_fields.map(name => <code key={name}>{name} </code>)}</p>
      <p>{zh ? '这些字段保留现行检查要求，不表示都参与评分或排序。' : 'These preserve existing validation requirements; they are not all scoring or ranking factors.'}</p>
    </details>
  </section>;
}

export function PolarsModuleCard({ node, graph, openNode, language }) {
  const zh = language === 'zh-CN';
  const settings = resource(node);
  const link = (id, fallback) => {
    const target = graph.nodes.find(n => n.id === id);
    return target ? <button type="button" onClick={() => openNode(target.id)}>{nodeRef(target)} {target.name}</button> : <span>{fallback || (zh ? '归属卡缺失，需核对' : 'Owning card missing; verify')}</span>;
  };
  const child = spec.cards.find(c => c.key === settings.design_key && settings.parent_module);
  const producers = settings.field_producers || {};
  return <ProcessingCardFrame node={node} graph={graph} openNode={openNode} language={language}>
    <p className="card-detail-provenance">{zh ? '已确认的工作台定义 · 后台实现、运行与性能未核验' : 'Approved workspace definition · backend execution and performance unverified'}</p>
    {child ? <>
      <section className="source-case-inspector-section"><h3>{zh ? '所属模块' : 'Owning module'}</h3>
        {link(settings.parent_module.node_id)}
        <p>{zh ? '独立编号代表模块内一项职责；由同一Polars程序共享输入后执行，不独立消费或发布消息。' : 'This unique number identifies one responsibility within the module. Execution shares the same Polars program and inputs, with no independent consumer or publisher.'}</p>
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输入 · 模块已取得的共享数据' : 'Input · shared data loaded by the module'}</h3>
        <p>{child.input_fields.map(name => <code key={name}>{name} </code>)}</p>
        <p>{child.context_note}</p>
        <dl className="source-case-inspector-fields">{Object.entries(child.input_origins).map(([name, origin]) => <div key={name}><dt><code>{name}</code></dt><dd>{origin}</dd></div>)}</dl>
        {child.history && <><h4>{zh ? '历史依赖' : 'History dependency'}</h4><p><code>{child.history.source}</code> · {child.history.target}</p><p>{child.history.selection}</p></>}
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '输出' : 'Output'}</h3><p><code>{child.output}</code> · {child.unit}</p>
        <p>{child.shared_context_fields.map(name => <code key={name}>{name} </code>)}</p>
        {child.history && <p>{child.history.output_fields.map(name => <code key={name}>{name} </code>)}</p>}
        <p>{zh ? '交给所属模块统一组装，再发布完整指标消息到5007。' : 'Return to the owning module for assembly and publication of one complete message to 5007.'}</p>
        <h4>{zh ? '业务公式与缺失处理' : 'Business formula and missing values'}</h4><p>{child.formula}</p><p>{child.missing}</p>
        <p>{zh ? '假设案例，非真实运行：' : 'Hypothetical example, not an observed run: '}<code>{JSON.stringify(child.example.input)}</code> → <code>{String(child.example.output)}</code></p>
      </section>
      <details className="processing-advanced"><summary>{zh ? 'Polars计算方式 · 实现参考' : 'Polars expression · implementation reference'}</summary>
        <p>{zh ? '前置条件：共享校验已将非数值、布尔及非有限来源值归一为Float64 null；历史基线已按原规则选择。此处不执行代码，也不证明性能。' : 'Precondition: shared validation normalizes nonnumeric, boolean and nonfinite source values to Float64 null; the history baseline is already selected under the existing rules. This is not executed here and proves no performance claim.'}</p>
        <pre>{child.polars_expression}</pre>
        <p>{zh ? '条件表达式不作为分支短路保证；各分支必须可独立执行。优化须保持业务口径并单独验证结果与性能。' : 'Conditions do not guarantee short-circuit execution; every branch must be independently valid. Optimizations must preserve semantics and separately verify results and performance.'}</p>
      </details>
    </> : settings.module_children ? <>
      <section className="source-case-inspector-section"><h3>{zh ? `模块内的${settings.module_children.length}项指标职责` : `${settings.module_children.length} indicator responsibilities in this module`}</h3>
        <p>{zh ? '3035是模块总览及统一发布方；下面各卡的编号全局唯一，所属模块由稳定ID关联，不由编号是否连续判断。' : '3035 owns the module overview and publication. Child numbers are globally unique; ownership uses stable IDs, not consecutive numbers.'}</p>
        {settings.module_children.map(c => <div className="processing-input-source" key={c.node_id}>{link(c.node_id)}<p><code>{c.output_field}</code></p></div>)}
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '共享处理与统一发布' : 'Shared processing and publication'}</h3>
        <p>{zh ? '统一取得行情、内存身份映射和所需历史，检查身份、USD、时间与质量；每项只负责自己的指标。当前价格、市值、24h成交额与追溯信息作为公共字段保留。' : 'Load market data, in-memory identity mappings and required history once; validate identity, USD, time and quality. Each child owns its metric. Price, market cap, 24h volume and lineage remain shared fields.'}</p>
        <p>{zh ? '按同一observation_id组装完整market_indicators_v1，沿用冻结与重试规则，仅由本模块发布到5007；子卡结果线是程序内部数据依赖。' : 'Assemble a complete market_indicators_v1 for the same observation_id under existing freeze and retry rules. Only this module publishes to 5007; child result edges are in-program dependencies.'}</p>
      </section>
    </> : <>
      <section className="source-case-inspector-section"><h3>{zh ? '消息字段的生产责任' : 'Message field producers'}</h3>
        <p>{zh ? '完整消息统一来自' : 'Complete messages are published by '}{link(settings.publisher_module_id)}</p>
        {Object.entries(producers).map(([name, producer]) => <div className="processing-input-source" key={name}><code>{name}</code> → {link(producer.node_id)}</div>)}
        <p>{zh ? '其余行情原值、身份、时间、质量与追溯字段由3035共享处理保留或生成。五张子卡不会各发一条不完整消息。' : 'Other market values, identity, timestamps, quality and lineage are retained or generated by shared module processing. Children do not publish incomplete messages.'}</p>
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '完整消息字段定义' : 'Complete message field definitions'}</h3>
        <dl className="source-case-inspector-fields">{graph.fields.filter(f => f.node_id === node.id).map(f => <div key={f.id}><dt><code>{f.name}</code></dt><dd>{f.definition}</dd></div>)}</dl>
      </section>
      <section className="source-case-inspector-section"><h3>{zh ? '下游实际用途' : 'Downstream uses'}</h3>
        {(settings.field_consumers || []).map(c => <div key={c.key}><h4>{c.name}</h4><p>{c.purpose}</p><p>{c.metric_fields.map(name => <code key={name}>{name} </code>)}</p></div>)}
      </section>
    </>}
  </ProcessingCardFrame>;
}
