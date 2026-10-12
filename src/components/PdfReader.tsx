import {forwardRef,useImperativeHandle,useLayoutEffect,useRef,useState,type ReactNode,type PointerEvent as ReactPointerEvent} from 'react';
import type {BoardPage,Point} from '../types';
import type {SurfaceGesture} from './DrawingSurface';
import type {PdfReaderLocation} from '../lib/editorLocation';
import {fitPdfWidth,layoutPdfPages,pdfPageAt,pdfReadingLine,PDF_TOP} from '../lib/pdfReaderLayout';
import './pdf-reader.css';

export interface PdfReaderHandle {
 fitWidth:()=>void;
 zoomBy:(factor:number)=>void;
 goToPage:(index:number)=>void;
 getCenter:(pageId:string)=>Point;
 getLocation:()=>PdfReaderLocation|undefined;
 setInteraction:(pageId:string,active:boolean,gesture?:SurfaceGesture)=>void;
}
interface Props {
 pages:BoardPage[];
 activeIndex:number;
 initialLocation?:PdfReaderLocation;
 onPageChange:(index:number)=>void;
 onLocationChange:(location:PdfReaderLocation)=>void;
 onScaleChange:(scale:number)=>void;
 isInteracting:()=>boolean;
 onNavigationState:(active:boolean)=>void;
 renderPage:(page:BoardPage,index:number,scale:number,scroll:(dx:number,dy:number)=>void)=>ReactNode;
}

