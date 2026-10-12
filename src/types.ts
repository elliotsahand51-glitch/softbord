export type Point = [number, number];
export type ObjectKind = 'stroke'|'highlight'|'rect'|'ellipse'|'line'|'arrow'|'text'|'note'|'image'|'link';
export interface BoardObject {
 id:string; type:ObjectKind; x:number; y:number; width:number; height:number;
 color:string; strokeWidth:number; opacity:number; rotation?:number; locked?:boolean;
 points?:Point[]; path?:string; smoothing?:'course'|'raw'; smoothingScale?:number; fill?:string;
 text?:string; fontSize?:number; bold?:boolean; assetId?:string; url?:string;
}
export interface BoardPage {id:string;width:number;height:number;objects:BoardObject[];pdfPageIndex?:number;background:string;pattern:'dots'|'grid'|'lines'|'blank';}
export interface SoftDocument {schemaVersion:1;id:string;title:string;kind:'board'|'pdf';pages:BoardPage[];pdfAssetId?:string;createdAt:number;updatedAt:number;revision:number;thumbnail?:string;compressed?:boolean;}
export interface AssetRecord {id:string;blob:Blob;name:string;mime:string;createdAt:number;}
export type DocumentSummary = Omit<SoftDocument,'pages'> & {pageCount:number;objectCount:number;size:number};
export type Tool = 'select'|'pen'|'highlighter'|'eraser'|'pan'|'text'|'note'|'rect'|'ellipse'|'line'|'arrow'|'laser'|'textHighlight'|'lasso';
export interface ToolSettings {tool:Tool;color:string;width:number;fontSize:number;smoothing:'course'|'raw';eraserMode:'stroke'|'precision';penOnly:boolean;}
export interface View {x:number;y:number;zoom:number;}
