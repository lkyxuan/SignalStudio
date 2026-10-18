import React, { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { ReactFlow, Background, Controls } from '@xyflow/react';
import { CanvasMiniMap } from './CanvasRendering';

// Stable event bridge keeps memoized canvases independent of inspector drafts.
// Handlers always observe the latest committed graph and live-edit protection.
export function useCanvasActions(handlers: Record<string, (...args:any[])=>any>) {
  const latest = useRef(handlers);
  useLayoutEffect(() => { latest.current = handlers; });
  return useMemo(() => Object.fromEntries(Object.keys(handlers).map(key => [key, (...args:any[]) => latest.current[key]?.(...args)])), []);
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
    fitView fitViewOptions={{padding:0.16,maxZoom:0.75}} minZoom={0.03} maxZoom={1.5}>
    <Background variant={'dots' as any} color="var(--ss-grid)" gap={22} size={1}/>
    <Controls showInteractive={false}/>
    {nodes.length > 0 && <CanvasMiniMap nodeColor={miniMapColor}/>}
  </ReactFlow>;
});
