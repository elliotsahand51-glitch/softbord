import type {BoardPage,SoftDocument} from '../types';
import {pageBounds} from '../lib/boardBounds';
import {BoardObjectView} from './DrawingSurface';
import {PdfThumbnail} from './PdfBackground';

export function PageThumbnail({document,page}:{document:SoftDocument;page:BoardPage}){
 const bounds=pageBounds(page),pdf=page.pdfPageIndex!==undefined;
 return <div className="page-miniature" style={{aspectRatio:`${bounds.width}/${bounds.height}`}}>
  {pdf&&<PdfThumbnail document={document} page={page} width={116}/>}
  <svg style={pdf?{position:'absolute',inset:0,width:'100%',height:'100%'}:undefined} viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}>
   {!pdf&&<rect x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height} fill={page.background}/>}
   {page.objects.slice(0,300).map(object=><BoardObjectView key={object.id} object={object}/>)}
  </svg>
 </div>;
}
