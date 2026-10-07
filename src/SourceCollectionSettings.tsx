import type { Language, GraphNode } from './contracts';
import React from 'react';
import collectionPlans from '../catalog/source-collection-plans.v1.json';
import './source-collection-settings.css';

function cadenceLabel(plan: CollectionPlan | undefined, zh: boolean) {
  if (!plan) return zh ? '未定义' : 'Unspecified';
  if (plan.mode === 'event_driven') return zh ? '事件触发' : 'Event driven';
  if (plan.mode === 'on_demand') return zh ? '按需调用' : 'On demand';
  const minutes = plan.interval_minutes;
  if (minutes == null) return zh ? '未定义' : 'Unspecified';
  if (minutes % 1440 === 0) return zh ? `每 ${minutes / 1440} 天一次` : `Every ${minutes / 1440} days`;
  if (minutes % 60 === 0) return zh ? `每 ${minutes / 60} 小时一次` : `Every ${minutes / 60} hours`;
  return zh ? `每 ${minutes} 分钟一次` : `Every ${minutes} minutes`;
}

export function SourceCollectionSettings({ node, language }: { node: Pick<GraphNode, 'name'>; language: Language }) {
  const zh = language === 'zh-CN';
  const plans: Record<string, CollectionPlan> = collectionPlans.plans;
  const plan = plans[node.name];
  return <section className="source-collection-settings">
    <h3>{zh ? '采集计划' : 'Collection plan'}</h3>
    <div className="source-collection-cadence">{cadenceLabel(plan, zh)}</div>
    <p>{plan
      ? (zh ? '这是用户定义的目标频率；实际运行频率尚未验证。' : 'This is the user-defined target cadence; actual runs have not been verified.')
      : (zh ? '尚未定义采集频率。' : 'No collection cadence has been defined.')}</p>
  </section>;
}

interface CollectionPlan { mode: string; interval_minutes?: number }
