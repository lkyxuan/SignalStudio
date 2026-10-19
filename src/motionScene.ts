import { bezierControls, type Point } from './edgeRouting';
export type MotionNode = { id: string; position: { x:number; y:number }; width?:number; height?:number; measured?:{width?:number;height?:number}; internals?:{positionAbsolute:{x:number;y:number};handleBounds?:{source?:Handle[]|null;target?:Handle[]|null}} };
type Handle = {id?:string|null; x:number;y:number;width:number;height:number;position:string};
export function motionEndpoint(node: MotionNode, type:'source'|'target', handleId?:string|null): Point {
  const p=node.internals?.positionAbsolute ?? node.position;
  const h=node.internals?.handleBounds?.[type]?.find(h=>h.id===handleId);
  if(h) {
    const x=p.x+h.x, y=p.y+h.y;
    return h.position==='left' ? [x,y+h.height/2] : h.position==='right' ? [x+h.width,y+h.height/2]
      : h.position==='top' ? [x+h.width/2,y] : [x+h.width/2,y+h.height];
  }
  return [p.x+(node.measured?.width??node.width??300)/2,p.y+(type==='source'?(node.measured?.height??node.height??160):0)];
}
export function motionCurve(source:Point,target:Point,data:Record<string,unknown>,steps=64) {
  const controls=bezierControls({sourceSide:'normal',targetSide:'normal',parallelIndex:0,dashed:false,...data,source,target});
  const points:Point[]=[];
  for(let i=0;i<=steps;i++) {
    const t=i/steps,u=1-t;
    points.push([0,1].map(axis=>u*u*u*controls[0][axis]!+3*u*u*t*controls[1][axis]!+3*u*t*t*controls[2][axis]!+t*t*t*controls[3][axis]!) as Point);
  }
  return points;
}
export type MotionGate = { active:boolean; begin:()=>void; end:()=>void };
export const newMotionGate = ():MotionGate => ({active:false,begin(){},end(){}});
