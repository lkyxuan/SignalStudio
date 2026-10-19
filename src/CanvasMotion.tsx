import React, {useContext,useEffect,useLayoutEffect,useRef} from 'react';
import {useStoreApi,useNodesInitialized} from '@xyflow/react';
import {MotionContext} from './MotionGate';
import {motionCurve,motionEndpoint} from './motionScene';
import {GPUScene,type Color} from './gpuScene';
import {displayNodeName} from './i18n';
import {nodeRef} from './graphRefs';
import {kindLabel,cardKind,kindStyle} from './cardModel';

const glyphWidths=new Map<string,number>();
function wrap(ctx:CanvasRenderingContext2D,text:string,x:number,y:number,width:number,lineHeight:number,lines:number) {
  let line='',row=0,lineWidth=0;
  for(const char of text) {
    const key=ctx.font+'|'+char;
    let charWidth=glyphWidths.get(key);if(charWidth===undefined){charWidth=ctx.measureText(char).width;glyphWidths.set(key,charWidth);}
    if(lineWidth+charWidth>width) {
      ctx.fillText(line+(row===lines-1?'…':''),x,y+row*lineHeight);line='';lineWidth=0;if(++row>=lines)return;
    }
    line+=char;lineWidth+=charWidth;
  }
  if(line)ctx.fillText(line,x,y+row*lineHeight);
}
// ReactFlow remains the interaction/geometry owner. Only camera motion uses this
// prebuilt GPU scene; idle HTML preserves the complete editor and accessibility.
export function CanvasMotion({nodes,edges}:{nodes:any[];edges:any[]}) {
  const initialized=useNodesInitialized();
  const store=useStoreApi(),gate=useContext(MotionContext),canvas=useRef<HTMLCanvasElement>(null);
  const emphasis=useRef(new Map<string,number>());
  useLayoutEffect(()=>{emphasis.current=new Map([...nodes,...edges].map(n=>[n.id,n.className?.includes('graph-dimmed')?.16:1]));},[nodes,edges]);
  // Hover/selection does not invalidate rasterized text or allocate a new atlas.
  const sceneKey=JSON.stringify({nodes:nodes.map(n=>[n.id,n.hidden,n.position,n.width,n.height,n.data?.name,n.data?.type,n.data?.kind,n.data?.motionTitle,n.data?.motionSummary,n.data?.fieldCount,n.data?.language,n.data?.title,n.data?.count]),
    edges:edges.map(e=>[e.id,e.hidden,e.source,e.target,e.sourceHandle,e.targetHandle,e.data?.sourceSide,e.data?.targetSide,e.data?.sourcePort,e.data?.targetPort,e.data?.parallelIndex,e.data?.pairedReverse,e.data?.meaning,e.markerStart,e.markerEnd,e.style?.stroke,e.style?.strokeWidth,e.style?.strokeDasharray])});
  const valid=useRef(false);
  useLayoutEffect(()=>{valid.current=false;},[sceneKey]);
  const scene=useRef<GPUScene|null>(null),generation=useRef(0),frame=useRef(0),settle=useRef(0);
  useEffect(()=>{
    const root=store.getState().domNode;
    if(!root||!canvas.current)return;
    const draw=()=>{
      const s=store.getState();if(scene.current&&s.width&&s.height)scene.current.draw(s.transform,s.width,s.height);
    };
    gate.begin=()=>{
      ++generation.current;cancelAnimationFrame(settle.current);
      if(!scene.current||!valid.current||store.getState().nodes.some(n=>n.dragging))return;
      try {scene.current.setOpacity(emphasis.current);draw();gate.active=true;root.dataset.motion='gpu';}catch{gate.active=false;delete root.dataset.motion;}
    };
    gate.end=()=>{
      const token=++generation.current;
      if(!gate.active)return;
      gate.active=false;
      const s=store.getState();
      // One final notification lets the frozen content selectors catch up.
      store.setState({transform:[...s.transform]});
      settle.current=requestAnimationFrame(()=>{settle.current=requestAnimationFrame(()=>{if(token===generation.current)delete root.dataset.motion;});});
    };
    const unsubscribe=store.subscribe((next,prev)=>{
      if(gate.active&&(next.transform!==prev.transform||next.width!==prev.width||next.height!==prev.height)) {
        cancelAnimationFrame(frame.current);frame.current=requestAnimationFrame(draw);
      }
    });
    const lost=(event:Event)=>{event.preventDefault();gate.end();scene.current?.dispose();scene.current=null;root.dataset.motionBackend='unavailable';};
    canvas.current.addEventListener('webglcontextlost',lost);
    return()=>{unsubscribe();canvas.current?.removeEventListener('webglcontextlost',lost);cancelAnimationFrame(frame.current);cancelAnimationFrame(settle.current);gate.active=false;gate.begin=()=>{};gate.end=()=>{};delete root.dataset.motion;};
  },[store,gate]);
  useEffect(()=>{
    let cancelled=false,timer:ReturnType<typeof setTimeout>;
    const build=async()=>{
      if(cancelled||!initialized)return;
      if(gate.active){timer=setTimeout(build,100);return;}
      const root=store.getState().domNode;if(!root||!canvas.current)return;
      // A context lost on this canvas stays on the original rendering path.
      if(root.dataset.motionBackend==='unavailable')return;
      const started=performance.now();
      let next:GPUScene|null=null;
      try {
        // Reuse the existing context; each scene owns and releases its resources.
        next=scene.current??new GPUScene(canvas.current);scene.current=next;next.resetAtlas();
        const gpu=next,lookup=store.getState().nodeLookup;
        const style=getComputedStyle(root),colorProbe=document.createElement('canvas').getContext('2d',{willReadFrequently:true})!;
        const css=(value:string)=>value.replace(/var\((--[\w-]+)\)/g,(_,name)=>style.getPropertyValue(name).trim());
        const colors=new Map<string,Color>();
        const color=(value:string,opacity=1):Color=>{
          const cached=colors.get(value+opacity);if(cached)return cached;
          colorProbe.clearRect(0,0,1,1);colorProbe.fillStyle=css(value);colorProbe.fillRect(0,0,1,1);
          const [r=0,g=0,b=0,a=255]=colorProbe.getImageData(0,0,1,1).data,alpha=a/255*opacity;
          const result:Color=[r/255*alpha,g/255*alpha,b/255*alpha,alpha];colors.set(value+opacity,result);return result;
        };
        const opacity=(_item:any)=>1;
        let slice=performance.now();
        const pause=async()=>{if(performance.now()-slice>6){await new Promise<void>(resolve=>setTimeout(resolve,0));slice=performance.now();}return cancelled;};
        // Original handle geometry and cubic controls retain long crossing arcs.
        for(const edge of edges) {
          if(await pause())return;
          if(edge.hidden)continue;
          gpu.beginItem(edge.id);
          const a=lookup.get(edge.source),b=lookup.get(edge.target);if(!a||!b)continue;
          const points=motionCurve(motionEndpoint(a,'source',edge.sourceHandle),motionEndpoint(b,'target',edge.targetHandle),edge.data||{});
          const tint=color(edge.style?.stroke||'var(--ss-edge)',opacity(edge));
          gpu.line(points,edge.style?.strokeWidth||1.5,tint,!!edge.style?.strokeDasharray);
          if(edge.markerEnd)gpu.arrow(points.at(-1)!,points.at(-2)!,tint);
          if(edge.markerStart)gpu.arrow(points[0]!,points[1]!,tint);
          const label=String(edge.data?.meaning||'');
          if(label){const width=Math.min(900,Math.ceil(label.length*11+18));
            const tile=gpu.tile(width,26,ctx=>{ctx.fillStyle=css('var(--ss-surface)');ctx.fillRect(0,0,width,26);ctx.strokeStyle=css('var(--ss-border)');ctx.strokeRect(.5,.5,width-1,25);ctx.font='600 11px system-ui';ctx.fillStyle=css(edge.style?.stroke||'var(--ss-muted)');ctx.fillText(label,7,17);});
            const mid=points[32]!;gpu.quad(mid[0]-width/2,mid[1]-13,width,26,[opacity(edge),opacity(edge),opacity(edge),opacity(edge)],tile,true);
          }
        }
        for(const node of nodes) {
          if(await pause())return;
          if(node.hidden)continue;
          gpu.beginItem(node.id);
          const d=node.data,internal=lookup.get(node.id),p=internal?.internals.positionAbsolute||node.position;
          const width=node.width||300,height=node.height||(node.type==='groupLabel'?36:160);
          const dom=root.querySelector(`[data-id="${CSS.escape(node.id)}"] .logic-node`);
          const cardStyle=dom?getComputedStyle(dom):null;
          const tile=gpu.tile(width,height,ctx=>{
            if(node.type==='groupLabel'){ctx.font='600 15px system-ui';ctx.fillStyle=css('var(--ss-muted)');ctx.fillText(`${d.title}  ${d.count}`,0,23);return;}
            ctx.fillStyle=cardStyle?.backgroundColor||css('var(--ss-surface)');ctx.beginPath();ctx.roundRect(0,0,width,height,8);ctx.fill();
            ctx.strokeStyle=cardStyle?.borderColor||css('var(--ss-border)');ctx.lineWidth=1;ctx.stroke();
            const kind=kindStyle(d),accent=({source:'blue',identity:'blue',state:'blue',topic:'purple',derived:'purple',metric:'success',score:'accent',ranking:'pink',cache:'pink'} as Record<string,string>)[kind]||'muted';
            ctx.fillStyle=css(`var(--ss-${accent})`);ctx.fillRect(5,0,width-10,3);
            ctx.fillStyle=css('var(--ss-text)');ctx.font='600 13px system-ui';ctx.fillText(nodeRef(d),12,24);
            ctx.fillStyle=css('var(--ss-muted)');ctx.font='10px system-ui';ctx.fillText(kindLabel(cardKind(d),d.language),80,24);
            if(d.fieldCount)ctx.fillText(`${d.fieldCount} ${d.language==='zh-CN'?'字段':'fields'}`,width-64,24);
            ctx.font='600 14px system-ui';ctx.fillStyle=css('var(--ss-text)');wrap(ctx,d.motionTitle||displayNodeName(d.language,d.name)||d.name,12,65,width-24,20,2);
            ctx.font='11px system-ui';ctx.fillStyle=css('var(--ss-muted)');wrap(ctx,d.motionSummary||d.definition||'',12,119,width-24,16,2);
          });
          const alpha=opacity(node);gpu.quad(p.x,p.y,width,height,[alpha,alpha,alpha,alpha],tile);
        }
        if(cancelled)return;gpu.upload();scene.current=gpu;valid.current=true;root.dataset.motionBackend='webgl';root.dataset.motionBuildMs=(performance.now()-started).toFixed(1);
      } catch (error) {
        root.dataset.motionError=error instanceof Error?error.message:String(error);
        if(next && next!==scene.current)next.dispose();scene.current?.dispose();scene.current=null;root.dataset.motionBackend='fallback';
      }
    };
    timer=setTimeout(build,120);
    return()=>{cancelled=true;clearTimeout(timer);};
  },[sceneKey,initialized,store,gate]);
  useEffect(()=>()=>{scene.current?.dispose();scene.current=null;},[]);
  return <canvas ref={canvas} className="canvas-motion" aria-hidden="true"/>;
}
