import React, { useEffect, useState } from 'react';
import { request } from './api';
import { cardKind, kindLabel } from './cardModel';
import type { Graph, GraphNode } from './contracts';
import { cardContractSchema } from './contracts';

type Props = {node: GraphNode; graph: Graph; language: string; busy: boolean;
  mutate: (path:string,method:string,body:unknown,message:string,preserve?:boolean)=>Promise<unknown>};
type Readiness = {structure:string;issues:{code:string;message_zh:string}[];
  runtime_compatibility?: {adapter:string;differences:{code:string;message_zh:string}[]}};
export function CardDefinitionSettings({node,language,busy,mutate}: Props) {
  const zh = language === 'zh-CN', contract = node.card_contract;
  const [config,setConfig] = useState(contract?.config);
  const [readiness,setReadiness] = useState<Readiness | null>(null);
  const [error,setError] = useState('');
  const [jsonText,setJsonText] = useState(JSON.stringify(contract?.config,null,2));
  const [properties,setProperties] = useState({name:node.name,definition:node.definition});
  useEffect(() => { setConfig(contract?.config); setJsonText(JSON.stringify(contract?.config,null,2)); setError(''); let alive=true;
    void request(`/nodes/${node.id}/definition`).then(value => {
      if (alive) setReadiness((value as {readiness:Readiness}).readiness);
    }).catch(() => { if(alive) setReadiness(null); });
    return () => {alive=false;};
  },[node.id,contract?.revision]);
  useEffect(()=>setProperties({name:node.name,definition:node.definition}),[node.id,node.name,node.definition]);
  if (!contract || !config) return null;
  const change = (key:string,value:unknown) => { const next={...config,[key]:value}; setConfig(next);setJsonText(JSON.stringify(next,null,2));setError(''); };
  return <details className="processing-advanced card-definition-settings">
    <summary>{zh ? '其他设置 · 卡片定义与就绪检查' : 'Other settings · definition and readiness'}</summary>
    <p>{kindLabel(cardKind(node),language)} · {config.subtype}</p>
    <p>{zh ? '定义完整不代表已经实施、部署或产生数据。运行结果需单独回填证据。' : 'A complete definition does not establish implementation, deployment or observed data. Runtime evidence is reported separately.'}</p>
    {readiness && <ul>{readiness.issues.map((issue,index) => <li key={`${issue.code}:${index}`}>{zh ? issue.message_zh : issue.code}</li>)}</ul>}
    {!!readiness?.runtime_compatibility?.differences.length && <details><summary>{zh?'运行兼容性待核对':'Runtime compatibility to confirm'}</summary><ul>{readiness.runtime_compatibility.differences.map(item=><li key={item.code}>{zh?item.message_zh:item.code}</li>)}</ul></details>}
    <fieldset disabled={busy || config.read_only}>
      {['table','channel','state'].includes(cardKind(node)) && !node.is_system_state && <>
        <label>{zh?'名称':'Name'}<input value={properties.name} onChange={e=>setProperties({...properties,name:e.target.value})} /></label>
        <label>{zh?'这张卡片做什么':'Purpose'}<textarea value={properties.definition} onChange={e=>setProperties({...properties,definition:e.target.value})} /></label>
        <button className="button-secondary" onClick={async()=>{await mutate(`/nodes/${node.id}`,'PATCH',properties,zh?'卡片说明已保存':'Card description saved');}}>{zh?'保存说明':'Save description'}</button>
      </>}
      <label>{zh?'业务子类':'Business subtype'}<input value={config.subtype} onChange={e=>change('subtype',e.target.value)} /></label>
      <label>{zh?'使用的技术':'Technology'}<input value={config.technology} onChange={e=>change('technology',e.target.value)} /></label>
      <label>{zh?'环境':'Environment'}<input value={config.environment} onChange={e=>change('environment',e.target.value)} /></label>
      {['source','process','decision'].includes(cardKind(node)) && <>
        <label>{zh?'何时开始':'When to start'}<select value={config.trigger.kind} onChange={e=>change('trigger',{...config.trigger,kind:e.target.value})}>
          {Object.entries(zh?{unspecified:'待确认／沿用模块定义',manual:'人工开始',schedule:'定时',event:'收到事件',change:'数据变化'}:{unspecified:'Unspecified / module definition',manual:'Manual',schedule:'Schedule',event:'Event',change:'Data change'}).map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select></label>
        {config.trigger.kind === 'schedule' && <label>{zh?'间隔（秒）':'Interval (seconds)'}<input type="number" min="1" value={String(config.trigger.interval_seconds ?? '')} onChange={e=>change('trigger',{...config.trigger,interval_seconds:Number(e.target.value)})} /></label>}
        <label>{zh?'多个输入怎样到达':'How inputs arrive'}<select value={config.join.mode} onChange={e=>change('join',{...config.join,mode:e.target.value})}><option value="merge">{zh?'每次来一条，就处理一条':'Handle each incoming event'}</option><option value="one_of">{zh?'任选一条来路':'One alternative input'}</option><option value="all">{zh?'同一批输入全部到齐':'Wait for all correlated inputs'}</option></select></label>
      </>}
        <details><summary>{zh?'技术契约（供 AI 与开发者）':'Technical contract (AI / developers)'}</summary>
          <label>{zh?'动作标识':'Action ID'}<input value={config.action.id} onChange={e=>change('action',{...config.action,id:e.target.value})} /></label>
          <label>{zh?'完整配置 JSON':'Complete configuration JSON'}<textarea rows={12} value={jsonText} onChange={e=>{setJsonText(e.target.value);try {setConfig(cardContractSchema.shape.config.parse(JSON.parse(e.target.value)));setError('');}catch{setError(zh?'配置格式有误，请保留完整字段':'Invalid configuration; keep all required fields');}}} /></label>
        </details>
      {error && <p role="alert">{error}</p>}
      <button className="button-secondary" disabled={!!error} onClick={async()=>{await mutate(`/nodes/${node.id}/definition`,'PATCH',{revision:contract.revision,config},zh?'卡片定义已保存':'Card definition saved');}}>{zh?'保存卡片定义':'Save definition'}</button>
    </fieldset>
    <p><a href="/api/graph/package" target="_blank" rel="noreferrer">{zh?'查看完整定义包 JSON ↗':'Open complete definition package JSON ↗'}</a></p>
  </details>;
}

export function GenericTableCard({node,graph,language}: Pick<Props,'node'|'graph'|'language'>) {
  const fields=graph.fields.filter(field=>field.node_id===node.id).sort((a,b)=>a.ordinal-b.ordinal), zh=language==='zh-CN';
  return <div className="business-table-card"><div className="table-wrap"><table><thead><tr>{fields.map(field=><th key={field.id}><code>{field.name}</code></th>)}</tr></thead><tbody><tr><td colSpan={Math.max(fields.length,1)}>{zh?'尚未回填真实记录':'No observed records have been imported'}</td></tr></tbody></table></div><p>{node.definition}</p><p>{zh?'这里展示表定义。字段声明、示例和连线不能证明后台已有表行。':'This is a table definition. Fields, examples and connections do not establish backend records.'}</p></div>;
}
