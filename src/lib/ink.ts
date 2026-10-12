import type { BoardObject, Point } from '../types';

const coordinate = (value:number) => String(Math.round(value * 1000) / 1000);
const pair = (point:Point) => point.map(coordinate).join(' ');
export const distance = (a:Point,b:Point) => Math.hypot(a[0]-b[0],a[1]-b[1]);

// This is the distance-based resampling and Gaussian smoothing from the user's
// JavaScript course. Original pointer samples are retained separately in points.
export function smoothStrokePoints(points:Point[],smoothingScale=1):Point[] {
  if (points.length < 3) return points;
  const lengths = points.slice(1).map((p,i) => distance(p,points[i]));
  const total = lengths.reduce((sum,length) => sum+length,0);
  if (total*smoothingScale < 3) return points;
  // Do not lower sampling resolution as a stroke grows: that erases small hooks
  // near the end of long handwriting. Sparse very long jumps retain their source
  // vertices without allocating millions of interpolated samples.
  const steps = Math.min(Math.max(4095,points.length*8),Math.ceil(total*smoothingScale/1.25));
  const spacing = total/steps, samples:Point[] = [points[0]];
  let segment = 0, traveled = 0;
  for (let i=1;i<steps;i++) {
    const d=i*spacing;
    while (segment<lengths.length-1 && traveled+lengths[segment]<d) traveled+=lengths[segment++];
    const fraction=lengths[segment] ? (d-traveled)/lengths[segment] : 0;
    samples.push([points[segment][0]+(points[segment+1][0]-points[segment][0])*fraction,points[segment][1]+(points[segment+1][1]-points[segment][1])*fraction]);
  }
  samples.push(points[points.length-1]);
  const sigma=2.25/smoothingScale,radius=Math.ceil(3*sigma/spacing);
  const weights=Array.from({length:radius*2+1},(_,i)=>Math.exp(-.5*((i-radius)*spacing/sigma)**2));
  return samples.map((point,i) => {
    if(i===0 || i===steps) return point;
    let x=0,y=0,weight=0;
    for(let offset=-radius;offset<=radius;offset++) {
      const index=i+offset;
      if(index<0 || index>steps) continue;
      const w=weights[offset+radius];
      x+=samples[index][0]*w;y+=samples[index][1]*w;weight+=w;
    }
    return [x/weight,y/weight];
  });
}

export function smoothStrokePath(source:Point[],smoothingScale=1):string {
  if(!source.length) return '';
  const points=smoothStrokePoints(source,smoothingScale);
  let path=`M ${pair(points[0])}`;
  if(points.length===1) return `${path} l 0.01 0`;
  for(let i=1;i<points.length-1;i++) {
    const current=points[i],next=points[i+1];
    path+=` Q ${pair(current)} ${pair([(current[0]+next[0])/2,(current[1]+next[1])/2])}`;
  }
  return `${path} L ${pair(points[points.length-1])}`;
}

export function rawStrokePath(points:Point[]):string {
  if(!points.length) return '';
  return `M ${pair(points[0])}`+(points.length===1?' l 0.01 0':points.slice(1).map(p=>` L ${pair(p)}`).join(''));
}
export const strokePath=(points:Point[],smoothing:'course'|'raw'='course',smoothingScale=1)=>smoothing==='course'?smoothStrokePath(points,smoothingScale):rawStrokePath(points);
export function createStroke(points:Point[],options:Partial<BoardObject>={}):BoardObject {
  const source=points.length?points:[[0,0] as Point];
  let x=Infinity,y=Infinity,right=-Infinity,bottom=-Infinity;
  for(const p of source){x=Math.min(x,p[0]);y=Math.min(y,p[1]);right=Math.max(right,p[0]);bottom=Math.max(bottom,p[1]);}
  const local:Point[]=source.map(p=>[p[0]-x,p[1]-y]);
  const smoothing=options.smoothing??'course',smoothingScale=options.smoothingScale??1;
  return {...options,id:options.id??crypto.randomUUID(),type:options.type??'stroke',x,y,width:right-x,height:bottom-y,color:options.color??'#172137',strokeWidth:options.strokeWidth??3,opacity:options.opacity??1,smoothing,smoothingScale,points:local,path:strokePath(local,smoothing,smoothingScale)};
}

