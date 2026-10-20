import React from 'react';
import type { Graph, Language } from './contracts';
import { edgePresentation } from './edgePresentation';
import { nodeRef } from './graphRefs';
import './shared-reference.css';

type Display = {id:string;logicalId:string;referenceAnchor?:string};
type DisplayEdge = {id:string;logicalEdgeId:string;upstream_id:string;downstream_id:string};
export function SharedReferenceUsage({graph,presentation,display,displays,edges,language,label,busy,onExpand,onCollapse,onOriginal,onOpenEdge}: {
  graph:Graph;presentation:Graph;display:Display;displays:Display[];edges:DisplayEdge[];language:Language;
  label:(name:string)=>string;busy:boolean;onExpand:()=>void;onCollapse:()=>void;onOriginal:()=>void;onOpenEdge:(id:string)=>void;
}) {
  const zh=language==='zh-CN', copies=displays.filter(n=>n.logicalId===display.logicalId);
  const byId=new Map(displays.map(n=>[n.id,n]));
  const useSite=graph.nodes.find(n=>n.id===byId.get(display.referenceAnchor||'')?.logicalId);
  const links=edges.filter(e=>e.upstream_id===display.id||e.downstream_id===display.id);
  const unique=[...new Map([...links].sort((a,b)=>Number(presentation.edges.find(e=>e.id===b.logicalEdgeId)?.presentation_role==='request')-
    Number(presentation.edges.find(e=>e.id===a.logicalEdgeId)?.presentation_role==='request')).map(e=>{
    const edge=presentation.edges.find(item=>item.id===e.logicalEdgeId);
    return [edge?.relationship_id||e.logicalEdgeId,e] as const;
  })).values()];
  return <section className="shared-reference-usage" aria-label={zh?'当前使用位置':'Current use site'}>
    <strong>{display.referenceAnchor ? (zh?'公共引用 · 当前使用处':'Shared reference · this use') : (zh?'当前使用位置':'Current use site')}
      {copies.length>1&&<span>{zh?`全图 ${copies.length} 处`:`${copies.length} locations`}</span>}</strong>
    {copies.length>1&&<p>{zh?'同编号共用内容和配置，修改后各处同步；每处位置独立。':'Content and settings are shared across this reference; each location moves independently.'}</p>}
    {useSite&&<p>{zh?'此处用于':'Used here by'} {nodeRef(useSite)} · {label(useSite.name)}</p>}
    {unique.map(e=>{
      const visual=byId.get(e.upstream_id===display.id?e.downstream_id:e.upstream_id);
      const neighbor=graph.nodes.find(n=>n.id===visual?.logicalId);
      const shown=presentation.edges.find(item=>item.id===e.logicalEdgeId);
      if (!neighbor||!shown) return null;
      const logical=typeof shown.relationship_id==='string'?shown.relationship_id:shown.id;
      const mappings=(graph.field_usages||[]).filter(u=>u.edge_id===logical).length;
      return <button key={e.id} onClick={()=>onOpenEdge(logical)} className="reference-connection">
        <span>{e.upstream_id===display.id?(zh?'输出至':'To'):(zh?'输入自':'From')} {nodeRef(neighbor)} · {label(neighbor.name)}</span>
        <small>{edgePresentation(presentation,shown,language).displayLabel} · {mappings?(zh?`${mappings} 项字段映射`:`${mappings} field mappings`):(zh?'字段映射待定义':'Field mappings undefined')}</small>
      </button>;
    })}
    <div className="reference-actions"><button disabled={busy} onClick={onExpand}>{zh?'在此展开输入输出':'Expand inputs and outputs here'}</button>
      {displays.some(n=>n.referenceAnchor===display.id && graph.nodes.find(original=>original.id===n.logicalId)?.display_positions?.[n.id])&&<button disabled={busy} onClick={onCollapse} title={zh?'清除手动展开和位置；大地图自动安排的公共引用继续保留':'Clear manual expansion and its positions; automatic shared references remain'}>{zh?'收起手动展开':'Collapse manual expansion'}</button>}
      {display.id!==display.logicalId&&<button onClick={onOriginal}>{zh?'定位原卡片':'Locate original card'}</button>}</div>
  </section>;
}
