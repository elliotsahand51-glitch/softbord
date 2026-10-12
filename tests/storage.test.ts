import 'fake-indexeddb/auto';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import type { SoftDocument } from '../src/types';
import { DATABASE_NAME, commitDocumentWithAssets, deleteDocument, duplicateDocument, getAsset, listDocuments, loadDocument, newId, putAsset, requestPersistence, saveDocument, setDocumentCompressed, StorageConflictError } from '../src/lib/storage';
import { exportDocumentBackup, importDocumentBackup, MAX_BACKUP_BYTES } from '../src/lib/backup';

const png = new Blob([Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lM0AAAAASUVORK5CYII='), char => char.charCodeAt(0))], { type: 'image/png' });
function board(): SoftDocument {
  return { schemaVersion: 1, id: newId(), title: 'Local notes', kind: 'board', createdAt: Date.now(), updatedAt: Date.now(), revision: 0,
    pages: [{ id: newId(), width: 1440, height: 1000, background: '#ffffff', pattern: 'dots', objects: [{ id: newId(), type: 'stroke', x: 10, y: 20, width: 100, height: 70, color: '#292524', strokeWidth: 3, opacity: 1, points: [[0, 0], [30, 25], [100, 70]], smoothing: 'course' }] }] };
}
async function withImage(): Promise<SoftDocument> {
  const document = board(); const assetId = await putAsset(png, 'Diagram.png');
  document.pages[0].objects.push({ id: newId(), type: 'image', x: 20, y: 50, width: 100, height: 100, color: '#000', strokeWidth: 0, opacity: 1, assetId });
  return saveDocument(document);
}
beforeEach(async () => {
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(DATABASE_NAME); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
});

test('saves immutable snapshots, reloads exact geometry and lists byte summaries', async () => {
  const document = board(); const snapshot = structuredClone(document); const saved = await saveDocument(document);
  assert.deepEqual(document, snapshot); assert.equal(saved.revision, 1); assert.deepEqual(await loadDocument(saved.id), saved);
  saved.pages[0].objects[0].x = 777;
  assert.equal((await loadDocument(saved.id))!.pages[0].objects[0].x, 10);
  const list = await listDocuments(); assert.equal(list.length, 1); assert.equal(list[0].objectCount, 1); assert.equal(list[0].pageCount, 1); assert.ok(list[0].size > 100);
});
test('concurrent tabs cannot silently overwrite one another or resurrect deleted documents', async () => {
  const document = await saveDocument(board());
  const writes = await Promise.allSettled([saveDocument({ ...document, title: 'Window A' }), saveDocument({ ...document, title: 'Window B' })]);
  assert.equal(writes.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = writes.find(result => result.status === 'rejected') as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof StorageConflictError);
  await deleteDocument(document.id); await assert.rejects(saveDocument(document), StorageConflictError);
});
test('a save pins the expected revision before asynchronous compression', async () => {
  const document = await saveDocument(board()); document.compressed = true;
  const saving = saveDocument(document); document.revision = 500; document.title = 'Later mutation';
  const saved = await saving; assert.equal(saved.revision, 2); assert.equal(saved.title, 'Local notes');
});
test('shared images survive duplicate deletion and are reclaimed only with the last board', async () => {
  const document = await withImage(); const assetId = document.pages[0].objects[1].assetId!; const copy = await duplicateDocument(document.id);
  assert.notEqual(copy.id, document.id); assert.equal(copy.pages[0].objects[1].assetId, assetId);
  await deleteDocument(document.id); assert.ok(await getAsset(assetId)); assert.ok(await loadDocument(copy.id));
  await deleteDocument(copy.id); assert.equal(await getAsset(assetId), undefined);
});
test('removed images remain available for undo and are cleaned up on board deletion', async () => {
  const document = await withImage(); const assetId = document.pages[0].objects[1].assetId!;
  document.pages[0].objects.pop(); await saveDocument(document); assert.ok(await getAsset(assetId));
  await deleteDocument(document.id); assert.equal(await getAsset(assetId), undefined);
});
test('missing assets and non-finite geometry reject without partial document writes', async () => {
  const document = board(); document.pages[0].objects[0].x = Infinity;
  await assert.rejects(saveDocument(document), /invalid/i); assert.equal((await listDocuments()).length, 0);
  const missing = board(); missing.pdfAssetId = 'missing'; missing.kind = 'pdf';
  await assert.rejects(saveDocument(missing), /missing/i); assert.equal((await listDocuments()).length, 0);
});
test('atomic import transaction rolls back inserted assets when another asset is missing', async () => {
  const document = board(); const inserted = newId();
  document.pdfAssetId = 'missing'; document.kind = 'pdf';
  document.pages[0].objects.push({ id: newId(), type: 'image', x: 0, y: 0, width: 10, height: 10, color: '#000', strokeWidth: 0, opacity: 1, assetId: inserted });
  await assert.rejects(commitDocumentWithAssets(document, [{ id: inserted, blob: png, mime: 'image/png', name: 'Image.png', createdAt: Date.now() }]), /missing/);
  assert.equal(await getAsset(inserted), undefined); assert.equal((await listDocuments()).length, 0);
});
test('compression is lossless and can be reversed', async () => {
  const document = await saveDocument(board()); const compressed = await setDocumentCompressed(document.id, true);
  assert.equal(compressed.compressed, true); assert.deepEqual((await loadDocument(document.id))!.pages, document.pages);
  const restored = await setDocumentCompressed(document.id, false); assert.equal(restored.compressed, false); assert.deepEqual(restored.pages, document.pages);
});
test('unavailable compression leaves the original saved document intact', async () => {
  const document = await saveDocument(board()); const original = globalThis.CompressionStream;
  try {
    Object.defineProperty(globalThis, 'CompressionStream', { value: undefined, configurable: true, writable: true });
    await assert.rejects(setDocumentCompressed(document.id, true), /Leave compression off/);
    assert.deepEqual(await loadDocument(document.id), document);
  } finally { Object.defineProperty(globalThis, 'CompressionStream', { value: original, configurable: true, writable: true }); }
});
test('editable backups round-trip local PDFs, images, text and ink with fresh identifiers', async () => {
  const document = await withImage(); const pdfId = await putAsset(new Blob(['%PDF-1.7\nexample bytes'], { type: 'application/pdf' }), 'Lesson.pdf');
  document.kind = 'pdf'; document.pdfAssetId = pdfId; document.pages[0].pdfPageIndex = 0;
  const saved = await saveDocument(document); const backup = await exportDocumentBackup(saved); const imported = await importDocumentBackup(backup);
  assert.notEqual(imported.id, saved.id); assert.notEqual(imported.pdfAssetId, saved.pdfAssetId); assert.equal(imported.kind, 'pdf'); assert.equal(imported.pages[0].pdfPageIndex, 0);
  assert.deepEqual(imported.pages[0].objects[0].points, saved.pages[0].objects[0].points);
  assert.equal(await (await getAsset(imported.pdfAssetId!))!.blob.text(), '%PDF-1.7\nexample bytes');
  const importedImage = imported.pages[0].objects[1].assetId!;
  assert.notEqual(importedImage, saved.pages[0].objects[1].assetId); assert.deepEqual(await (await getAsset(importedImage))!.blob.arrayBuffer(), await png.arrayBuffer());
  await deleteDocument(saved.id); assert.ok(await getAsset(importedImage)); assert.ok(await getAsset(imported.pdfAssetId!));
});
test('invalid backups, duplicate object IDs and damaged data never modify storage', async () => {
  const saved = await withImage(); const backup = JSON.parse(await (await exportDocumentBackup(saved)).text());
  backup.document.pages[0].objects.push({ ...backup.document.pages[0].objects[0] });
  await assert.rejects(importDocumentBackup(new Blob([JSON.stringify(backup)])), /invalid/i);
  backup.document.pages[0].objects.pop(); backup.assets[0].data = '!!!!';
  await assert.rejects(importDocumentBackup(new Blob([JSON.stringify(backup)])), /invalid/i);
  assert.equal((await listDocuments()).length, 1);
  await assert.rejects(importDocumentBackup(new Blob(['not json'])), /valid JSON/);
});
test('backup enums reject array coercion and revision overflow', async () => {
  const saved = await saveDocument(board()); const source = JSON.parse(await (await exportDocumentBackup(saved)).text());
  for (const mutate of [
    (value: any) => { value.document.kind = ['board']; },
    (value: any) => { value.document.pages[0].pattern = ['dots']; },
    (value: any) => { value.document.pages[0].objects[0].type = ['stroke']; },
    (value: any) => { value.document.pages[0].objects[0].smoothing = ['course']; },
    (value: any) => { value.document.revision = Number.MAX_SAFE_INTEGER; },
  ]) {
    const malformed = structuredClone(source); mutate(malformed);
    await assert.rejects(importDocumentBackup(new Blob([JSON.stringify(malformed)])), /invalid/i);
  }
  assert.equal((await listDocuments()).length, 1);
});
test('oversized backup is rejected before reading or parsing its contents', async () => {
  const oversized = new Blob(['{}']);
  Object.defineProperty(oversized, 'size', { value: MAX_BACKUP_BYTES + 1 });
  Object.defineProperty(oversized, 'text', { value: () => { throw new Error('Contents should not be read'); } });
  await assert.rejects(importDocumentBackup(oversized), /smaller than 250 MB/);
  assert.equal((await listDocuments()).length, 0);
});
test('native desktop editable backup converts absolute ink and reverse arrow coordinates', async () => {
  const native = { Format: 'softboard/1', Title: 'Desktop notes', Document: { Version: 1, Background: 'auto', Pattern: 'ruled', Items: [
    { Id: 'stroke1', Kind: 'stroke', X: 100, Y: 100, Width: 20, Height: 20, Thickness: 3, Color: '#FF123456', Points: [{ X: -10, Y: 30 }, { X: 20, Y: 50 }] },
    { Id: 'arrow1', Kind: 'arrow', X: 100, Y: 100, Width: -80, Height: -20, Color: '#123456' },
  ] }, Assets: {} };
  const document = await importDocumentBackup(new Blob([JSON.stringify(native)]));
  assert.equal(document.title, 'Desktop notes'); assert.equal(document.pages[0].pattern, 'lines');
  assert.deepEqual(document.pages[0].objects[0].points, [[0, 0], [30, 20]]); assert.equal(document.pages[0].objects[0].color, '#123456FF');
  assert.deepEqual(document.pages[0].objects[1].points, [[80, 20], [0, 0]]); assert.ok(document.pages[0].objects[0].x >= 0);
});
test('persistent storage request is honest when browser support is absent', async () => {
  assert.equal(await requestPersistence(), false);
});
