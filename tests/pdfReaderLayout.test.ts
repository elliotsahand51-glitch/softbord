import test from 'node:test';
import assert from 'node:assert/strict';
import {fitPdfWidth,layoutPdfPages,pdfPageAt,pdfReadingLine,PDF_GAP,PDF_TOP} from '../src/lib/pdfReaderLayout.ts';

const pages=[{id:'portrait',width:600,height:800},{id:'landscape',width:800,height:600},{id:'last',width:500,height:900}];
test('mixed PDF sizes share a scale and fit inside desktop and phone readers',()=>{
 for(const width of [1440,820,390,320]){
  const scale=fitPdfWidth(width,800),layout=layoutPdfPages(pages,scale,width);
  assert.equal(layout.width,width);
  for(const sheet of layout.sheets){assert.ok(sheet.left>=12);assert.ok(sheet.left+sheet.width<=width-12);}
  assert.equal(layout.sheets[0].top,PDF_TOP);
  assert.equal(layout.sheets[1].top,PDF_TOP+800*scale+PDF_GAP);
 }
});
test('larger pages have a real horizontal scroll area and continuous vertical order',()=>{
 const layout=layoutPdfPages(pages,2,390);
 assert.ok(layout.width>390);
 assert.equal(layout.sheets[1].width,1600);
 for(let index=1;index<layout.sheets.length;index++)assert.equal(layout.sheets[index].top,layout.sheets[index-1].top+layout.sheets[index-1].height+PDF_GAP);
 assert.equal(pdfPageAt(layout.sheets,-10),0);
 assert.equal(pdfPageAt(layout.sheets,layout.sheets[1].top-1),0);
 assert.equal(pdfPageAt(layout.sheets,layout.sheets[1].top),1);
 assert.equal(pdfPageAt(layout.sheets,1e9),2);
});
test('page arrows can reach the final reading line even when phone pages are short',()=>{
 for(const [width,height,scale] of [[390,852,.439],[320,1000,.01],[820,1122,.5]]){
  const layout=layoutPdfPages(pages,scale,width,height),maximumScroll=Math.max(0,layout.height-height),readingLine=pdfReadingLine(height);
  assert.equal(pdfPageAt(layout.sheets,maximumScroll+readingLine),pages.length-1);
  for(let index=0;index<pages.length;index++){
   const top=Math.min(maximumScroll,Math.max(0,layout.sheets[index].top-readingLine+2));
   assert.equal(pdfPageAt(layout.sheets,top+readingLine),index);
  }
 }
});
