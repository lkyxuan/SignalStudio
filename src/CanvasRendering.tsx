import { MotionContext } from './MotionGate';
import React, { memo, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { Panel, useStore, useStoreApi, useReactFlow } from '@xyflow/react';
import { canvasRenderMode, inCanvasView, frameThrottle, type Rect } from './canvasViewport';
export function useCanvasNodeMode(id: string) {
  const gate = useContext(MotionContext), previous = useRef('overview');
  return useStore(useCallback(s => {
    if (gate.active) return previous.current;
    const node = s.nodeLookup.get(id);
    if (!node) return 'overview';
    return previous.current = canvasRenderMode({ ...node.internals.positionAbsolute,
      width: node.measured?.width ?? 300, height: node.measured?.height ?? 160 }, s);
  }, [id, gate]));
}
export function useCanvasEdgeMode(rect: Rect) {
  const gate = useContext(MotionContext), previous = useRef('overview');
  return useStore(useCallback(s => gate.active ? previous.current : (previous.current = canvasRenderMode(rect, s)), [rect.x, rect.y, rect.width, rect.height, gate]));
}
export function useCanvasNodeVisible(id: string) {
  return useStore(useCallback(s => {
    const node = s.nodeLookup.get(id);
    if (!node?.measured.width || !node.measured.height || node.dragging || node.selected) return true;
    return inCanvasView({ ...node.internals.positionAbsolute, width: node.measured.width, height: node.measured.height }, s);
  }, [id]));
}
const MapNode = memo(function MapNode({x,y,width,height,color}: Rect & {color:string}) {
  return <rect x={x} y={y} width={width} height={height} rx={5} fill={color} />;
});
export const CanvasMiniMap = memo(function CanvasMiniMap({nodeColor}: {nodeColor:(node:any)=>string}) {
  const store = useStoreApi(), flow = useReactFlow(), gate = useContext(MotionContext);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<{x:number;y:number;view:ReturnType<typeof flow.getViewport>;bounds:Rect} | null>(null);
  const snapshot = useCallback(() => {
    const s = store.getState(), [tx,ty,zoom] = s.transform;
    const view = {x:-tx/zoom,y:-ty/zoom,width:s.width/zoom,height:s.height/zoom};
    const nodes = [...s.nodeLookup.values()].filter(n=>!n.hidden && n.measured.width && n.measured.height)
      .map(n=>({id:n.id,...n.internals.positionAbsolute,width:n.measured.width!,height:n.measured.height!,color:nodeColor(n.internals.userNode)}));
    const left=Math.min(view.x,...nodes.map(n=>n.x)), top=Math.min(view.y,...nodes.map(n=>n.y));
    const right=Math.max(view.x+view.width,...nodes.map(n=>n.x+n.width)), bottom=Math.max(view.y+view.height,...nodes.map(n=>n.y+n.height));
    const scale=Math.max((right-left)/140,(bottom-top)/80,1);
    const bounds={x:(left+right)/2-scale*75,y:(top+bottom)/2-scale*150*80/140/2,width:scale*150,height:scale*150*80/140};
    return {view,nodes,bounds};
  },[store,nodeColor]);
  const [map,setMap] = useState(snapshot);
  const currentMap = useRef(map); currentMap.current = map;
  useEffect(()=>{
    const update=()=>{
      if(!gate.active){setMap(snapshot());return;}
      // During GPU motion only the mask moves; cached node rectangles do not
      // require a React render or a complete bounds/node-array reconstruction.
      const s=store.getState(),[x,y,z]=s.transform,b=currentMap.current.bounds;
      const view={x:-x/z,y:-y/z,width:s.width/z,height:s.height/z};
      svg.current?.querySelector('.react-flow__minimap-mask')?.setAttribute('d',`M${b.x},${b.y}h${b.width}v${b.height}h${-b.width}z M${view.x},${view.y}h${view.width}v${view.height}h${-view.width}z`);
    };
    const throttled=frameThrottle(update);
    update();
    const unsubscribe=store.subscribe((next,prev)=>{
      if(next.transform!==prev.transform || next.nodes!==prev.nodes || next.width!==prev.width || next.height!==prev.height) throttled.request();
    });
    const done=()=>throttled.flush();
    const root=store.getState().domNode;
    root?.addEventListener('pointerup',done); root?.addEventListener('touchend',done);
    return ()=>{unsubscribe();throttled.cancel();root?.removeEventListener('pointerup',done);root?.removeEventListener('touchend',done);};
  },[store,snapshot,gate]);
  useEffect(()=>{
    const element=svg.current;
    const wheel=(event:WheelEvent)=>{
      event.preventDefault();event.stopPropagation();
      const current=store.getState(), view=flow.getViewport();
      const zoom=Math.max(current.minZoom,Math.min(current.maxZoom,view.zoom*Math.exp(-event.deltaY*.002)));
      void flow.setCenter((-view.x+current.width/2)/view.zoom,(-view.y+current.height/2)/view.zoom,{zoom});
    };
    element?.addEventListener('wheel',wheel,{passive:false});
    return ()=>element?.removeEventListener('wheel',wheel);
  },[store,flow]);
  const {view,nodes,bounds}=map;
  return <Panel position="bottom-right" className="react-flow__minimap nodrag nopan" style={{width:140,height:80}}>
    <svg ref={svg} width={140} height={80} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} role="img" aria-label="缩略图 / Mini map" style={{display:'block',touchAction:'none'}}
      onPointerDown={event=>{
        if(event.button!==0)return;
        event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);
        const r=event.currentTarget.getBoundingClientRect(), x=bounds.x+(event.clientX-r.left)/r.width*bounds.width,y=bounds.y+(event.clientY-r.top)/r.height*bounds.height;
        const current=flow.getViewport(),s=store.getState();
        drag.current={x:event.clientX,y:event.clientY,view:{x:s.width/2-x*current.zoom,y:s.height/2-y*current.zoom,zoom:current.zoom},bounds};
        void flow.setViewport(drag.current.view);
      }}
      onPointerMove={event=>{
        if(!drag.current)return;event.stopPropagation();
        const r=event.currentTarget.getBoundingClientRect(),start=drag.current;
        void flow.setViewport({...start.view,x:start.view.x-(event.clientX-start.x)/r.width*start.bounds.width*start.view.zoom,y:start.view.y-(event.clientY-start.y)/r.height*start.bounds.height*start.view.zoom});
      }}
      onPointerUp={()=>{drag.current=null;setMap(snapshot());}} onLostPointerCapture={()=>{drag.current=null;setMap(snapshot());}}>
      {nodes.map(node=><MapNode key={node.id} {...node}/>)}
      <path className="react-flow__minimap-mask" fillRule="evenodd" d={`M${bounds.x},${bounds.y}h${bounds.width}v${bounds.height}h${-bounds.width}z M${view.x},${view.y}h${view.width}v${view.height}h${-view.width}z`} />
    </svg>
  </Panel>;
});
