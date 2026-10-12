import type {BoardObject, BoardPage, SoftDocument, Point} from '../types';
export const uid=()=>crypto.randomUUID();
export function newPage(pattern:BoardPage['pattern']='dots'):BoardPage{return {id:uid(),width:2400,height:1800,objects:[],background:'#ffffff',pattern};}
export function newDocument(title='Untitled board'):SoftDocument{return {schemaVersion:1,id:uid(),title,kind:'board',pages:[newPage()],createdAt:Date.now(),updatedAt:Date.now(),revision:0};}
export function makeObject(type:BoardObject['type'],point:Point,options:Partial<BoardObject>={}):BoardObject{return {id:uid(),type,x:point[0],y:point[1],width:240,height:100,color:'#292735',strokeWidth:3,opacity:1,...options};}
export function templateDocument(kind:'blank'|'brainstorm'|'weekly'|'notes'):SoftDocument{
 const doc=newDocument(kind==='blank'?'Untitled board':kind==='brainstorm'?'Brainstorm':kind==='weekly'?'Weekly planner':'Study notes');const p=doc.pages[0];
 if(kind==='notes'){p.pattern='lines';p.width=1200;p.height=1600;}
 if(kind==='brainstorm')p.objects=[makeObject('text',[240,160],{text:'What are we exploring?',fontSize:40,bold:true,width:900,height:60}),...['Ideas','Questions','Next steps'].flatMap((text,i)=>[makeObject('text',[240+i*540,320],{text,fontSize:26,bold:true,width:300,height:40}),makeObject('note',[240+i*540,420],{text:'',fontSize:24,width:420,height:340,fill:['#fff1ac','#e3dcfa','#d7eedf'][i]})])];
 if(kind==='weekly')p.objects=[makeObject('text',[180,120],{text:'This week',fontSize:46,bold:true,width:600,height:80}),...['Monday','Tuesday','Wednesday','Thursday','Friday'].flatMap((text,i)=>[makeObject('rect',[180+i*400,280],{width:360,height:1060,fill:'#faf9fc',color:'#ddd9e8',strokeWidth:2}),makeObject('text',[205+i*400,310],{text,fontSize:26,bold:true,width:310,height:60})])];return doc;
}
export const bytes=(n:number)=>n>1e6?`${(n/1e6).toFixed(1)} MB`:n>1e3?`${Math.round(n/1e3)} KB`:`${n} B`;
export function downloadBlob(blob:Blob,name:string){const u=URL.createObjectURL(blob);const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),60000);}
export function safeName(name:string){return name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').trim()||'Softboard';}
