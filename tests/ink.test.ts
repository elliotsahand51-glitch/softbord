import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createStroke,distanceToSegment,eraseObjects,hitTestObject,inkPathPoints,objectIntersectsPolygon,rawStrokePath,resizeFactors,resizeObject,scaleStrokePath,smoothStrokePath,smoothStrokePoints,splitPolyline,wrapText} from '../src/lib/ink';
import type {Point} from '../src/types';

test('course smoothing preserves source, endpoints, curves and a small closing hook',()=>{
  const points:Point[]=[[0,10],[3,2],[9,0],[14,5],[14,12],[10,15],[7,13],[8,10]];
  const original=structuredClone(points),smoothed=smoothStrokePoints(points);
  assert.deepEqual(points,original);assert.deepEqual(smoothed[0],points[0]);assert.deepEqual(smoothed.at(-1),points.at(-1));
  assert.ok(smoothed.some(p=>p[1]>13));assert.ok(smoothStrokePath(points).includes(' Q '));
  assert.equal(smoothStrokePath(points),smoothStrokePath(original));
});
test('dots, duplicate samples, tiny strokes and raw mode never make invalid paths',()=>{
  for(const points of [[],[[1,1]],[[1,1],[1,1],[1,1]],[[0,0],[.1,.1],[.2,0]]] as Point[][]){const path=smoothStrokePath(points);assert.ok(!/NaN|Infinity/.test(path));}
  assert.equal(rawStrokePath([[1,2],[4,8]]),'M 1 2 L 4 8');
});
test('normalizing stores every original sample without shifting the rendered world path',()=>{
  const points:Point[]=[[100,200],[110,190],[105,207]];const object=createStroke(points,{smoothing:'raw'});
  assert.deepEqual(object.points!.map(p=>[p[0]+object.x,p[1]+object.y]),points);
  assert.equal(object.width,10);assert.equal(object.height,17);
  assert.equal(hitTestObject(object,[105,195],1),true);assert.equal(hitTestObject(object,[100,207],1),false);
});
test('fast precision eraser splits a segment and never joins across removed ink',()=>{
  const parts=splitPolyline([[0,0],[100,0]],[50,-100],[50,100],5);
  assert.equal(parts.length,2);assert.ok(Math.abs(parts[0].at(-1)![0]-45)<1e-8);assert.ok(Math.abs(parts[1][0][0]-55)<1e-8);
  const stroke=createStroke([[0,0],[100,0]],{smoothing:'raw',strokeWidth:2});
  const erased=eraseObjects([stroke],[50,-100],[50,100],5,'precision');assert.equal(erased.length,2);
  for(const fragment of erased)assert.equal(hitTestObject(fragment,[50,0],0),false);
});
test('stroke eraser intersects swept path and preserves locked and distant strokes',()=>{
  const crossed=createStroke([[0,0],[100,0]]),far=createStroke([[0,200],[100,200]]),locked={...crossed,id:'locked',locked:true};
  assert.deepEqual(eraseObjects([crossed,far,locked],[50,-20],[50,20],3,'stroke').map(o=>o.id),[far.id,locked.id]);
});
test('diagonal capsule and zero-length eraser paths produce finite fragments',()=>{
  for(const end of [[50,50],[0,0]] as Point[]){const pieces=splitPolyline([[-50,10],[100,10]],[0,0],end,6);assert.ok(pieces.length>=1);assert.ok(pieces.flat().every(p=>p.every(Number.isFinite)));for(const piece of pieces)for(const p of piece)assert.ok(distanceToSegment(p,[0,0],end)>=6-1e-8);}
});
test('resize scales source geometry and preserves text wrapping across export',()=>{
  const stroke=createStroke([[10,20],[20,40]],{smoothing:'raw'}),scaled=resizeObject(stroke,2,3,[10,20]);
  assert.equal(scaled.width,20);assert.equal(scaled.height,60);assert.deepEqual(scaled.points,[[0,0],[20,60]]);
  assert.deepEqual(wrapText('one two three\n\nfour',50,10),['one two','three','','four']);
});
test('lasso selects crossing ink and a region inside a large image, but not empty space',()=>{
  const polygon:Point[]=[[20,20],[40,20],[40,40],[20,40]];
  assert.equal(objectIntersectsPolygon(createStroke([[0,30],[100,30]],{smoothing:'raw'}),polygon),true);
  assert.equal(objectIntersectsPolygon(createStroke([[0,5],[100,5]],{smoothing:'raw'}),polygon),false);
  assert.equal(objectIntersectsPolygon({id:'image',type:'image',x:0,y:0,width:100,height:100,color:'#000',opacity:1,strokeWidth:0},polygon),true);
});
test('long continuous writing retains a small final hook instead of resampling it away',()=>{
  const points:Point[]=Array.from({length:10000},(_,i)=>[i*5,0]);
  points.push([49998,-3],[50002,-10],[49998,-16],[49991,-13],[49989,-7],[49994,-4]);
  const smoothed=smoothStrokePoints(points),hook=smoothed.filter(p=>p[0]>49985);
  assert.ok(hook.some(p=>p[1]<-13),'the bottom of the hook must remain visible');
  assert.ok(hook.some(p=>p[0]>49999),'the outward part of the hook must remain visible');
  assert.deepEqual(smoothed.at(-1),points.at(-1));
  const object=createStroke(points);
  assert.equal(object.points!.length,points.length);
  assert.equal(object.type,'stroke');
});
test('handwriting loops stay curved, and local geometry remains identical through saves',()=>{
  const source:Point[]=Array.from({length:240},(_,i)=>[133.12345+Math.sin(i*.09)*8+i*.06,274.98765+Math.cos(i*.09)*11]);
  const live=createStroke(source,{id:'same-stroke'}),saved=JSON.parse(JSON.stringify(live));
  assert.equal(live.path,saved.path);
  assert.equal(saved.path, smoothStrokePath(saved.points));
  assert.ok((live.path!.match(/ Q /g)||[]).length>120);
  assert.equal(live.type,'stroke');
  assert.deepEqual(source.map(p=>[p[0]-live.x,p[1]-live.y]),live.points);
});
test('10,000-sample stroke retains raw data with bounded live geometry work',t=>{
  const points:Point[]=Array.from({length:10000},(_,i)=>[i*.5,Math.sin(i*.07)*20+Math.sin(i*.015)*4]);
  const start=performance.now(),object=createStroke(points);
  t.diagnostic(`10,000-sample normalized stroke: ${(performance.now()-start).toFixed(2)} ms, ${object.path!.length.toLocaleString()} SVG characters`);
  assert.equal(object.points!.length,10000);
  assert.ok(object.path!.endsWith(`L ${Math.round(object.points!.at(-1)![0]*1000)/1000} ${Math.round(object.points!.at(-1)![1]*1000)/1000}`));
  assert.ok(!object.path!.includes('NaN'));
});
test('grabbing a resize handle off-center at 10% zoom does not jump object size',()=>{
  const bounds={width:100,height:100};
  // The 12-screen-pixel handle is 120 page pixels wide at 10% zoom.
  const start:Point=[155,145];
  assert.deepEqual(resizeFactors(bounds,start,start),[1,1]);
  assert.deepEqual(resizeFactors(bounds,start,[165,155]),[1.1,1.1]);
});
test('tiny text resize remains savable and includes all wrapped text in its bounds',()=>{
  const object={id:'text',type:'text' as const,x:0,y:0,width:200,height:100,text:'Multiple words repeated for several wrapped lines',fontSize:22,color:'#000',opacity:1,strokeWidth:0};
  const tiny=resizeObject(object,.02,.02,[0,0]);
  assert.equal(tiny.fontSize,1);
  const lines=wrapText(tiny.text!,tiny.width,tiny.fontSize!);
  assert.ok(tiny.height>=tiny.fontSize!+(lines.length-1)*tiny.fontSize!*1.3);
});
test('course handwriting has the same screen-space curves and hooks at 1%, 10%, 100%, and 800%',()=>{
  const screen:Point[]=[[0,10],[3,2],[9,0],[14,5],[14,12],[10,15],[7,13],[8,10]];
  const expected=smoothStrokePoints(screen);
  for(const zoom of [.01,.1,1,8]){
    const world:Point[]=screen.map(p=>[p[0]/zoom,p[1]/zoom]);
    const actual=smoothStrokePoints(world,zoom).map(p=>[p[0]*zoom,p[1]*zoom]);
    assert.equal(actual.length,expected.length);
    for(let i=0;i<actual.length;i++)assert.ok(Math.hypot(actual[i][0]-expected[i][0],actual[i][1]-expected[i][1])<1e-8);
    const object=createStroke(world,{smoothingScale:zoom});
    assert.equal(object.smoothingScale,zoom);assert.equal(object.path,smoothStrokePath(object.points!,zoom));
  }
});
test('resizing ink scales the stored curve rather than changing its handwriting',()=>{
  const object=createStroke([[0,10],[3,2],[9,0],[14,5],[14,12],[10,15],[7,13],[8,10]],{smoothingScale:8});
  const resized=resizeObject(object,3,.5,[0,0]);
  assert.equal(resized.path,scaleStrokePath(object.path!,3,.5));
  assert.equal(resized.smoothingScale,8);
  const outline=inkPathPoints(resized.path!)!;
  assert.ok(outline.length>3);
  for(const p of outline.slice(0,5))assert.equal(hitTestObject(resized,[p[0]+resized.x,p[1]+resized.y],.1),true);
});
