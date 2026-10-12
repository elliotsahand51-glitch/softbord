import test from 'node:test';
import assert from 'node:assert/strict';
import {parseEditorLocation} from '../src/lib/editorLocation.ts';

test('refresh location retains negative pan, zoom and independently hidden panels',()=>{
 const location={documentId:'board-1',pageId:'page-2',view:{x:-2500,y:1400,zoom:.43},rail:false,topbar:false,showTools:true};
 assert.deepEqual(parseEditorLocation(JSON.stringify(location)),location);
});
test('broken or unknown session values cannot prevent opening the library',()=>{
 for(const raw of [null,'not json','null','[]','{}','{"documentId":7}','{"documentId":""}'])assert.equal(parseEditorLocation(raw),null);
});
test('invalid view and panel fields fall back while retaining a valid document identity',()=>{
 const location=parseEditorLocation(JSON.stringify({documentId:'pdf-1',pageId:'p2',view:{x:0,y:0,zoom:900},rail:'false',topbar:0,showTools:false}));
 assert.deepEqual(location,{documentId:'pdf-1',pageId:'p2',showTools:false});
 assert.equal(parseEditorLocation('{"documentId":"x","view":{"x":1e999,"y":0,"zoom":1}}')?.view,undefined);
});
test('PDF reading position retains fit mode and validates resize/scroll data',()=>{
 const location={documentId:'pdf-1',pdf:{zoom:null,pageId:'p2',offset:124.5,centerX:-20}};
 assert.deepEqual(parseEditorLocation(JSON.stringify(location)),location);
 assert.equal(parseEditorLocation(JSON.stringify({...location,pdf:{...location.pdf,zoom:1.2}}))?.pdf?.zoom,1.2);
 assert.deepEqual(parseEditorLocation(JSON.stringify({...location,pdf:{...location.pdf,anchor:'reading-line'}}))?.pdf,{...location.pdf,anchor:'reading-line'});
 for(const patch of [{zoom:0},{zoom:9},{zoom:'fit'},{offset:'12'},{centerX:1e15},{pageId:''}])assert.equal(parseEditorLocation(JSON.stringify({...location,pdf:{...location.pdf,...patch}}))?.pdf,undefined);
});
