import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DocumentSession, AUTOSAVE_INTERVAL_MS } from '../src/lib/session';
import { StorageConflictError } from '../src/lib/storage';
import type { SoftDocument } from '../src/types';

function initial(): SoftDocument {
  return { schemaVersion: 1, id: 'document', title: 'Original', kind: 'board', revision: 1, createdAt: 1, updatedAt: 1,
    pages: [{ id: 'page', width: 100, height: 100, pattern: 'blank', background: '#fff', objects: [] }] };
}
function writer() {
  const calls: { document: SoftDocument; resolve: (document: SoftDocument) => void; reject: (error: Error) => void }[] = [];
  const save = (document: SoftDocument) => new Promise<SoftDocument>((resolve, reject) => calls.push({ document, resolve, reject }));
  const complete = (index: number) => calls[index].resolve({ ...calls[index].document, revision: calls[index].document.revision + 1, updatedAt: index + 2 });
  return { save, calls, complete };
}
const tick = () => new Promise<void>(resolve => setImmediate(resolve));

test('autosave runs at five minutes and ongoing edits do not postpone it', async context => {
  context.mock.timers.enable({apis:['setTimeout']});
  assert.equal(AUTOSAVE_INTERVAL_MS,300000);
  const store=writer(),session=new DocumentSession(initial(),store.save);
  try {
    session.change(d=>({...d,title:'First edit'}));
    context.mock.timers.tick(240000);
    session.change(d=>({...d,title:'Latest edit'}));
    context.mock.timers.tick(59999);assert.equal(store.calls.length,0);
    context.mock.timers.tick(1);assert.equal(store.calls.length,1);assert.equal(store.calls[0].document.title,'Latest edit');
    store.complete(0);await tick();assert.equal(session.needsSave,false);
    context.mock.timers.tick(600000);assert.equal(store.calls.length,1);
    session.change(d=>({...d,title:'Next cycle'}));context.mock.timers.tick(300000);
    assert.equal(store.calls.length,2);store.complete(1);await tick();
  } finally {session.stopTimers();}
});

test('an autosave deadline during drawing waits for the finished stroke', async context => {
  context.mock.timers.enable({apis:['setTimeout']});
  const store=writer(),session=new DocumentSession(initial(),store.save);
  try {
    session.change(d=>({...d,title:'Before stroke'}));session.gesture(true);
    context.mock.timers.tick(300000);assert.equal(store.calls.length,0);
    await assert.rejects(session.flush(),/Finish the current/);
    session.change(d=>({...d,title:'Completed stroke'}));session.gesture(false);
    assert.equal(store.calls.length,1);assert.equal(store.calls[0].document.title,'Completed stroke');
    store.complete(0);await tick();assert.equal(session.needsSave,false);
  } finally {session.stopTimers();}
});

test('manual save persists immediately and cancels the pending autosave', async context => {
  context.mock.timers.enable({apis:['setTimeout']});
  const store=writer(),session=new DocumentSession(initial(),store.save);
  try {
    session.change(d=>({...d,title:'Save now'}));context.mock.timers.tick(1000);
    const saving=session.flush();assert.equal(store.calls.length,1);
    store.complete(0);await saving;context.mock.timers.tick(300000);
    assert.equal(store.calls.length,1);assert.equal(session.getSnapshot().status,'Saved on this device');
  } finally {session.stopTimers();}
});

