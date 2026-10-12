import React,{memo,useCallback,useEffect,useId,useRef,useState} from 'react';
import type {BoardObject,BoardPage,Point,Tool,ToolSettings,View} from '../types';
import {getAsset} from '../lib/storage';
import {createStroke,distance,eraseObjects,hitTestObject,objectBounds,objectIntersectsPolygon,resizeFactors,resizeObject,strokePath,textIsRtl,wrapText} from '../lib/ink';

export interface SurfaceGesture {
  pointerType:string;
  navigation:boolean;
  cancel:()=>void;
}

export interface DrawingSurfaceProps {
  page:BoardPage;settings:ToolSettings;view:View;onViewChange:(view:View)=>void;
  onChange:(objects:BoardObject[])=>void;selectedIds:string[];onSelectionChange:(ids:string[])=>void;
  onEditText:(object:BoardObject)=>void;onInsertText:(point:Point,type:'text'|'note')=>void;
  children?:React.ReactNode;onContextMenu?:(event:React.MouseEvent,point:Point)=>void;
  onGestureState?:(active:boolean,gesture?:SurfaceGesture)=>void;
  onToolChange?:(tool:Tool)=>void;
  onScroll?:(dx:number,dy:number)=>void;
  onActivate?:()=>void;
}

function ImageObject({object}:{object:BoardObject}){
  const [url,setUrl]=useState('');
  useEffect(()=>{let live=true,created='';setUrl('');if(object.assetId)getAsset(object.assetId).then(asset=>{if(live&&asset){created=URL.createObjectURL(asset.blob);setUrl(created);}}).catch(()=>{});return()=>{live=false;if(created)URL.revokeObjectURL(created);};},[object.assetId]);
  return url?<image href={url} width={object.width} height={object.height} preserveAspectRatio="none"/>:<rect width={object.width} height={object.height} fill="#e9edf2" stroke="#a4afbd"/>;
}
export const BoardObjectView=memo(function BoardObjectView({object}:{object:BoardObject}){
  const o=object,w=o.width,h=o.height;
  const shared={stroke:o.color,strokeWidth:o.strokeWidth,fill:o.fill??'none',strokeLinecap:'round' as const,strokeLinejoin:'round' as const};
  let content:React.ReactNode;
  if(o.type==='stroke'||o.type==='highlight')content=<path {...shared} fill="none" d={o.path??strokePath(o.points??[],o.smoothing,o.smoothingScale)}/>;
  else if(o.type==='image')content=<ImageObject object={o}/>;
  else if(o.type==='ellipse')content=<ellipse {...shared} cx={w/2} cy={h/2} rx={w/2} ry={h/2}/>;
  else if(o.type==='rect')content=<rect {...shared} width={w} height={h}/>;
  else if(o.type==='line'||o.type==='arrow'){
    const start=o.points?.[0]??[0,0],end=o.points?.[o.points.length-1]??[w,h];
    const angle=Math.atan2(end[1]-start[1],end[0]-start[0]),head=Math.max(12,o.strokeWidth*4);
    content=<><line {...shared} x1={start[0]} y1={start[1]} x2={end[0]} y2={end[1]}/>{o.type==='arrow'&&<path {...shared} fill="none" d={`M ${end[0]-head*Math.cos(angle-Math.PI/6)} ${end[1]-head*Math.sin(angle-Math.PI/6)} L ${end[0]} ${end[1]} L ${end[0]-head*Math.cos(angle+Math.PI/6)} ${end[1]-head*Math.sin(angle+Math.PI/6)}`}/>}</>;
  }else{
    const size=o.fontSize??20,padding=o.type==='note'?12:0,lines=wrapText(o.text??'',w,size,padding,o.bold);
    content=<>{o.type==='note'&&<rect width={w} height={h} rx={10} fill={o.fill??'#fff2ae'} stroke="none"/>}<text fill={o.color} fontFamily="Arial, sans-serif" fontSize={size} fontWeight={o.bold?700:400} textDecoration={o.type==='link'?'underline':undefined}>
      {lines.map((line,i)=><tspan key={i} x={textIsRtl(line)?w-padding:padding} y={padding+size+i*size*1.3} direction={textIsRtl(line)?'rtl':'ltr'} textAnchor="start" unicodeBidi="plaintext">{line||'\u00a0'}</tspan>)}
    </text></>;
  }
  return <g data-object-id={o.id} transform={`translate(${o.x} ${o.y}) rotate(${o.rotation??0} ${w/2} ${h/2})`} opacity={o.opacity}>{content}</g>;
});
const ObjectLayer=memo(function ObjectLayer({objects}:{objects:BoardObject[]}){
  return <>{objects.map(object=><BoardObjectView key={object.id} object={object}/>)}</>;
});

