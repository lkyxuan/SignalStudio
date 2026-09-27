import React, { useEffect, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import './signal-design.css';

const hasText = value => Boolean(String(value || '').trim());

export function SignalDesignGuide({ node, graph, fields, language }) {
  const [packageInfo, setPackageInfo] = useState(null);
  useEffect(() => {
    if (!node.signal_key) { setPackageInfo(null); return; }
    let current = true;
    fetch(`/api/signals/${encodeURIComponent(node.signal_key)}/package`)
      .then(async response => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Package unavailable');
        return data;
      })
      .then(data => { if (current) setPackageInfo({ data }); })
      .catch(error => { if (current) setPackageInfo({ error: error.message }); });
    return () => { current = false; };
  }, [node.signal_key, graph]);
  const zh = language === 'zh-CN';
  const word = (cn, en) => zh ? cn : en;
  const incoming = (graph.edges || []).filter(edge => edge.downstream_id === node.id);
  const edgeIds = new Set(incoming.map(edge => edge.id));
  const requirements = (graph.requirements || []).filter(item => item.node_id === node.id);
  const specificInput = requirements.length > 0 || (graph.field_usages || []).some(usage => edgeIds.has(usage.edge_id));
  const calculation = hasText(node.formula) || incoming.some(edge => hasText(edge.transformation));
  const checks = [
    [word('判断目标', 'Decision question'), hasText(node.decision_question)],
    [word('具体输入', 'Specific inputs'), specificInput],
    [word('计算方法', 'Calculation'), calculation],
    [word('输出定义', 'Output contract'), fields.some(field => hasText(field.name) && hasText(field.definition))],
    [word('触发条件', 'Trigger rule'), hasText(node.trigger_rule)],
    [word('验证方法', 'Validation plan'), hasText(node.validation_plan)],
  ];
  const complete = checks.filter(([, done]) => done).length;
  const guidance = packageInfo?.data?.definition?.implementation_guidance;
  const computeProduct = guidance?.stages.find(stage => stage.stage === 'calculation')?.product;
  const stageNames = { collection: word('采集', 'Collection'), transport: word('传输', 'Transport'), calculation: word('计算', 'Calculation'), signal_delivery: word('产出', 'Delivery') };
  return <><section className="signal-design-guide" aria-label={word('信号设计要素', 'Signal design essentials')}>
    <div className="signal-design-head"><strong>{word('信号设计要素', 'SIGNAL DESIGN')}</strong><span>{complete}/{checks.length}</span></div>
    <p>{word('逐项梳理信号的用途、输入、计算和检验方式。', 'Work through the purpose, inputs, calculation, and validation of this signal.')}</p>
    <div className="signal-design-checks">{checks.map(([label, done]) => <span key={label} className={done ? 'done' : ''}>{done ? <Check size={12} /> : <Circle size={12} />}{label}</span>)}</div>
    <small>{hasText(node.validation_evidence) ? word('已记录验证观察；仍需根据样本和方法判断效果。', 'Validation observations recorded; assess results against the method and sample.') : word('尚无实际验证记录。设计填齐不代表信号有效。', 'No validation results recorded. A complete design does not establish effectiveness.')}</small>
  </section>
  {node.signal_key && <section className="signal-implementation-guide" aria-label={word('实施建议', 'Implementation guidance')}>
    <div className="signal-implementation-head"><strong>{word('实施建议', 'IMPLEMENTATION GUIDANCE')}</strong>{packageInfo?.data && <span>{packageInfo.data.implementation_readiness.status === 'ready' ? word('配置齐全', 'Ready to design') : word('有待补项', 'Incomplete')}</span>}</div>
    {guidance ? <><p>{word('目标平台', 'Target platform')}：{guidance.target_platform} · {word('推荐技术栈，具体组件由实施方选择。', 'Preferred stack; the implementing team selects components.')}</p>
      <div className="signal-implementation-stages">{guidance.stages.map(stage => <div key={stage.stage}><small>{stageNames[stage.stage] || stage.stage}</small><strong>{stage.product}</strong><span>{stage.preferred_runtime} · {stage.component_candidate}</span></div>)}</div>
      <p className="signal-implementation-note">{word(`计算优先考虑 ${computeProduct}；如选择其他方案，实施回报需记录实际选型与差异。`, `Prefer ${computeProduct} for calculation; report the selected stack and any deviations.`)}</p>
    </> : <p>{packageInfo?.error || word('正在读取执行包…', 'Loading execution package…')}</p>}
  </section>}
  </>;
}
