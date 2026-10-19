import test from 'node:test';
import assert from 'node:assert/strict';
import {motionEndpoint,motionCurve} from './motionScene';
import {bezierControls} from './edgeRouting';

test('GPU camera scene uses measured original handle edges, including paired ports',()=>{
 const node={id:'display',position:{x:0,y:0},internals:{positionAbsolute:{x:800,y:1200},handleBounds:{source:[{id:'source:link',x:296.5,y:27,width:7,height:7,position:'right'}],target:[{id:'target:link',x:-3.5,y:120,width:7,height:7,position:'left'}]}}};
 assert.deepEqual(motionEndpoint(node,'source','source:link'),[1103.5,1230.5]);
 assert.deepEqual(motionEndpoint(node,'target','target:link'),[796.5,1323.5]);
 assert.deepEqual(motionEndpoint(node,'source'),[950,1360]);
});
test('long curves are retained in full and meet the original cubic midpoint',()=>{
 const source:[number,number]=[-5000,150],target:[number,number]=[6000,400];
 const data={sourceSide:'right' as const,targetSide:'left' as const,parallelIndex:2,dashed:false};
 const points=motionCurve(source,target,data),c=bezierControls({...data,source,target});
 assert.deepEqual(points[0],source);assert.deepEqual(points.at(-1),target);
 for(const axis of [0,1])assert.ok(Math.abs(points[32]![axis]!-(c[0][axis]!+3*c[1][axis]!+3*c[2][axis]!+c[3][axis]!)/8)<1e-9);
 assert.ok(points.every(p=>p.every(Number.isFinite)));
});