type Gesture={kind:'ink'|'shape'|'erase'|'move'|'resize'|'box'|'pan';id:string;pageId:string;pointerId:number;pointerType:string;start:Point;last:Point;points:Point[];objects:BoardObject[];baseObjects:BoardObject[];settings:ToolSettings;view:View;selected:string[];bounds?:{x:number;y:number;width:number;height:number};changed:boolean;rendered?:{count:number;object:BoardObject}};
type Pinch={distance:number;zoom:number;anchor:Point;last:Point};
const clampZoom=(z:number)=>Math.max(.01,Math.min(8,z));
function selectionBounds(objects:BoardObject[],ids:string[]){
  if(!ids.length)return undefined;
  const selected=objects.filter(o=>ids.includes(o.id));if(!selected.length)return undefined;
  const boxes=selected.map(objectBounds),x=Math.min(...boxes.map(b=>b.x)),y=Math.min(...boxes.map(b=>b.y));
  return {x,y,width:Math.max(...boxes.map(b=>b.x+b.width))-x,height:Math.max(...boxes.map(b=>b.y+b.height))-y};
}
function shapeObject(g:Gesture):BoardObject{
  const x=Math.min(g.start[0],g.last[0]),y=Math.min(g.start[1],g.last[1]),width=Math.abs(g.last[0]-g.start[0]),height=Math.abs(g.last[1]-g.start[1]);
  return {id:'preview-shape',type:g.settings.tool as 'rect'|'ellipse'|'line'|'arrow',x,y,width,height,color:g.settings.color,strokeWidth:g.settings.width,opacity:1,points:g.settings.tool==='line'||g.settings.tool==='arrow'?[[g.start[0]-x,g.start[1]-y],[g.last[0]-x,g.last[1]-y]]:undefined};
}
function strokeObject(g:Gesture):BoardObject{
  if(g.rendered?.count===g.points.length)return g.rendered.object;
  const object=createStroke(g.points,{id:g.id,type:g.settings.tool==='highlighter'?'highlight':'stroke',color:g.settings.color,strokeWidth:g.settings.tool==='highlighter'?g.settings.width*4:g.settings.width,opacity:g.settings.tool==='highlighter'?.28:1,smoothing:g.settings.smoothing,smoothingScale:g.view.zoom});
  g.rendered={count:g.points.length,object};return object;
}