export const PdfReader=forwardRef<PdfReaderHandle,Props>(function PdfReader(props,ref){
 const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
 const [size,setSize]=useState({width:0,height:0});
 const [zoom,setZoom]=useState<number|null>(props.initialLocation?.zoom??null);
 const [visible,setVisible]=useState({top:0,height:0});
 const maxWidth=props.pages.reduce((width,page)=>Math.max(width,page.width),1);
 const scale=zoom??fitPdfWidth(size.width,maxWidth);
 const layout=layoutPdfPages(props.pages,scale,size.width,size.height);
 const geometry=useRef({layout,scale,width:size.width,height:size.height,zoom});
 const initialized=useRef(false),pending=useRef<PdfReaderLocation|null>(null),frame=useRef<number|undefined>(undefined);
 const interaction=useRef<({pageId:string}&SurfaceGesture)|null>(null);
 const touches=useRef(new Map<number,Point>()),touchNavigation=useRef<Point|null>(null);
 const capture=():PdfReaderLocation|undefined=>{
  const element=host.current,g=geometry.current;if(!element||!initialized.current)return;
  const index=pdfPageAt(g.layout.sheets,element.scrollTop+pdfReadingLine(g.height)),sheet=g.layout.sheets[index];
  if(!sheet)return;
  return {zoom:g.zoom,pageId:sheet.id,offset:(element.scrollTop+pdfReadingLine(g.height)-sheet.top)/g.scale,centerX:(element.scrollLeft+g.width/2-g.layout.width/2)/g.scale,anchor:'reading-line'};
 };
 const report=()=>{
  const element=host.current;if(!element||!initialized.current)return;
  const location=capture();if(location)latest.current.onLocationChange(location);
  if(!latest.current.isInteracting())latest.current.onPageChange(pdfPageAt(geometry.current.layout.sheets,element.scrollTop+pdfReadingLine(element.clientHeight)));
  if(frame.current===undefined)frame.current=requestAnimationFrame(()=>{frame.current=undefined;setVisible({top:element.scrollTop,height:element.clientHeight});});
 };
 const scroll=(dx:number,dy:number)=>{const element=host.current;if(element){element.scrollLeft+=dx;element.scrollTop+=dy;report();}};
 const touchCenter=():Point=>{let x=0,y=0;for(const point of touches.current.values()){x+=point[0];y+=point[1];}const count=Math.max(1,touches.current.size);return[x/count,y/count];};
 const finishTouchNavigation=()=>{const navigating=!!touchNavigation.current;touches.current.clear();touchNavigation.current=null;if(navigating){latest.current.onNavigationState(false);report();}};
 const down=(event:ReactPointerEvent<HTMLDivElement>)=>{
  const owner=interaction.current;
  if(event.pointerType!=='touch'&&(owner?.pointerType==='touch'||touchNavigation.current)){
   owner?.cancel();finishTouchNavigation();
  }else if(owner&&owner.pointerType!=='touch'){
   // A pen owns the whole reader, so a resting palm on another page cannot
   // start a second gesture or release the pen's save/navigation lock.
   event.preventDefault();event.stopPropagation();return;
  }
  if(event.pointerType!=='touch')return;
  touches.current.set(event.pointerId,[event.clientX,event.clientY]);
  if(touches.current.size<2&&!touchNavigation.current)return;
  interaction.current?.cancel();
  if(!touchNavigation.current)latest.current.onNavigationState(true);
  touchNavigation.current=touchCenter();
  window.getSelection()?.removeAllRanges();
  // Cancel the one-finger preview before taking capture. The child therefore
  // cannot save accidental ink when fingers straddle a page boundary.
  for(const id of touches.current.keys())event.currentTarget.setPointerCapture(id);
  event.preventDefault();event.stopPropagation();
 };
 const move=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(event.pointerType!=='touch'||!touches.current.has(event.pointerId))return;
  touches.current.set(event.pointerId,[event.clientX,event.clientY]);
  if(!touchNavigation.current)return;
  const middle=touchCenter(),last=touchNavigation.current;touchNavigation.current=middle;
  scroll(last[0]-middle[0],last[1]-middle[1]);event.preventDefault();event.stopPropagation();
 };
 const up=(event:ReactPointerEvent<HTMLDivElement>)=>{
  if(event.pointerType!=='touch'||!touches.current.has(event.pointerId))return;
  touches.current.delete(event.pointerId);
  if(!touchNavigation.current)return;
  if(touches.current.size)touchNavigation.current=touchCenter();else finishTouchNavigation();
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
  event.preventDefault();event.stopPropagation();
 };
 useLayoutEffect(()=>{
  const element=host.current;if(!element)return;
  const measure=()=>{const next={width:element.clientWidth,height:element.clientHeight};if(next.width!==geometry.current.width||next.height!==geometry.current.height){pending.current=capture()??null;setSize(next);}};
  measure();const observer=new ResizeObserver(measure);observer.observe(element);
  const blur=()=>finishTouchNavigation(),hidden=()=>{if(document.visibilityState==='hidden')blur();};
  window.addEventListener('blur',blur);document.addEventListener('visibilitychange',hidden);
  return()=>{observer.disconnect();window.removeEventListener('blur',blur);document.removeEventListener('visibilitychange',hidden);if(frame.current!==undefined)cancelAnimationFrame(frame.current);};
 },[]);
 useLayoutEffect(()=>{
  const element=host.current;if(!element||!size.width)return;
  let position=pending.current;
  if(!initialized.current){
   position=props.initialLocation??null;
   initialized.current=true;
   if(!position&&props.activeIndex>0)position={zoom,pageId:props.pages[props.activeIndex].id,offset:-(pdfReadingLine(size.height)-2)/scale,centerX:0};
  }
  geometry.current={layout,scale,width:size.width,height:size.height,zoom};
  if(position){
   const sheet=layout.sheets.find(p=>p.id===position.pageId);
   if(sheet)element.scrollTop=Math.max(0,sheet.top+position.offset*scale-(position.anchor==='reading-line'?pdfReadingLine(size.height):0));
   element.scrollLeft=Math.max(0,layout.width/2+position.centerX*scale-size.width/2);
  }
  pending.current=null;
  setVisible({top:element.scrollTop,height:element.clientHeight});
  latest.current.onScaleChange(scale);report();
 },[size.width,size.height,scale,zoom,props.pages.length]);
 useImperativeHandle(ref,()=>({
  fitWidth:()=>{if(latest.current.isInteracting())return;pending.current=capture()??null;setZoom(null);},
  zoomBy:factor=>{if(latest.current.isInteracting()||!Number.isFinite(factor)||factor<=0)return;pending.current=capture()??null;setZoom(Math.max(.01,Math.min(8,geometry.current.scale*factor)));},
  goToPage:index=>{
   const element=host.current,sheet=geometry.current.layout.sheets[index];if(!element||!sheet||latest.current.isInteracting())return;
   element.scrollTop=Math.max(0,sheet.top-(index===0?PDF_TOP:pdfReadingLine(element.clientHeight)-2));report();
   // Update immediately while the browser queues its native scroll event.
   latest.current.onPageChange(index);
  },
  getCenter:pageId=>{
   const element=host.current,g=geometry.current,index=g.layout.sheets.findIndex(p=>p.id===pageId),sheet=g.layout.sheets[index],page=latest.current.pages[index];
   if(!element||!sheet||!page)return[40,40];
   const left=Math.max(sheet.left,element.scrollLeft),right=Math.min(sheet.left+sheet.width,element.scrollLeft+element.clientWidth);
   const top=Math.max(sheet.top,element.scrollTop+48),bottom=Math.min(sheet.top+sheet.height,element.scrollTop+Math.max(80,element.clientHeight-190));
   return [Math.max(0,Math.min(page.width-280,((left+right)/2-sheet.left)/g.scale-140)),Math.max(0,Math.min(page.height-200,((top+Math.max(top,bottom))/2-sheet.top)/g.scale-100))];
  },
  getLocation:capture,
  setInteraction:(pageId,active,gesture)=>{
   if(active&&gesture){interaction.current={pageId,...gesture};latest.current.onNavigationState(true);}
   else if(!active&&interaction.current?.pageId===pageId){const navigation=interaction.current.navigation;interaction.current=null;latest.current.onNavigationState(false);if(navigation)report();}
  },
 }));
 return <div className="pdf-reader" ref={host} tabIndex={0} role="region" aria-label="Scrollable PDF document" onScroll={report} onPointerDownCapture={down} onPointerMoveCapture={move} onPointerUpCapture={up} onPointerCancelCapture={up} onLostPointerCaptureCapture={event=>{if(event.target===event.currentTarget||!touchNavigation.current)up(event);}}>
  <div className="pdf-reader-pages" style={{width:layout.width,height:layout.height}}>
   {size.width>0&&layout.sheets.map((sheet,index)=>{
    const near=sheet.top+sheet.height>=visible.top-700&&sheet.top<=visible.top+visible.height+700;
    return <section className="pdf-sheet" key={sheet.id} data-page-id={sheet.id} data-page-index={index} aria-label={`PDF page ${index+1}`} style={{top:sheet.top,left:sheet.left,width:sheet.width,height:sheet.height}}>
     {near||index===props.activeIndex?props.renderPage(props.pages[index],index,scale,scroll):<span className="pdf-page-placeholder">Page {index+1}</span>}
    </section>;
   })}
  </div>
 </div>;
});
