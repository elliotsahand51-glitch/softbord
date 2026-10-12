import type {View} from '../types';

const KEY='softboard-editor-location:v1';
export interface PdfReaderLocation {
 zoom:number|null;
 pageId:string;
 offset:number;
 centerX:number;
 anchor?:'reading-line';
}
export interface EditorLocation {
 documentId:string;
 pageId?:string;
 view?:View;
 rail?:boolean;
 topbar?:boolean;
 showTools?:boolean;
 pdf?:PdfReaderLocation;
}
export function parseEditorLocation(raw:string|null):EditorLocation|null {
 try {
  const value=JSON.parse(raw||'null');
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.documentId!=='string'||!value.documentId.length||value.documentId.length>160)return null;
  const result:EditorLocation={documentId:value.documentId};
  if(typeof value.pageId==='string'&&value.pageId.length<=160)result.pageId=value.pageId;
  const view=value.view;
  if(view&&[view.x,view.y,view.zoom].every(n=>typeof n==='number'&&Number.isFinite(n))&&Math.abs(view.x)<=1e10&&Math.abs(view.y)<=1e10&&view.zoom>=.01&&view.zoom<=8)result.view={x:view.x,y:view.y,zoom:view.zoom};
  for(const key of ['rail','topbar','showTools'] as const)if(typeof value[key]==='boolean')result[key]=value[key];
  const pdf=value.pdf;
  if(pdf&&typeof pdf.pageId==='string'&&pdf.pageId.length>0&&pdf.pageId.length<=160&&(pdf.zoom===null||typeof pdf.zoom==='number'&&Number.isFinite(pdf.zoom)&&pdf.zoom>=.01&&pdf.zoom<=8)&&[pdf.offset,pdf.centerX].every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e10))result.pdf={zoom:pdf.zoom,pageId:pdf.pageId,offset:pdf.offset,centerX:pdf.centerX};
  if(result.pdf&&pdf.anchor==='reading-line')result.pdf.anchor='reading-line';
  return result;
 }catch{return null;}
}
// Session storage keeps each tab's navigation independent. Document contents stay in IndexedDB.
export function readEditorLocation():EditorLocation|null {try{return parseEditorLocation(sessionStorage.getItem(KEY));}catch{return null;}}
export function writeEditorLocation(value:EditorLocation):void {try{sessionStorage.setItem(KEY,JSON.stringify(value));}catch{/* Browsers that block session storage can still edit and save documents. */}}
export function clearEditorLocation():void {try{sessionStorage.removeItem(KEY);}catch{}}