type InkPathCommand={command:string;values:number[]};
function parseInkPath(path:string):InkPathCommand[]|undefined {
  const tokens=path.match(/[a-zA-Z]|[+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?/g)??[];
  const commands:InkPathCommand[]=[];let index=0;
  while(index<tokens.length){
    const command=tokens[index++];if(!/^[MmLlQq]$/.test(command))return undefined;
    const count=command.toLowerCase()==='q'?4:2,values=tokens.slice(index,index+count).map(Number);
    if(values.length!==count||values.some(v=>!Number.isFinite(v)))return undefined;
    commands.push({command,values});index+=count;
  }
  return commands;
}
export function scaleStrokePath(path:string,sx:number,sy:number):string|undefined {
  return parseInkPath(path)?.map(({command,values})=>`${command} ${values.map((value,i)=>coordinate(value*(i%2?sy:sx))).join(' ')}`).join(' ');
}
export function inkPathPoints(path:string,tolerance=.1):Point[]|undefined {
  const commands=parseInkPath(path);if(!commands)return undefined;
  let current:Point=[0,0];const points:Point[]=[];
  for(const {command,values} of commands){
    const relative=command===command.toLowerCase(),point=(i:number):Point=>[values[i]+(relative?current[0]:0),values[i+1]+(relative?current[1]:0)];
    if(command.toLowerCase()==='q'){
      const control=point(0),end=point(2),start=current;
      const bend=Math.hypot(start[0]-2*control[0]+end[0],start[1]-2*control[1]+end[1])/4;
      const steps=Math.max(1,Math.min(64,Math.ceil(Math.sqrt(bend/Math.max(.001,tolerance)))));
      for(let i=1;i<=steps;i++){const t=i/steps,u=1-t;points.push([u*u*start[0]+2*u*t*control[0]+t*t*end[0],u*u*start[1]+2*u*t*control[1]+t*t*end[1]]);}
      current=end;
    }else{current=point(0);points.push(current);}
  }
  return points;
}

export function localPoint(object:BoardObject,p:Point):Point {
  const x=p[0]-object.x-object.width/2,y=p[1]-object.y-object.height/2;
  const angle=-(object.rotation??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return [x*c-y*s+object.width/2,x*s+y*c+object.height/2];
}
export function worldPoint(object:BoardObject,p:Point):Point {
  const x=p[0]-object.width/2,y=p[1]-object.height/2;
  const angle=(object.rotation??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle);
  return [x*c-y*s+object.width/2+object.x,x*s+y*c+object.height/2+object.y];
}
export function objectBounds(object:BoardObject) {
  const corners:Point[]=[[0,0],[object.width,0],[object.width,object.height],[0,object.height]].map(p=>worldPoint(object,p as Point));
  const x=Math.min(...corners.map(p=>p[0])),y=Math.min(...corners.map(p=>p[1]));
  return {x,y,width:Math.max(...corners.map(p=>p[0]))-x,height:Math.max(...corners.map(p=>p[1]))-y};
}
export function distanceToSegment(p:Point,a:Point,b:Point):number {
  const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
  const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
  return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dy*t);
}
function segmentDistance(a:Point,b:Point,c:Point,d:Point):number {
  const cross=(u:Point,v:Point)=>u[0]*v[1]-u[1]*v[0];
  const sub=(u:Point,v:Point):Point=>[u[0]-v[0],u[1]-v[1]];
  const r=sub(b,a),s=sub(d,c),den=cross(r,s);
  if(Math.abs(den)>1e-10){const t=cross(sub(c,a),s)/den,u=cross(sub(c,a),r)/den;if(t>=0&&t<=1&&u>=0&&u<=1)return 0;}
  return Math.min(distanceToSegment(a,c,d),distanceToSegment(b,c,d),distanceToSegment(c,a,b),distanceToSegment(d,a,b));
}
const outlineCache=new WeakMap<BoardObject,Point[]>();
export function objectPolyline(object:BoardObject):Point[] {
  const cached=outlineCache.get(object);if(cached)return cached;
  const store=(points:Point[])=>{outlineCache.set(object,points);return points;};
  if(object.points?.length){
    const local=object.smoothing==='raw'?object.points:(object.path?inkPathPoints(object.path,.1/(object.smoothingScale??1)):undefined)??smoothStrokePoints(object.points,object.smoothingScale);
    return store(local.map(p=>worldPoint(object,p)));
  }
  if(object.type==='line'||object.type==='arrow') return [worldPoint(object,[0,0]),worldPoint(object,[object.width,object.height])];
  if(object.type==='ellipse') return Array.from({length:49},(_,i)=>worldPoint(object,[object.width/2+Math.cos(i/48*Math.PI*2)*object.width/2,object.height/2+Math.sin(i/48*Math.PI*2)*object.height/2]));
  return ([[0,0],[object.width,0],[object.width,object.height],[0,object.height],[0,0]] as Point[]).map(p=>worldPoint(object,p));
}
export function hitTestObject(object:BoardObject,p:Point,tolerance=5):boolean {
  const local=localPoint(object,p),pad=tolerance+object.strokeWidth/2;
  if(local[0]<-pad||local[1]<-pad||local[0]>object.width+pad||local[1]>object.height+pad)return false;
  if(['text','note','image','link'].includes(object.type)||object.fill&&object.fill!=='none') return true;
  const points=objectPolyline(object);
  if(points.length===1)return distance(points[0],p)<=pad;
  return points.slice(1).some((point,i)=>distanceToSegment(p,points[i],point)<=pad);
}
export function pointInPolygon(p:Point,polygon:Point[]):boolean {
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];
    if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}
