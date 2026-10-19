import test from 'node:test';
import assert from 'node:assert/strict';
import { arcBounds, canvasRenderMode, CARD_DETAIL_ZOOM, frameThrottle, inCanvasView } from './canvasViewport';
import { bezierControls, type RouteLink } from './edgeRouting';
const view={transform:[0,0,1] as [number,number,number],width:800,height:600};
test('full-map zoom mounts summaries; panning and zooming only detail visible cards without changing geometry',()=>{
  const card={x:100,y:100,width:300,height:160};
  const far={...card,x:5000};
  const before=JSON.stringify([card,far]);
  assert.equal(canvasRenderMode(card,{...view,transform:[0,0,.03]}),'overview');
  assert.equal(canvasRenderMode(card,{...view,transform:[0,0,CARD_DETAIL_ZOOM-.001]}),'overview');
  assert.equal(canvasRenderMode(card,{...view,transform:[0,0,CARD_DETAIL_ZOOM]}),'detail');
  assert.equal(canvasRenderMode(far,view),'hidden');
  assert.equal(canvasRenderMode(far,{...view,transform:[-5000,0,1]}),'detail');
  assert.equal(canvasRenderMode(card,{...view,transform:[-5000,0,1]}),'hidden');
  assert.equal(canvasRenderMode(far,{...view,width:0,height:0}),'overview');
  assert.equal(JSON.stringify([card,far]),before);
});
test('viewport culling handles zoom, overscan, crossing rectangles and unknown first measurements',()=>{
  assert.equal(inCanvasView({x:900,y:100,width:50,height:50},view),true);
  assert.equal(inCanvasView({x:1200,y:100,width:50,height:50},view),false);
  assert.equal(inCanvasView({x:-1000,y:100,width:2000,height:50},view),true);
  assert.equal(inCanvasView({x:1200,y:100,width:50,height:50},{...view,transform:[-600,0,.5]}),true);
  assert.equal(inCanvasView({x:1200,y:100,width:50,height:50},{...view,width:0}),true);
});
test('long bowed edge stays visible when its endpoints are outside the viewport',()=>{
  const link:RouteLink={source:[-50,-1000],target:[-50,2000],sourceSide:'normal',targetSide:'normal',parallelIndex:0,dashed:false};
  assert.equal(inCanvasView({x:-50,y:-1000,width:0,height:3000},view,0),false);
  assert.equal(inCanvasView(arcBounds(link,'long connection'),view,0),true);
  const invisible={...link,source:[-5000,-1000] as [number,number],target:[-5000,2000] as [number,number]};
  assert.equal(inCanvasView(arcBounds(invisible),view),false);
});
test('curve bounds enclose sampled forward, reverse and parallel cubic routes, including labels',()=>{
  for(const sourceSide of ['normal','left','right'] as const)for(const targetSide of ['normal','left','right'] as const)for(const direction of [-1,1]) {
    const link:RouteLink={source:[100,200],target:[700,200+direction*1500],sourceSide,targetSide,parallelIndex:3,dashed:false};
    const bounds=arcBounds(link,'说明 · 返回数据'),p=bezierControls(link);
    for(let i=0;i<=100;i++) {
      const t=i/100,u=1-t;
      for(const axis of [0,1] as const) {
        const v=u*u*u*p[0][axis]+3*u*u*t*p[1][axis]+3*u*t*t*p[2][axis]+t*t*t*p[3][axis];
        assert.ok(v>=(axis?bounds.y:bounds.x)&&v<=(axis?bounds.y+bounds.height:bounds.x+bounds.width));
      }
    }
  }
});
test('minimap coalesces motion updates, flushes the final viewport and cancels on cleanup', t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let current=0,drawn=-1,calls=0;
  const throttled=frameThrottle(()=>{drawn=current;calls++;});
  for(let i=1;i<=60;i++){current=i;throttled.request();}
  t.mock.timers.tick(119);assert.equal(calls,0);
  t.mock.timers.tick(1);assert.equal(calls,1);assert.equal(drawn,60);
  current=61;throttled.request();throttled.flush();assert.equal(drawn,61);
  t.mock.timers.tick(120);assert.equal(calls,2);
  throttled.request();throttled.cancel();t.mock.timers.tick(120);assert.equal(calls,2);
});
