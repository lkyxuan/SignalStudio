// A cached scene for camera motion. Text/card surfaces are rasterized once;
// changing the camera submits one GPU batch, with no DOM layout or text shaping.
export type Camera = [number,number,number];
type Color = [number,number,number,number];
type Tile = {x:number;y:number;width:number;height:number};
export class GPUScene {
  gl:WebGLRenderingContext;
  atlas=document.createElement('canvas');
  ctx:CanvasRenderingContext2D;
  vertices:number[]=[];
  buffer:WebGLBuffer; texture:WebGLTexture; program:WebGLProgram;
  private penX=12; private penY=12; private rowHeight=0; private usedHeight=1;
  private atlasSize=4096;
  private count=0;
  private items:{id:string;start:number;end:number}[]=[];
  private floats=new Float32Array();private base=new Float32Array();private opacityKey='';
  beginItem(id:string){if(this.items.length)this.items.at(-1)!.end=this.vertices.length;this.items.push({id,start:this.vertices.length,end:0});}
  setOpacity(values:Map<string,number>){
    const key=JSON.stringify([...values]);if(key===this.opacityKey)return;this.opacityKey=key;
    for(const item of this.items){const a=values.get(item.id)??1;for(let p=item.start;p<item.end;p+=11)for(let c=4;c<8;c++)this.floats[p+c]=this.base[p+c]!*a;}
    const gl=this.gl;gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.floats);
  }
  constructor(private canvas:HTMLCanvasElement) {
    const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:false,depth:false,stencil:false,powerPreference:'high-performance'});
    if(!gl) throw new Error('WebGL unavailable');
    this.gl=gl;
    this.atlasSize=Math.min(4096,gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.atlas.width=this.atlasSize;
    this.atlas.height=this.atlas.width;
    this.ctx=this.atlas.getContext('2d')!;
    this.ctx.fillStyle='white'; this.ctx.fillRect(0,0,8,8);
    const shader=(type:number,source:string)=>{
      const s=gl.createShader(type)!; gl.shaderSource(s,source);gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) { const error=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(error||'Shader compilation failed'); }
      return s;
    };
    const vs=shader(gl.VERTEX_SHADER,`attribute vec2 position;attribute vec2 uv;attribute vec4 color;attribute vec3 dash;
      uniform vec3 camera;uniform vec2 resolution;varying vec2 vUV;varying vec4 vColor;varying vec3 vDash;
      void main(){vec2 pixel=position*camera.z+camera.xy;gl_Position=vec4(pixel/resolution*vec2(2.,-2.)+vec2(-1.,1.),0.,1.);vUV=uv;vColor=color;vDash=vec3(dash.xy,camera.z<.45?dash.z:0.);}`);
    const fs=shader(gl.FRAGMENT_SHADER,`precision mediump float;uniform sampler2D image;varying vec2 vUV;varying vec4 vColor;varying vec3 vDash;
      void main(){if(vDash.z>.5 || (vDash.y>.5 && mod(vDash.x,10.)>6.))discard;gl_FragColor=texture2D(image,vUV)*vColor;}`);
    this.program=gl.createProgram()!;gl.attachShader(this.program,vs);gl.attachShader(this.program,fs);gl.linkProgram(this.program);
    gl.deleteShader(vs);gl.deleteShader(fs);
    if(!gl.getProgramParameter(this.program,gl.LINK_STATUS)) throw new Error('GPU program linking failed');
    this.buffer=gl.createBuffer()!;this.texture=gl.createTexture()!;
  }
  resetAtlas(){this.vertices=[];this.items=[];this.penX=12;this.penY=12;this.rowHeight=0;this.usedHeight=1;this.opacityKey='';this.atlas.width=this.atlas.height=this.atlasSize;this.ctx.fillStyle='white';this.ctx.fillRect(0,0,8,8);}
  tile(width:number,height:number,paint:(ctx:CanvasRenderingContext2D)=>void):Tile {
    const max=this.atlas.width;
    if(this.penX+width+2>max) {this.penX=12;this.penY+=this.rowHeight+4;this.rowHeight=0;}
    if(this.penY+height+2>max) throw new Error('Motion texture capacity exceeded');
    const t={x:this.penX,y:this.penY,width,height};
    this.ctx.save();this.ctx.translate(t.x,t.y);this.ctx.beginPath();this.ctx.rect(0,0,width,height);this.ctx.clip();paint(this.ctx);this.ctx.restore();
    this.penX+=width+4;this.rowHeight=Math.max(this.rowHeight,height);this.usedHeight=Math.max(this.usedHeight,this.penY+height+2);
    return t;
  }
  private vertex(x:number,y:number,u:number,v:number,color:Color,distance=0,dashed=0,detail=0) {this.vertices.push(x,y,u,v,...color,distance,dashed,detail);}
  quad(x:number,y:number,width:number,height:number,color:Color,tile?:Tile,detail=false) {
    const t=tile??{x:3,y:3,width:1,height:1}, a=this.atlas.width;
    for(const [dx,dy] of [[0,0],[1,0],[1,1],[0,0],[1,1],[0,1]])this.vertex(x+dx!*width,y+dy!*height,(t.x+dx!*t.width)/a,(t.y+dy!*t.height)/a,color,0,0,+detail);
  }
  line(points:[number,number][],width:number,color:Color,dashed:boolean) {
    let distance=0;const uv=4/this.atlas.width;
    for(let i=1;i<points.length;i++) {
      const a=points[i-1]!,b=points[i]!,dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);
      if(!length)continue;
      const nx=-dy/length*width/2,ny=dx/length*width/2;
      const corners=[[a[0]+nx,a[1]+ny,distance],[b[0]+nx,b[1]+ny,distance+length],[b[0]-nx,b[1]-ny,distance+length],[a[0]-nx,a[1]-ny,distance]];
      for(const index of [0,1,2,0,2,3]){const p=corners[index]!;this.vertex(p[0]!,p[1]!,uv,uv,color,p[2],+dashed);}
      distance+=length;
    }
  }
  arrow(tip:[number,number],from:[number,number],color:Color) {
    const dx=tip[0]-from[0],dy=tip[1]-from[1],len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len,uv=4/this.atlas.width;
    for(const [x,y] of [tip,[tip[0]-ux*12-uy*5,tip[1]-uy*12+ux*5],[tip[0]-ux*12+uy*5,tip[1]-uy*12-ux*5]])this.vertex(x!,y!,uv,uv,color,0,0,1);
  }
  upload() {
    const gl=this.gl;
    gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);this.floats=new Float32Array(this.vertices);this.base=this.floats.slice();if(this.items.length)this.items.at(-1)!.end=this.vertices.length;gl.bufferData(gl.ARRAY_BUFFER,this.floats,gl.DYNAMIC_DRAW);this.count=this.vertices.length/11;this.vertices=[];
    gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,this.atlas);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    if(gl.getError()!==gl.NO_ERROR)throw new Error('Motion scene upload failed');
    // Release CPU backing pixels; the GPU owns the uploaded atlas until dispose.
    this.atlas.width=this.atlas.height=1;
  }
  draw(camera:Camera,width:number,height:number) {
    const gl=this.gl,dpr=Math.min(window.devicePixelRatio||1,2);
    if(this.canvas.width!==Math.round(width*dpr)||this.canvas.height!==Math.round(height*dpr)){this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);}
    gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bindTexture(gl.TEXTURE_2D,this.texture);
    for(const [name,size,offset] of [['position',2,0],['uv',2,8],['color',4,16],['dash',3,32]] as const){const loc=gl.getAttribLocation(this.program,name);gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,44,offset);}
    gl.uniform3f(gl.getUniformLocation(this.program,'camera'),...camera);gl.uniform2f(gl.getUniformLocation(this.program,'resolution'),width,height);
    gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.drawArrays(gl.TRIANGLES,0,this.count);
  }
  dispose() {const gl=this.gl;gl.deleteTexture(this.texture);gl.deleteBuffer(this.buffer);gl.deleteProgram(this.program);this.atlas.width=this.atlas.height=1;}
}
export type {Color};
