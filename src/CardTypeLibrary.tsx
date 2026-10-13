import React, {useState} from 'react';
import {ChevronDown} from 'lucide-react';
import type {CardTypeGroup} from './cardTypeFilters';
import './card-type-library.css';

export function CardTypeLibrary({groups,language,selected,onSelect}:{groups:CardTypeGroup[];language:string;selected:string;onSelect:(id:string)=>void}) {
  const [collapsed,setCollapsed]=useState(new Set(['process','decision','channel','state','interface']));
  const zh=language==='zh-CN';
  return <div className="library-list card-type-library" aria-label={zh?'卡片类型':'Card types'}>
    <div className="library-group-label">{zh?'卡片类型':'Card types'}</div>
    <button className={`library-item ${selected==='All types'?'library-active':''}`} onClick={()=>onSelect('All types')} aria-pressed={selected==='All types'}>{zh?'全部卡片':'All cards'}<span>{groups.reduce((sum,group)=>sum+group.count,0)}</span></button>
    {groups.map(group=><div className="card-type-group" key={group.id}>
      <div className="card-type-parent">
        <button className={`library-item ${selected===group.id?'library-active':''}`} onClick={()=>onSelect(group.id)} aria-pressed={selected===group.id}>
          <span className={`type-dot ${group.style}`}/>{group.label}<span>{group.count}</span>
        </button>
        <button className="card-type-toggle" aria-label={`${zh?'展开或收起':'Expand or collapse'} ${group.label}`} aria-expanded={!collapsed.has(group.id)} onClick={()=>setCollapsed(previous=>{const next=new Set(previous);if(next.has(group.id))next.delete(group.id);else next.add(group.id);return next;})}><ChevronDown size={14}/></button>
      </div>
      <div hidden={collapsed.has(group.id)} className="card-type-children">
        {group.children.map(child=><button key={child.id} className={`library-item card-type-child ${selected===child.id?'library-active':''}`} aria-pressed={selected===child.id} onClick={()=>onSelect(child.id)} title={child.label}>
          <span className={`type-dot ${group.style} tone-${child.tone}`}/><span className="card-type-name">{child.label}</span><span>{child.count}</span>
        </button>)}
      </div>
    </div>)}
  </div>;
}