export function DrawingSurface(props:DrawingSurfaceProps){
  const {page,settings,view,selectedIds,children}=props;
  const infinite=page.pdfPageIndex===undefined;
  const latest=useRef(props);latest.current=props;
  const root=useRef<HTMLDivElement>(null),activePath=useRef<SVGPathElement>(null),laserGroup=useRef<SVGGElement>(null);
  const gesture=useRef<Gesture|null>(null),pointers=useRef(new Map<number,Point>()),pinch=useRef<Pinch|null>(null),frame=useRef<number|undefined>(undefined);
  const viewRef=useRef(view);viewRef.current=view;
  const [preview,setPreview]=useState<BoardObject[]|null>(null),[shape,setShape]=useState<BoardObject|null>(null),[marquee,setMarquee]=useState<Point[]|null>(null);
  const [panning,setPanning]=useState(false);
  const patternId=useId().replace(/:/g,'');
  const clientPoint=(clientX:number,clientY:number):Point=>{const r=root.current!.getBoundingClientRect();return[clientX-r.left,clientY-r.top];};
  // Reader pages move underneath the pointer as their scroll container moves.
  const navigationPoint=(clientX:number,clientY:number):Point=>latest.current.onScroll?[clientX,clientY]:clientPoint(clientX,clientY);
  const toPage=(clientX:number,clientY:number):Point=>{const p=clientPoint(clientX,clientY),v=viewRef.current;return[(p[0]-v.x)/v.zoom,(p[1]-v.y)/v.zoom];};
  const changeView=(next:View)=>{viewRef.current=next;latest.current.onViewChange(next);};
  const clearPreview=()=>{if(frame.current!==undefined)cancelAnimationFrame(frame.current);frame.current=undefined;activePath.current?.setAttribute('d','');setPreview(null);setShape(null);setMarquee(null);setPanning(false);};
  const cancel=useCallback((preserveCapturedInk=false):void=>{const g=gesture.current,current=latest.current,wasPinching=!!pinch.current,wasActive=!!g||wasPinching;if(preserveCapturedInk&&g?.kind==='ink'&&g.settings.tool!=='laser'&&g.pageId===current.page.id)current.onChange([...current.page.objects,strokeObject(g)]);gesture.current=null;pinch.current=null;pointers.current.clear();if(frame.current!==undefined)cancelAnimationFrame(frame.current);frame.current=undefined;activePath.current?.setAttribute('d','');setPreview(null);setShape(null);setMarquee(null);setPanning(false);if(wasActive)current.onGestureState?.(false,{pointerType:g?.pointerType??'touch',navigation:wasPinching||g?.kind==='pan',cancel:()=>cancel()});},[]);
  useEffect(()=>{cancel();},[page.id,cancel]);
  useEffect(()=>{const blur=()=>cancel(true),visibility=()=>{if(document.visibilityState==='hidden')cancel(true);};window.addEventListener('blur',blur);document.addEventListener('visibilitychange',visibility);return()=>{window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',visibility);cancel(true);};},[cancel]);
  useEffect(()=>{
    const element=root.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{
      if(latest.current.onScroll){if(gesture.current&&gesture.current.kind!=='pan')event.preventDefault();return;}
      if(gesture.current&&gesture.current.kind!=='pan')return;
      event.preventDefault();
      const rect=element.getBoundingClientRect(),p:Point=[event.clientX-rect.left,event.clientY-rect.top],v=viewRef.current;
      if(event.shiftKey&&!event.ctrlKey&&!event.metaKey){changeView({...v,x:v.x-event.deltaY,y:v.y-event.deltaX});return;}
      const zoom=clampZoom(v.zoom*Math.exp(-event.deltaY*.0015));
      changeView({zoom,x:p[0]-(p[0]-v.x)*zoom/v.zoom,y:p[1]-(p[1]-v.y)*zoom/v.zoom});
    };
    element.addEventListener('wheel',wheel,{passive:false});return()=>element.removeEventListener('wheel',wheel);
  },[]);
  const display=()=>{
    frame.current=undefined;const g=gesture.current;if(!g)return;
    if(g.kind==='ink'){
      const path=activePath.current;if(path){const object=strokeObject(g);path.setAttribute('d',object.path!);path.setAttribute('transform',`translate(${object.x} ${object.y})`);path.setAttribute('stroke',g.settings.tool==='laser'?'#ff4f65':g.settings.color);path.setAttribute('stroke-width',String(g.settings.tool==='laser'?3/viewRef.current.zoom:object.strokeWidth));path.setAttribute('opacity',String(object.opacity));}
    }else if(g.kind==='erase')setPreview(g.objects);
    else if(g.kind==='shape')setShape(shapeObject(g));
    else if(g.kind==='move'){
      const dx=g.last[0]-g.start[0],dy=g.last[1]-g.start[1];setPreview(g.objects.map(o=>g.selected.includes(o.id)&&!o.locked?{...o,x:o.x+dx,y:o.y+dy}:o));
    }else if(g.kind==='resize'&&g.bounds){
      const b=g.bounds,[sx,sy]=resizeFactors(b,g.start,g.last);setPreview(g.objects.map(o=>g.selected.includes(o.id)&&!o.locked?resizeObject(o,sx,sy,[b.x,b.y]):o));
    }else if(g.kind==='box')setMarquee(g.settings.tool==='lasso'?g.points:[g.start,[g.last[0],g.start[1]],g.last,[g.start[0],g.last[1]]]);
  };
  const schedule=()=>{if(frame.current===undefined)frame.current=requestAnimationFrame(display);};
  const down=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(settings.tool==='textHighlight')return;
    if(event.button!==0&&event.button!==1&&event.button!==2&&event.button!==5)return;
    if(gesture.current?.pointerType==='pen'&&event.pointerType==='touch')return;
    // A resting palm may arrive first; a real pen always takes precedence.
    if(event.pointerType==='pen'&&(gesture.current?.pointerType==='touch'||pinch.current))cancel();
    root.current?.focus({preventScroll:true});
    if(event.pointerType==='touch'){
      pointers.current.set(event.pointerId,navigationPoint(event.clientX,event.clientY));
      if(pointers.current.size>=2){
        const points=[...pointers.current.values()],middle:Point=[(points[0][0]+points[1][0])/2,(points[0][1]+points[1][1])/2],v=viewRef.current;
        gesture.current=null;clearPreview();pinch.current={distance:Math.max(1,distance(points[0],points[1])),zoom:v.zoom,anchor:[(middle[0]-v.x)/v.zoom,(middle[1]-v.y)/v.zoom],last:middle};latest.current.onGestureState?.(true,{pointerType:'touch',navigation:true,cancel:()=>cancel()});event.currentTarget.setPointerCapture(event.pointerId);event.preventDefault();return;
      }
    }
    if(gesture.current)return;
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
    const p=toPage(event.clientX,event.clientY),current=latest.current;const activeSettings={...current.settings};
    if(event.button===2){activeSettings.tool='select';current.onToolChange?.('select');}
    if(event.button===5||event.buttons===32)activeSettings.tool='eraser';
    const outsidePage=!infinite&&(p[0]<0||p[1]<0||p[0]>page.width||p[1]>page.height);
    const pan=activeSettings.tool==='pan'||event.button===1||(event.pointerType==='touch'&&(activeSettings.penOnly||outsidePage))||event.altKey;
    if(!pan&&outsidePage){pointers.current.delete(event.pointerId);return;}
    const g:Gesture={kind:'ink',id:crypto.randomUUID(),pageId:current.page.id,pointerId:event.pointerId,pointerType:event.pointerType,start:p,last:p,points:[p],objects:current.page.objects,baseObjects:current.page.objects,settings:activeSettings,view:viewRef.current,selected:[...current.selectedIds],changed:false};
    if(pan){g.kind='pan';g.start=navigationPoint(event.clientX,event.clientY);g.last=g.start;setPanning(true);}
    else if(activeSettings.tool==='text'||activeSettings.tool==='note'){current.onInsertText(p,activeSettings.tool);return;}
    else if(activeSettings.tool==='select'||activeSettings.tool==='lasso'){
      const handle=(event.target as Element).closest('[data-resize-handle]');
      const hit=[...current.page.objects].reverse().find(o=>hitTestObject(o,p,6/viewRef.current.zoom));
      if(handle&&current.selectedIds.length){g.kind='resize';g.bounds=selectionBounds(current.page.objects,current.selectedIds);}
      else if(hit&&activeSettings.tool!=='lasso'){
        if(event.shiftKey){g.selected=current.selectedIds.includes(hit.id)?current.selectedIds.filter(id=>id!==hit.id):[...current.selectedIds,hit.id];}
        else if(!current.selectedIds.includes(hit.id))g.selected=[hit.id];
        current.onSelectionChange(g.selected);g.kind='move';
      }else{g.kind='box';if(!event.shiftKey){g.selected=[];current.onSelectionChange([]);}}
    }else if(['rect','ellipse','line','arrow'].includes(activeSettings.tool))g.kind='shape';
    else if(activeSettings.tool==='eraser'){g.kind='erase';g.objects=eraseObjects(g.objects,p,p,Math.max(4,activeSettings.width*2)/viewRef.current.zoom,activeSettings.eraserMode);g.changed=g.objects.length!==current.page.objects.length||g.objects.some((o,i)=>o!==current.page.objects[i]);}
    gesture.current=g;current.onGestureState?.(true,{pointerType:g.pointerType,navigation:g.kind==='pan',cancel:()=>cancel()});schedule();
  };
  const move=(event:React.PointerEvent<HTMLDivElement>)=>{
    if(event.pointerType==='touch'&&pointers.current.has(event.pointerId))pointers.current.set(event.pointerId,navigationPoint(event.clientX,event.clientY));
    if(pinch.current&&pointers.current.size>=2){
      const points=[...pointers.current.values()],middle:Point=[(points[0][0]+points[1][0])/2,(points[0][1]+points[1][1])/2],pin=pinch.current;
      if(latest.current.onScroll){latest.current.onScroll(pin.last[0]-middle[0],pin.last[1]-middle[1]);pin.last=middle;}
      else{const zoom=clampZoom(pin.zoom*distance(points[0],points[1])/pin.distance);changeView({zoom,x:middle[0]-pin.anchor[0]*zoom,y:middle[1]-pin.anchor[1]*zoom});}event.preventDefault();return;
    }
    const g=gesture.current;if(!g||g.pointerId!==event.pointerId)return;
    event.preventDefault();
    if(g.kind==='pan'){const p=navigationPoint(event.clientX,event.clientY);if(latest.current.onScroll){latest.current.onScroll(g.last[0]-p[0],g.last[1]-p[1]);g.last=p;}else changeView({...g.view,x:g.view.x+p[0]-g.start[0],y:g.view.y+p[1]-g.start[1]});return;}
    const events=typeof event.nativeEvent.getCoalescedEvents==='function'?event.nativeEvent.getCoalescedEvents():[];
    const samples=events.length?events:[event.nativeEvent];
    for(const sample of samples){
      const point=toPage(sample.clientX,sample.clientY);
      if(distance(g.last,point)<.001)continue;
      if(g.kind==='erase'){const erased=eraseObjects(g.objects,g.last,point,Math.max(4,g.settings.width*2)/viewRef.current.zoom,g.settings.eraserMode);if(erased.length!==g.objects.length||erased.some((o,i)=>o!==g.objects[i]))g.changed=true;g.objects=erased;}
      g.last=point;g.points.push(point);if(g.kind!=='erase')g.changed=true;
    }
    schedule();
  };
  const up=(event:React.PointerEvent<HTMLDivElement>,cancelled=false)=>{
    pointers.current.delete(event.pointerId);
    if(pinch.current){
      const current=latest.current;
      if(pointers.current.size>=2){
        const points=[...pointers.current.values()],middle:Point=[(points[0][0]+points[1][0])/2,(points[0][1]+points[1][1])/2],v=viewRef.current;
        pinch.current={distance:Math.max(1,distance(points[0],points[1])),zoom:v.zoom,anchor:[(middle[0]-v.x)/v.zoom,(middle[1]-v.y)/v.zoom],last:middle};
      }else{
        pinch.current=null;gesture.current=null;clearPreview();
        const remaining=pointers.current.entries().next().value as [number,Point]|undefined;
        if(remaining){const [pointerId,position]=remaining;gesture.current={kind:'pan',id:crypto.randomUUID(),pageId:current.page.id,pointerId,pointerType:'touch',start:position,last:position,points:[],objects:current.page.objects,baseObjects:current.page.objects,settings:current.settings,view:viewRef.current,selected:current.selectedIds,changed:false};setPanning(true);}
        else current.onGestureState?.(false,{pointerType:'touch',navigation:true,cancel:()=>cancel()});
      }
      return;
    }
    const g=gesture.current;if(!g||g.pointerId!==event.pointerId)return;
    if(!cancelled&&g.kind!=='pan')move(event);
    gesture.current=null;if(frame.current!==undefined)cancelAnimationFrame(frame.current);frame.current=undefined;
    const current=latest.current;
    if(g.pageId===current.page.id&&(!cancelled||g.kind==='ink'&&g.settings.tool!=='laser')){
      if(g.kind==='ink'&&g.settings.tool==='laser'){
        if(laserGroup.current){const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',strokePath(g.points,g.settings.smoothing,g.view.zoom));path.setAttribute('fill','none');path.setAttribute('stroke','#ff4f65');path.setAttribute('stroke-width',String(3/viewRef.current.zoom));path.setAttribute('stroke-linecap','round');path.style.transition='opacity .7s ease';laserGroup.current.appendChild(path);requestAnimationFrame(()=>{path.style.opacity='0';});setTimeout(()=>path.remove(),750);}
      }else if(g.kind==='ink'){
        current.onChange([...current.page.objects,strokeObject(g)]);
      }else if(g.kind==='shape'&&distance(g.start,g.last)>.5){const object={...shapeObject(g),id:g.id};current.onChange([...current.page.objects,object]);}
      else if(g.kind==='erase'&&g.changed){let erased=g.objects;if(current.page.objects!==g.baseObjects){erased=current.page.objects;for(let i=0;i<g.points.length;i++)erased=eraseObjects(erased,g.points[Math.max(0,i-1)],g.points[i],Math.max(4,g.settings.width*2)/viewRef.current.zoom,g.settings.eraserMode);}current.onChange(erased);}
      else if(g.kind==='move'&&g.changed){const dx=g.last[0]-g.start[0],dy=g.last[1]-g.start[1];current.onChange(current.page.objects.map(o=>g.selected.includes(o.id)&&!o.locked?{...o,x:o.x+dx,y:o.y+dy}:o));}
      else if(g.kind==='resize'&&g.changed&&g.bounds){const b=g.bounds,[sx,sy]=resizeFactors(b,g.start,g.last);current.onChange(current.page.objects.map(o=>g.selected.includes(o.id)&&!o.locked?resizeObject(o,sx,sy,[b.x,b.y]):o));}
      else if(g.kind==='box'){
        const polygon:Point[]=g.settings.tool==='lasso'?g.points:[g.start,[g.last[0],g.start[1]],g.last,[g.start[0],g.last[1]]];
        const hits=g.objects.filter(o=>objectIntersectsPolygon(o,polygon)).map(o=>o.id);current.onSelectionChange([...new Set([...g.selected,...hits])]);
      }
    }
    clearPreview();current.onGestureState?.(false,{pointerType:g.pointerType,navigation:g.kind==='pan',cancel:()=>cancel()});
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const objects=preview??page.objects,bounds=selectionBounds(objects,selectedIds),z=view.zoom;
  const cursor=panning?'grabbing':settings.tool==='pan'?'grab':settings.tool==='select'?'default':settings.tool==='text'?'text':settings.tool==='textHighlight'?'text':'crosshair';
  return <div ref={root} className="drawing-surface" data-testid="drawing-surface" data-infinite={infinite} tabIndex={-1} role="application" aria-label="Softboard drawing canvas" data-tool={settings.tool} onPointerDownCapture={()=>props.onActivate?.()} onPointerDown={down} onPointerMove={move} onPointerUp={event=>up(event)} onPointerCancel={event=>up(event,true)} onLostPointerCapture={event=>{if(gesture.current?.pointerId===event.pointerId||pinch.current&&pointers.current.has(event.pointerId))up(event,true);}} onDoubleClick={event=>{props.onActivate?.();if(settings.tool!=='select')return;const point=toPage(event.clientX,event.clientY);const object=[...page.objects].reverse().find(o=>['text','note','link'].includes(o.type)&&hitTestObject(o,point));if(object)props.onEditText(object);}} onContextMenu={event=>{if(settings.tool==='textHighlight'&&!props.onContextMenu)return;event.preventDefault();props.onContextMenu?.(event,toPage(event.clientX,event.clientY));}} style={{position:'relative',width:'100%',height:'100%',overflow:'hidden',background:infinite?page.background:undefined,outline:'none',touchAction:settings.tool==='textHighlight'?'pan-x pan-y':'none',cursor,userSelect:settings.tool==='textHighlight'?'text':'none'}}>
    {infinite&&z>=.15&&page.pattern!=='blank'&&<svg className="infinite-paper" width="100%" height="100%" aria-hidden="true" style={{position:'absolute',inset:0,pointerEvents:'none'}}><defs><pattern id={patternId} width={24} height={24} patternUnits="userSpaceOnUse" patternTransform={`translate(${view.x} ${view.y}) scale(${z})`}>{page.pattern==='dots'?<circle cx={2} cy={2} r={1} fill="#c9d2dd"/>:<path d={page.pattern==='grid'?'M 24 0 H 0 V 24':'M 0 23.5 H 24'} fill="none" stroke="#dbe1e9" strokeWidth={.7}/>}</pattern></defs><rect width="100%" height="100%" fill={`url(#${patternId})`}/></svg>}
    <div className="drawing-page" style={{position:'absolute',width:page.width,height:page.height,transformOrigin:'0 0',transform:`translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,background:infinite?'transparent':page.background,boxShadow:infinite?'none':'0 2px 20px #16243a14',overflow:infinite?'visible':'hidden'}}>
      {!infinite&&page.pattern!=='blank'&&<svg width={page.width} height={page.height} style={{position:'absolute',inset:0,pointerEvents:'none'}}><defs><pattern id={patternId} width={24} height={24} patternUnits="userSpaceOnUse">{page.pattern==='dots'?<circle cx={2} cy={2} r={1} fill="#c9d2dd"/>:<path d={page.pattern==='grid'?'M 24 0 H 0 V 24':'M 0 23.5 H 24'} fill="none" stroke="#dbe1e9" strokeWidth={.7}/>}</pattern></defs><rect width="100%" height="100%" fill={`url(#${patternId})`}/></svg>}
      <div className="drawing-background" style={{position:'absolute',inset:0,pointerEvents:settings.tool==='textHighlight'?'auto':'none'}}>{children}</div>
      <svg className="drawing-objects" width={page.width} height={page.height} style={{position:'absolute',inset:0,overflow:'visible',pointerEvents:'none'}}>
        <ObjectLayer objects={objects}/>
        {shape&&<BoardObjectView object={shape}/>}
        <g ref={laserGroup}/><path ref={activePath} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
        {marquee&&<path d={`${marquee.map((p,i)=>`${i?'L':'M'} ${p[0]} ${p[1]}`).join(' ')} Z`} fill="#617cf01a" stroke="#617cf0" strokeWidth={1/z} strokeDasharray={`${5/z} ${4/z}`}/>}
        {bounds&&settings.tool==='select'&&<g><rect x={bounds.x-4/z} y={bounds.y-4/z} width={Math.max(1,bounds.width)+8/z} height={Math.max(1,bounds.height)+8/z} fill="none" stroke="#6575db" strokeWidth={1.5/z}/><rect data-resize-handle="true" x={bounds.x+bounds.width-6/z} y={bounds.y+bounds.height-6/z} width={12/z} height={12/z} rx={3/z} fill="white" stroke="#6575db" strokeWidth={1.5/z} style={{pointerEvents:'all',cursor:'nwse-resize'}}/></g>}
      </svg>
    </div>
  </div>;
}
