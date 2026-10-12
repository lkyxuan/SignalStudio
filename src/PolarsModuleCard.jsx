import React from 'react';
import spec from '../catalog/polars-indicator-module.v1.json';

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

// Metric-specific notes fit the ordinary process inspector; no module-only card format.
export function PolarsMetricNotes({ node, language }) {
  const zh = language === 'zh-CN';
  const settings = resource(node);
  const child = spec.cards.find(c => c.key === settings.design_key && settings.parent_module);
  return <details className="processing-advanced"><summary>{zh ? '其他设置 · Polars计算说明' : 'Other settings · Polars calculation notes'}</summary>
    <p>{zh ? '同一Polars程序内执行；后台实现与运行未核验。' : 'Runs within one Polars program; backend implementation and execution unverified.'}</p>
    {settings.parent_module && <p>{zh ? '所属模块' : 'Owning module'} #{settings.parent_module.reference_number}</p>}
    {child && <>
      <p>{settings.nullable_identity_context ? (zh ? '沿用同一observation_id；asset_id可为空，确认无映射时仍计算指标。不生成UUID、不以空UUID合并不同币种。' : 'Keep observation_id; asset_id may be null. Compute source-only indicators without creating a UUID or merging unrelated null IDs.') : child.context_note}</p>
      <dl className="source-case-inspector-fields">{Object.entries(child.input_origins).map(([name, origin]) => <div key={name}><dt><code>{name}</code></dt><dd>{origin}</dd></div>)}</dl>
      {child.history && <><h4>{zh ? '历史基线' : 'History baseline'}</h4><p>{child.history.target}</p><p>{settings.nullable_identity_context ? (zh ? '已识别资产沿用原基线规则；无UUID按相同来源范围+稳定coin ID、USD、覆盖版本匹配可比历史，不按null UUID关联。仍取24小时前目标之前最近、相距≤30分钟的有效快照；缺失基线时放量倍数为空。' : 'Resolved assets keep the existing baseline. For null UUIDs match the same source, stable coin ID, USD and coverage; never join on null asset IDs. Keep the prior 24-hour target and 30-minute tolerance; missing baseline yields null.') : child.history.selection}</p></>}
      <p>{child.missing}</p>
      <p>{zh ? '假设案例，非真实运行：' : 'Hypothetical example, not an observed run: '}<code>{JSON.stringify(child.example.input)}</code> → <code>{String(child.example.output)}</code></p>
      <p>{zh ? 'Polars计算方式：共享校验先将非数值、布尔及非有限来源归一为Float64 null，并选择历史基线；条件表达式不保证分支短路。' : 'Polars expression: shared validation first normalizes nonnumeric, boolean and nonfinite values to Float64 null and selects the baseline. Conditions do not guarantee short-circuit evaluation.'}</p>
      <pre>{child.polars_expression}</pre>
    </>}
  </details>;
}