test('save completion merges revision without overwriting newer content and serializes flush callers', async () => {
  const store = writer(); const session = new DocumentSession(initial(), store.save);
  try {
    session.change(document => ({ ...document, title: 'First edit' }));
    const first = session.flush(); const simultaneous = session.flush();
    assert.equal(store.calls.length, 1);
    session.change(document => ({ ...document, title: 'Second edit' }));
    store.complete(0); await tick();
    assert.equal(session.current.current.title, 'Second edit'); assert.equal(store.calls.length, 2); assert.equal(store.calls[1].document.revision, 2);
    store.complete(1); await Promise.all([first, simultaneous]);
    assert.equal(session.current.current.title, 'Second edit'); assert.equal(session.current.current.revision, 3); assert.equal(session.needsSave, false);
  } finally { session.stopTimers(); }
});
test('undo and redo during an asynchronous save preserve content and newest revision', async () => {
  const store = writer(); const session = new DocumentSession(initial(), store.save);
  try {
    session.change(document => ({ ...document, title: 'Edit' })); const saving = session.flush();
    session.undo(); assert.equal(session.current.current.title, 'Original');
    store.complete(0); await tick(); assert.equal(store.calls[1].document.title, 'Original'); assert.equal(store.calls[1].document.revision, 2);
    session.redo(); store.complete(1); await tick(); assert.equal(store.calls[2].document.title, 'Edit'); assert.equal(store.calls[2].document.revision, 3);
    store.complete(2); await saving; assert.equal(session.current.current.revision, 4); assert.equal(session.needsSave, false);
  } finally { session.stopTimers(); }
});
test('history content is immutable and a new edit clears redo', async () => {
  const session = new DocumentSession(initial(), async document => ({ ...document, revision: document.revision + 1 }));
  try {
    session.change(document => ({ ...document, title: 'Edit' })); const snapshot = session.current.current;
    assert.throws(() => { snapshot.pages[0].width = 555; }, TypeError);
    session.undo(); assert.equal(session.current.current.pages[0].width, 100); assert.equal(session.getSnapshot().canRedo, true);
    session.change(document => ({ ...document, title: 'Different' })); assert.equal(session.getSnapshot().canRedo, false);
    await session.flush();
  } finally { session.stopTimers(); }
});
test('conflicts keep unsaved edits and block overwriting another window', async () => {
  const store = writer(); const session = new DocumentSession(initial(), store.save);
  try {
    session.change(document => ({ ...document, title: 'Unsaved work' })); const saving = session.flush();
    store.calls[0].reject(new StorageConflictError()); await assert.rejects(saving, StorageConflictError);
    assert.equal(session.current.current.title, 'Unsaved work'); assert.equal(session.current.current.revision, 1); assert.equal(session.needsLeaveWarning, true);
    assert.equal(session.getSnapshot().status, 'Save needs attention');
    session.change(document => ({ ...document, title: 'More unsaved work' }));
    await assert.rejects(session.flush(), StorageConflictError); assert.equal(store.calls.length, 1); assert.equal(session.current.current.title, 'More unsaved work');
  } finally { session.stopTimers(); }
});
test('transient errors retain edits and can be retried explicitly', async () => {
  const store = writer(); const session = new DocumentSession(initial(), store.save);
  try {
    session.change(document => ({ ...document, title: 'My work' })); const first = session.flush();
    store.calls[0].reject(new Error('Temporary disk error')); await assert.rejects(first, /Temporary/);
    const retry = session.flush(); assert.equal(store.calls[1].document.revision, 1); store.complete(1); await retry;
    assert.equal(session.needsSave, false); assert.equal(session.getSnapshot().error, '');
  } finally { session.stopTimers(); }
});
test('active gestures block navigation and history even before content is committed', async () => {
  const store = writer(); const session = new DocumentSession(initial(), store.save);
  try {
    session.change(document => ({ ...document, title: 'Completed edit' })); session.gesture(true);
    assert.equal(session.needsLeaveWarning, true); assert.equal(session.getSnapshot().canUndo, false);
    session.undo(); assert.equal(session.current.current.title, 'Completed edit');
    await assert.rejects(session.flush(), /Finish the current/); assert.equal(store.calls.length, 0);
    session.gesture(false); const saving = session.flush(); session.gesture(true); store.complete(0);
    await assert.rejects(saving, /Finish the current/); assert.equal(session.getSnapshot().status, 'Drawing…'); assert.equal(session.getSnapshot().error, '');
    session.gesture(false); await session.flush(); assert.equal(session.needsLeaveWarning, false);
  } finally { session.stopTimers(); }
});
