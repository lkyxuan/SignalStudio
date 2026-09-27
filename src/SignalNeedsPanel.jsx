import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { displayNodeName } from './i18n';
import { displayCatalogNodeName, displayFieldName } from './catalogPresentation';
import './signal-needs.css';

const EMPTY = { name: '', purpose: '', expected_example: '' };

export function SignalNeedsPanel({ node, graph, mutate, busy, language }) {
  const zh = language === 'zh-CN';
  const word = (cn, en) => zh ? cn : en;
  const [draft, setDraft] = useState(EMPTY);
  const [editing, setEditing] = useState(false);
  useEffect(() => { setDraft(EMPTY); setEditing(false); }, [node.id]);
  const requirements = (graph.requirements || []).filter(item => item.node_id === node.id);
  const pending = requirements.filter(item => !item.source_field_id);
  const save = async () => {
    const result = await mutate('/nodes/' + node.id + '/requirements', 'POST', draft,
      word('数据需求已记录', 'Data need recorded'));
    if (result) { setDraft(EMPTY); setEditing(false); }
  };
  const remove = async item => {
    const message = zh ? '移除数据需求“' + item.name + '”？' : 'Remove data need “' + item.name + '”?';
    if (!confirm(message)) return;
    await mutate('/requirements/' + item.id, 'DELETE', null, word('数据需求已移除', 'Data need removed'));
  };
  const crawlerBrief = [
    word('节点', 'Node') + ': ' + displayNodeName(language, node.name),
    word('目标', 'Purpose') + ': ' + (node.definition || word('待补充', 'To be defined')),
    '',
    ...pending.flatMap((item, index) => [
      (index + 1) + '. ' + item.name,
      word('用途', 'Why needed') + ': ' + (item.purpose || '—'),
      word('期望样例', 'Expected example') + ': ' + (item.expected_example || '—'),
      '',
    ]),
  ].join('\n');
  return <section className="signal-needs">
    <div className="section-heading"><span>{word('需要的数据', 'DATA NEEDED')} <em>{requirements.length}</em></span><button onClick={() => setEditing(true)}><Plus size={14} /> {word('列出需求', 'Add need')}</button></div>
    <p className="section-help">{word('这里记录所需的爬虫数据；其他节点依赖请用连线表示。内部资产记录不在爬虫字段目录中。', 'Record crawler data needs here and connect other node dependencies on the graph. Internal asset records are outside the crawler catalog.')}</p>
    {!requirements.length && !editing && <div className="field-empty">{word('还没有列出输入需求。', 'No input needs listed yet.')}</div>}
    {requirements.map(item => {
      const field = (graph.fields || []).find(candidate => candidate.id === item.source_field_id);
      const source = field && graph.nodes.find(candidate => candidate.id === field.node_id);
      return <div className="signal-need-card" key={item.id}>
        <div className="signal-need-title"><strong>{item.name}</strong><span className={field ? 'found' : 'pending'}>{field ? word('已找到字段', 'Field found') : word('还需寻找', 'Still needed')}</span></div>
        {item.purpose && <p>{item.purpose}</p>}
        {item.expected_example && <small>{word('期望样例', 'Expected example')}: {item.expected_example}</small>}
        {field && <small>{word('来自', 'From')}: {source ? displayCatalogNodeName(source, language) : '—'} / {displayFieldName(field, language)}</small>}
        <div className="signal-need-actions">
          <button className="signal-need-remove" onClick={() => remove(item)} aria-label={word('移除', 'Remove') + item.name}><Trash2 size={13} /></button>
        </div>
      </div>;
    })}
    {editing && <div className="signal-need-editor">
      <label>{word('需要什么数据', 'Data needed')}<input aria-label={word('需要什么数据', 'Data needed')} autoFocus value={draft.name} placeholder={word('例如：24 小时独立讨论人数', 'e.g. unique authors in 24 hours')} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>{word('为什么需要', 'Why needed')}<textarea aria-label={word('为什么需要', 'Why needed')} rows="2" value={draft.purpose} placeholder={word('它如何帮助这个处理步骤？', 'How does this help this step?')} onChange={event => setDraft({ ...draft, purpose: event.target.value })} /></label>
      <label>{word('期望样例', 'Expected example')}<input aria-label={word('期望样例', 'Expected example')} value={draft.expected_example} placeholder={word('例如：1200 人', 'e.g. 1200 authors')} onChange={event => setDraft({ ...draft, expected_example: event.target.value })} /></label>
      <div className="signal-need-editor-actions"><button onClick={() => { setEditing(false); setDraft(EMPTY); }}>{word('取消', 'Cancel')}</button><button disabled={busy || !draft.name.trim()} onClick={save}>{word('保存需求', 'Save need')}</button></div>
    </div>}
    {pending.length > 0 && <details className="signal-need-brief"><summary>{word('给爬虫组的待找数据清单', 'Data request for crawler team')} · {pending.length}</summary><p>{word('可复制下面的内容，发给爬虫组进一步确认。', 'Copy this brief to discuss with the crawler team.')}</p><textarea readOnly rows={Math.min(16, 5 + pending.length * 4)} value={crawlerBrief} onFocus={event => event.target.select()} aria-label={word('待找数据清单', 'Crawler data request')} /></details>}
  </section>;
}