export function objectIntersectsPolygon(object:BoardObject,polygon:Point[]):boolean {
  if(polygon.length<3)return false;
  const points=objectPolyline(object);
  if(points.some(p=>pointInPolygon(p,polygon)))return true;
  if(polygon.some(p=>hitTestObject(object,p,0)))return true;
  for(let i=1;i<points.length;i++)for(let j=0;j<polygon.length;j++){
    if(segmentDistance(points[i-1],points[i],polygon[j],polygon[(j+1)%polygon.length])<=object.strokeWidth/2)return true;
  }
  return false;
}

// Return the portions of segment AB inside the swept eraser capsule CD.
// Analytic intervals prevent a fast eraser movement from jumping over ink.
function capsuleIntervals(a:Point,b:Point,c:Point,d:Point,r:number):Array<[number,number]> {
  const intervals:Array<[number,number]>=[],vx=b[0]-a[0],vy=b[1]-a[1],v2=vx*vx+vy*vy;
  if(v2<1e-12)return distanceToSegment(a,c,d)<=r?[[0,1]]:[];
  for(const center of [c,d]){
    const ox=a[0]-center[0],oy=a[1]-center[1],bb=2*(ox*vx+oy*vy),cc=ox*ox+oy*oy-r*r,disc=bb*bb-4*v2*cc;
    if(disc>=0){const root=Math.sqrt(disc);const lo=Math.max(0,(-bb-root)/(2*v2)),hi=Math.min(1,(-bb+root)/(2*v2));if(lo<=hi)intervals.push([lo,hi]);}
  }
  const ex=d[0]-c[0],ey=d[1]-c[1],length=Math.hypot(ex,ey);
  if(length>1e-9){
    let low=0,high=1;
    const clip=(value:number,slope:number,min:number,max:number)=>{
      if(Math.abs(slope)<1e-12){if(value<min||value>max){low=1;high=0;}return;}
      const p=(min-value)/slope,q=(max-value)/slope;low=Math.max(low,Math.min(p,q));high=Math.min(high,Math.max(p,q));
    };
    clip(((a[0]-c[0])*ex+(a[1]-c[1])*ey)/length,(vx*ex+vy*ey)/length,0,length);
    clip((-(a[0]-c[0])*ey+(a[1]-c[1])*ex)/length,(-vx*ey+vy*ex)/length,-r,r);
    if(low<=high)intervals.push([low,high]);
  }
  intervals.sort((a,b)=>a[0]-b[0]);
  const merged:Array<[number,number]>=[];
  for(const interval of intervals){const last=merged[merged.length-1];if(last&&last[1]>=interval[0]-1e-9)last[1]=Math.max(last[1],interval[1]);else merged.push([...interval]);}
  return merged;
}

export function splitPolyline(points:Point[],from:Point,to:Point,radius:number):Point[][] {
  if(points.length===1)return distanceToSegment(points[0],from,to)>radius?[points]:[];
  const fragments:Point[][]=[];let current:Point[]=[];
  const finish=()=>{if(current.length)fragments.push(current);current=[];};
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],intervals=capsuleIntervals(a,b,from,to,radius);
    const at=(t:number):Point=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];
    let cursor=0;
    for(const [lo,hi] of intervals){
      if(lo>cursor+1e-8){if(!current.length)current.push(at(cursor));current.push(at(lo));}
      finish();cursor=Math.max(cursor,hi);
    }
    if(cursor<1-1e-8){if(!current.length)current.push(at(cursor));current.push(b);}else finish();
  }
  finish();return fragments;
}
export function eraseObjects(objects:BoardObject[],from:Point,to:Point,radius:number,mode:'stroke'|'precision'):BoardObject[] {
  const result:BoardObject[]=[];
  for(const object of objects){
    if(object.locked){result.push(object);continue;}
    const bounds=objectBounds(object),pad=radius+object.strokeWidth/2;
    if(Math.max(from[0],to[0])+pad<bounds.x||Math.min(from[0],to[0])-pad>bounds.x+bounds.width||Math.max(from[1],to[1])+pad<bounds.y||Math.min(from[1],to[1])-pad>bounds.y+bounds.height){result.push(object);continue;}
    const points=objectPolyline(object);
    const hit=(points.length===1?distanceToSegment(points[0],from,to)<=pad:points.slice(1).some((p,i)=>segmentDistance(points[i],p,from,to)<=pad))||hitTestObject(object,from,radius)||hitTestObject(object,to,radius);
    if(!hit){result.push(object);continue;}
    if(mode==='precision'&&(object.type==='stroke'||object.type==='highlight')&&object.points?.length){
      const pieces=splitPolyline(points,from,to,pad);
      for(const piece of pieces)if(piece.length)result.push(createStroke(piece,{...object,id:crypto.randomUUID(),rotation:0,smoothing:'raw'}));
    }
  }
  return result;
}

