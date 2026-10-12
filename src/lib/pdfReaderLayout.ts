import type {BoardPage} from '../types';

export const PDF_TOP=64, PDF_GAP=24, PDF_BOTTOM=220;
export const pdfReadingLine=(height:number)=>Math.min(24,height*.25);
export type PdfPageLayout={id:string;top:number;left:number;width:number;height:number};
export function fitPdfWidth(availableWidth:number,pageWidth:number){
 const gutter=availableWidth<600?12:24;
 return Math.max(.01,Math.min(8,(availableWidth-gutter*2)/Math.max(1,pageWidth)));
}
export function layoutPdfPages(pages:Pick<BoardPage,'id'|'width'|'height'>[],scale:number,viewportWidth:number,viewportHeight=0){
 const widest=pages.reduce((width,page)=>Math.max(width,page.width),1)*scale;
 const width=Math.max(viewportWidth,widest+(viewportWidth<600?24:48));
 let top=PDF_TOP;
 const sheets=pages.map(page=>{const sheet={id:page.id,top,left:(width-page.width*scale)/2,width:page.width*scale,height:page.height*scale};top+=sheet.height+PDF_GAP;return sheet;});
 // A short final page must be able to reach the reading line. Otherwise the
 // browser clamps scrolling before it, making Next jump back to an earlier page.
 const bottom=Math.max(PDF_BOTTOM,viewportHeight-(sheets.at(-1)?.height??0)-pdfReadingLine(viewportHeight)+2);
 return {width,height:top-PDF_GAP+bottom,sheets};
}
// Binary search keeps scrolling inexpensive even in long documents. In a gap,
// use the following page once its top reaches the reading line.
export function pdfPageAt(sheets:PdfPageLayout[],position:number){
 let low=0,high=sheets.length-1;
 while(low<high){const middle=Math.ceil((low+high)/2);if(sheets[middle].top<=position)low=middle;else high=middle-1;}
 return Math.max(0,low);
}
