import React, { memo, useMemo, useState } from 'react';
import type { Graph, Language } from './contracts';
import { buildFeatureTree, featureLocation, scopeGraph, type Feature } from './featureTree';
import { GraphCanvas } from './GraphCanvas';
import { displayNodeName } from './i18n';
import { edgePresentation } from './edgePresentation';
import { matchesCardType } from './cardTypeFilters';
import { nodeRef } from './graphRefs';
import './feature-workspace.css';

export const FeatureWorkspace = memo(function FeatureWorkspace({graph, presentation, nodes, edges, nodeTypes, edgeTypes, labels, actions, miniMapColor, language, query, searchIndex, typeFilter, allowedIds, catalogEntityInfo}: {
  graph:Graph; presentation:Graph; nodes:any[]; edges:any[]; nodeTypes:any; edgeTypes:any; labels:any;
  actions:Record<string,(...args:any[])=>any>; miniMapColor:(node:any)=>string; language:Language;
  query:string; searchIndex:Map<string,string>; typeFilter:string; allowedIds:string; catalogEntityInfo:Record<string,{label_cn?:string}>;
}) {
  const zh = language === 'zh-CN', word=(cn:string,en:string)=>zh?cn:en;
  const [location,setLocation]=useState<{featureId:string;stepId?:string}|null>(null);
  const deferredQuery = query.trim().toLowerCase();
  const tree = useMemo(()=>buildFeatureTree(graph.nodes),[graph.nodes]);
  const label = (name:string)=>zh ? catalogEntityInfo[name]?.label_cn || displayNodeName(language,name) : displayNodeName(language,name);
  const matches = useMemo(()=> {
    if(!deferredQuery)return [];
    const numeric=/^#?\d+$/.test(deferredQuery);
    const ref = /^([lr])0*(\d+)(?:-q)?$/.exec(deferredQuery);
    const number = ref ? Number(ref[2]) : null;
    const edgeIds = new Set(graph.edges.filter(e=>ref?.[1]==='l' && e.reference_number===number).map(e=>e.id));
    for(const usage of graph.field_usages || []) if(ref?.[1]==='r' && usage.reference_number===number)edgeIds.add(usage.edge_id);
    const endpoints = new Set(graph.edges.filter(e=>edgeIds.has(e.id)).flatMap(e=>[e.upstream_id,e.downstream_id]));
    return graph.nodes.filter(n=>endpoints.has(n.id)||(numeric ? `#${n.reference_number}`===`#${deferredQuery.replace(/^#/,'')}` : searchIndex.get(n.id)?.includes(deferredQuery)));
  },[graph,searchIndex,deferredQuery]);
  const allowed = useMemo(()=>new Set(allowedIds.split(',')),[allowedIds]);
  const feature = tree.find(f=>f.id===location?.featureId);
  const step = feature?.steps.find(s=>s.id===location?.stepId);
  const members = step?.nodes || [];
  const ids = useMemo(()=>new Set(members.filter(n=>allowed.has(n.id)).map(n=>n.id)),[step,allowed]);
  const scoped = useMemo(()=> {
    const result=scopeGraph(nodes.filter(n=>n.type==='logic'),edges,ids);
    return {nodes:result.nodes.map(n=>({...n,hidden:false})),edges:result.edges.map(e=>({...e,hidden:false}))};
  },[nodes,edges,ids]);
  const boundary = useMemo(()=>graph.edges.filter(e=>ids.has(e.upstream_id)!==ids.has(e.downstream_id)),[graph.edges,ids]);
  const byId = useMemo(()=>new Map(graph.nodes.map(n=>[n.id,n])),[graph.nodes]);
  const jump = (id:string) => { const next=featureLocation(tree,id);if(next)setLocation(next); };
  const count = (items:typeof graph.nodes)=>items.filter(n=>allowed.has(n.id)).length;
  const hits = (items:typeof graph.nodes)=>items.filter(n=>matchesCardType(n,typeFilter)).length;
  return <div className="feature-workspace" data-feature-level={step?'cards':feature?'steps':'features'}>
    <nav className="feature-breadcrumb" aria-label={word('功能层级','Feature hierarchy')}>
      <button onClick={()=>setLocation(null)}>{word('功能总览','Features')}</button>
      {feature && <><span aria-hidden="true">/</span><button onClick={()=>setLocation({featureId:feature.id})}>{zh?feature.zh:feature.en}</button></>}
      {step && <><span aria-hidden="true">/</span><strong>{zh?step.zh:step.en}</strong></>}
    </nav>
    {deferredQuery && <section className="feature-results" aria-label={word('全局搜索结果','Global search results')}>
      <strong>{word(`全图找到 ${matches.length} 张卡片`,`Found ${matches.length} cards across the graph`)}</strong>
      <div>{matches.slice(0,24).map(n=><button key={n.id} onClick={()=>{jump(n.id);actions.openNode?.(n.id);}}>{nodeRef(n)} · {label(n.name)}</button>)}</div>
      {matches.length>24 && <small>{word('仅显示前24项，请补充编号或名称缩小范围。','First 24 results; refine the name or reference.')}</small>}
    </section>}
    {!step ? <>
      <p className="feature-intro">{feature ? word('选择一个小功能，再展开其中协作的卡片。','Choose a subfeature to reveal its cards.') : word('先看要完成的功能，再逐层展开到卡片。未展开的画布不会加载。','Choose a feature, then a subfeature. Collapsed canvases are not mounted.')}</p>
      <div className="feature-tiles">{(feature?feature.steps.filter(s=>s.nodes.length):tree).map(item=><button key={item.id} className={`feature-tile ${typeFilter!=='All types'&&hits(item.nodes)>0?'feature-type-match':''}`} onClick={()=>setLocation(feature?{featureId:feature.id,stepId:item.id}:{featureId:item.id})}>
        <strong>{zh?item.zh:item.en}</strong><span>{count(item.nodes)} {word('张卡片','cards')}{typeFilter!=='All types'&&` · ${hits(item.nodes)} ${word('类型匹配','type matches')}`}</span>
        {'steps' in item && <small>{(item as Feature).steps.filter(s=>s.nodes.length).map(s=>zh?s.zh:s.en).join(' · ')}</small>}
      </button>)}</div>
      {feature?.id==='webpage'&&!feature.nodes.some(n=>n.name==='Grokbot · 制作或更新资产网页')&&<p className="feature-note">{word('网页制作步骤尚未创建；当前资料流程结束于“组装生成资料”。','The webpage writer is not defined; preparation ends at material assembly.')}</p>}
    </> : <>
      <div className="feature-scope-status" role="status">{word(`当前展开 ${ids.size} 张逻辑卡；其他功能的完整卡片未挂载。`,`Showing ${ids.size} logical cards; other feature cards are not mounted.`)}</div>
      {scoped.nodes.length ? <div className="feature-canvas" key={`${feature!.id}/${step.id}`}><GraphCanvas nodes={scoped.nodes} edges={scoped.edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} labels={labels} actions={actions} miniMapColor={miniMapColor}/></div> : <p>{word('当前工作线下没有卡片，可切换总览查看。','No cards in this workflow path. Switch to Overview.')}</p>}
      <section className="feature-boundary" aria-label={word('跨功能连接','Connections outside this subfeature')}>
        <h3>{word(`外部输入与输出 · ${boundary.length} 条连接`,`External inputs and outputs · ${boundary.length} connections`)}</h3>
        {boundary.map(edge=>{
          const source=byId.get(edge.upstream_id),target=byId.get(edge.downstream_id);
          if(!source||!target)return null;
          const external=ids.has(source.id)?target:source;
          const meaning=edgePresentation(presentation,presentation.edges.find(e=>e.id===edge.id),language);
          const destination=featureLocation(tree,external.id),owner=tree.find(f=>f.id===destination?.featureId);
          return <div key={edge.id} className="feature-boundary-row">
            <button onClick={()=>actions.openEdge?.(edge.id)}>{nodeRef(source)} {label(source.name)} → {nodeRef(target)} {label(target.name)}<small>{meaning.displayLabel}</small></button>
            <button onClick={()=>jump(external.id)}>{word('前往','Go to')} {owner?(zh?owner.zh:owner.en):nodeRef(external)}</button>
          </div>;
        })}
        {!boundary.length&&<p>{word('这个小功能没有已连接的外部输入输出。','No external connections are defined for this subfeature.')}</p>}
      </section>
    </>}
  </div>;
});
