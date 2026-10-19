import React, { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ReactFlow, Background, Controls, useNodesInitialized, useReactFlow } from '@xyflow/react';
import { CanvasMiniMap } from './CanvasRendering';

// Stable event bridge keeps memoized canvases independent of inspector drafts.
// Handlers always observe the latest committed graph and live-edit protection.
export function useCanvasActions(handlers: Record<string, (...args:any[])=>any>) {
  const latest = useRef(handlers);
  useLayoutEffect(() => { latest.current = handlers; });
  return useMemo(() => Object.fromEntries(Object.keys(handlers).map(key => [key, (...args:any[]) => latest.current[key]?.(...args)])), []);
}
function InitialCanvasFit({actions}: {actions:Record<string, (...args:any[])=>any>}) {
  const initialized = useNodesInitialized(), flow = useReactFlow(), fitted = useRef(false);
  useEffect(() => {
    if (!initialized || fitted.current) return;
    fitted.current = true;
    // Wait for the complete mounted geometry, not the first measured cards.
    // Later content/graph updates must not reset the user's viewport.
    if (actions.ready) actions.ready(flow);
    else void flow.fitView({padding:0.16,maxZoom:0.75});
  }, [initialized, flow, actions]);
  return null;
}
export const GraphCanvas = memo(function GraphCanvas({ nodes, edges, nodeTypes, edgeTypes, labels, actions, miniMapColor }: {
  nodes:any[]; edges:any[]; nodeTypes:any; edgeTypes:any; labels:any;
  actions:Record<string, (...args:any[])=>any>; miniMapColor:(node:any)=>string;
}) {
  return <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
    ariaLabelConfig={labels} proOptions={{hideAttribution:true}}
    onNodesChange={actions.nodesChange} onEdgesChange={actions.edgesChange}
    onNodeClick={actions.nodeClick} onNodeDoubleClick={actions.nodeDoubleClick}
    onEdgeMouseEnter={actions.edgeEnter} onEdgeMouseLeave={actions.edgeLeave}
    onMoveStart={actions.moveStart} onMoveEnd={actions.moveEnd} onPaneClick={actions.paneClick}
    onNodeDragStart={actions.dragStart} onNodeDragStop={actions.dragStop}
    onConnect={actions.connect} onEdgeClick={actions.edgeClick} onEdgeDoubleClick={actions.edgeDoubleClick}
    onInit={actions.init} deleteKeyCode={null} zoomOnDoubleClick={false}
    minZoom={0.03} maxZoom={1.5}>
    <InitialCanvasFit actions={actions}/>
    <Background variant={'dots' as any} color="var(--ss-grid)" gap={22} size={1}/>
    <Controls showInteractive={false}/>
    {nodes.length > 0 && <CanvasMiniMap nodeColor={miniMapColor}/>}
  </ReactFlow>;
});