export function resizeObject(object:BoardObject,sx:number,sy:number,origin:Point):BoardObject {
  const next={...object,x:origin[0]+(object.x-origin[0])*sx,y:origin[1]+(object.y-origin[1])*sy,width:object.width*sx,height:object.height*sy};
  if(object.points){next.points=object.points.map(p=>[p[0]*sx,p[1]*sy]);const oldPath=object.path??strokePath(object.points,object.smoothing,object.smoothingScale);next.path=scaleStrokePath(oldPath,sx,sy)??strokePath(next.points,object.smoothing,object.smoothingScale);}
  if(object.fontSize)next.fontSize=Math.max(1,Math.min(10_000,object.fontSize*Math.min(sx,sy)));
  if(['text','note','link'].includes(object.type)){
    const padding=object.type==='note'?12:0,size=next.fontSize??20;
    next.width=Math.max(padding*2+1,next.width);
    const lines=wrapText(object.text??'',next.width,size,padding,object.bold);
    next.height=Math.max(next.height,padding*2+size+Math.max(0,lines.length-1)*size*1.3);
  }
  return next;
}
export function resizeFactors(bounds:{width:number;height:number},start:Point,current:Point):Point {
  // The handle has a screen-sized hit area. Scale by pointer displacement, not
  // its absolute position, so grabbing either edge of the handle never jumps.
  return [Math.max(.02,1+(current[0]-start[0])/Math.max(1,bounds.width)),Math.max(.02,1+(current[1]-start[1])/Math.max(1,bounds.height))];
}

let textContext:CanvasRenderingContext2D|null|undefined;
function measureText(text:string,fontSize:number,bold:boolean){
  if(textContext===undefined&&typeof document!=='undefined')textContext=document.createElement('canvas').getContext('2d');
  if(textContext){textContext.font=`${bold?'bold ':''}${fontSize}px Arial, sans-serif`;return textContext.measureText(text).width;}
  return Array.from(text).length*fontSize*.55;
}
export function textIsRtl(text:string):boolean {
  const strong=text.match(/[A-Za-z\u00C0-\u02AF\u0590-\u08FF\u200E\u200F\u2E80-\u9FFF]/)?.[0];
  return !!strong&&/[\u0590-\u08FF\u200F]/.test(strong);
}
const graphemes=(text:string):string[]=>{
  const Segmenter=(Intl as unknown as {Segmenter?:new(locales?:string|string[],options?:{granularity:string})=>{segment:(text:string)=>Iterable<{segment:string}>}}).Segmenter;
  return Segmenter?Array.from(new Segmenter(undefined,{granularity:'grapheme'}).segment(text),part=>part.segment):Array.from(text);
};
// Live rendering and export use the same browser font metrics and wrapping.
export function wrapText(text:string,width:number,fontSize:number,padding=0,bold=false):string[] {
  const maxWidth=Math.max(1,width-padding*2);
  return text.split('\n').flatMap(paragraph=>{
    if(!paragraph)return [''];
    const lines:string[]=[];let line='';
    for(const word of paragraph.split(/\s+/)){
      if(line&&measureText(line+' '+word,fontSize,bold)>maxWidth){lines.push(line);line='';}
      if(measureText(word,fontSize,bold)>maxWidth){if(line){lines.push(line);line='';}for(const glyph of graphemes(word)){if(line&&measureText(line+glyph,fontSize,bold)>maxWidth){lines.push(line);line='';}line+=glyph;}}
      else line+=(line?' ':'')+word;
    }
    if(line)lines.push(line);return lines;
  });
}
