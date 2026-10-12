import React from 'react';
import { AlarmClock } from 'lucide-react';
import type { Language } from './contracts';
import { roleLabel, startsLabel, type StartKind, type TaskRole } from './taskPresentation';
export function TaskBadges({ role, starts, language }: { role: TaskRole; starts: StartKind[]; language: Language }) {
  return <div className="task-badges" data-role={role}>
    <span className="task-role" title={`${roleLabel(role, language)} · ${language === 'zh-CN' ? '任务职责（设计定义）' : 'Responsibility (design)'}`}>{roleLabel(role, language)}</span>
    {starts.length > 0 && <span className="task-start" title={language === 'zh-CN' ? '启动方式（定义，不是运行状态）；具体来源见关联流程' : 'Start definition, not runtime status; inspect related flow for origins'}>{starts.includes('schedule') && <AlarmClock size={11} />}{startsLabel(starts, language)}</span>}
  </div>;
}
