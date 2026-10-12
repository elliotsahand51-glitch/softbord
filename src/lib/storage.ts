import type { AssetRecord, BoardObject, DocumentSummary, SoftDocument } from '../types';

/** Documents and their binary assets live exclusively in this browser's IndexedDB. */
export const DATABASE_NAME = 'softboard-web-local';
export const MAX_ASSET_BYTES = 150 * 1024 * 1024;
export const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024;
const DB_VERSION = 1;
const kinds = new Set(['stroke', 'highlight', 'rect', 'ellipse', 'line', 'arrow', 'text', 'note', 'image', 'link']);
const imageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp', 'image/avif']);
interface StoredDocument { id: string; summary: DocumentSummary; assetIds: string[]; payload: Blob; encoding: 'json'|'gzip'; }

export class StorageConflictError extends Error {
  constructor() { super('This document changed in another tab. Reopen the saved document before editing, or export your current work as an editable backup.'); this.name = 'StorageConflictError'; }
}
export class MissingAssetError extends Error {
  constructor(id: string) { super(`A document image or PDF is missing from local storage (${id}). Restore an editable backup to recover it.`); this.name = 'MissingAssetError'; }
}
export class CompressionUnsupportedError extends Error {
  constructor() { super('This browser cannot compress local documents. Leave compression off, or use a current Safari, Chrome, Edge, or Firefox browser.'); this.name = 'CompressionUnsupportedError'; }
}

export function newId(): string { return crypto.randomUUID(); }
function invalid(message: string): never { throw new Error(`Invalid Softboard document: ${message}`); }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function finite(value: unknown, min = -1e8, max = 1e8): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max; }
function string(value: unknown, max: number, allowEmpty = true): value is string { return typeof value === 'string' && value.length <= max && (allowEmpty || value.length > 0); }
function color(value: unknown): boolean { return string(value, 100, false) && /^(#[a-fA-F0-9]{3,8}|[a-zA-Z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/.test(value); }

/** Validate before serialization: JSON would otherwise silently turn NaN/Infinity into null. */
export function validateDocument(value: unknown): asserts value is SoftDocument {
  if (!record(value) || value.schemaVersion !== 1 || !string(value.id, 160, false) || !string(value.title, 300, false)
    || typeof value.kind !== 'string' || !['board', 'pdf'].includes(value.kind) || !Number.isSafeInteger(value.revision) || (value.revision as number) < 0 || (value.revision as number) >= Number.MAX_SAFE_INTEGER
    || !finite(value.createdAt, 0, 1e15) || !finite(value.updatedAt, 0, 1e15)
    || !Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 2000) invalid('unsupported format or invalid document settings.');
  if (value.compressed !== undefined && typeof value.compressed !== 'boolean') invalid('invalid compression setting.');
  if (value.thumbnail !== undefined && (!string(value.thumbnail, 2_000_000) || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.thumbnail))) invalid('invalid thumbnail.');
  if (value.pdfAssetId !== undefined && !string(value.pdfAssetId, 160, false)) invalid('invalid PDF asset.');
  if (value.kind === 'pdf' && !value.pdfAssetId) invalid('PDF source is missing.');
  const pageIds = new Set<string>(); const objectIds = new Set<string>();
  let count = 0; let points = 0;
  for (const page of value.pages) {
    if (!record(page) || !string(page.id, 160, false) || pageIds.has(page.id) || !finite(page.width, 1, 100_000)
      || !finite(page.height, 1, 100_000) || !color(page.background) || typeof page.pattern !== 'string' || !['dots', 'grid', 'lines', 'blank'].includes(page.pattern) || !Array.isArray(page.objects)) invalid('invalid or duplicate page.');
    pageIds.add(page.id);
    if (page.pdfPageIndex !== undefined && (!Number.isSafeInteger(page.pdfPageIndex) || (page.pdfPageIndex as number) < 0 || (page.pdfPageIndex as number) > 100_000 || !value.pdfAssetId)) invalid('invalid PDF page index.');
    count += page.objects.length; if (count > 250_000) invalid('too many objects (maximum 250,000).');
    for (const item of page.objects) {
      if (!record(item) || !string(item.id, 160, false) || objectIds.has(item.id) || typeof item.type !== 'string' || !kinds.has(item.type)
        || !finite(item.x) || !finite(item.y) || !finite(item.width, 0) || !finite(item.height, 0) || !color(item.color)
        || !finite(item.strokeWidth, 0, 10_000) || !finite(item.opacity, 0, 1)) invalid('invalid or duplicate drawing object.');
      objectIds.add(item.id);
      if (item.rotation !== undefined && !finite(item.rotation, -1e6, 1e6)) invalid('invalid object rotation.');
      if (item.locked !== undefined && typeof item.locked !== 'boolean') invalid('invalid lock setting.');
      if (item.bold !== undefined && typeof item.bold !== 'boolean') invalid('invalid font setting.');
      if (item.fill !== undefined && !color(item.fill)) invalid('invalid fill color.');
      if (item.fontSize !== undefined && !finite(item.fontSize, 1, 10_000)) invalid('invalid font size.');
      if (item.smoothingScale !== undefined && !finite(item.smoothingScale, .01, 8)) invalid('invalid drawing zoom.');
      if (item.text !== undefined && !string(item.text, 500_000)) invalid('text is too long.');
      if (item.assetId !== undefined && !string(item.assetId, 160, false)) invalid('invalid image reference.');
      if (item.type === 'image' && !item.assetId) invalid('image source is missing.');
      if (item.smoothing !== undefined && (typeof item.smoothing !== 'string' || !['course', 'raw'].includes(item.smoothing))) invalid('invalid ink smoothing.');
      if (item.path !== undefined && (!string(item.path, 10_000_000) || !/^[MmZzLlHhVvCcSsQqTtAaEe\d\s.,+\-]*$/.test(item.path))) invalid('invalid ink path.');
      if (item.url !== undefined && (!string(item.url, 4000) || (item.url !== '' && !/^(https?:\/\/|mailto:)/i.test(item.url)))) invalid('links must use https, http, or mailto.');
      if (item.points !== undefined) {
        if (!Array.isArray(item.points)) invalid('invalid ink points.');
        points += item.points.length; if (points > 2_000_000) invalid('too many ink points (maximum 2 million).');
        for (const point of item.points) if (!Array.isArray(point) || point.length !== 2 || !finite(point[0]) || !finite(point[1])) invalid('invalid ink coordinates.');
      }
      if ((item.type === 'stroke' || item.type === 'highlight') && !item.path && (!Array.isArray(item.points) || item.points.length === 0)) invalid('ink has no points or path.');
    }
  }
}

export function referencedAssetIds(document: SoftDocument): string[] {
  return [...new Set([document.pdfAssetId, ...document.pages.flatMap(page => page.objects.map(object => object.assetId))].filter((id): id is string => !!id))];
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Local browser storage is unavailable. Open Softboard in a regular browser window.')); return; }
    const request = indexedDB.open(DATABASE_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) db.createObjectStore('documents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error ?? new Error('Unable to open local document storage.'));
    request.onblocked = () => reject(new Error('Another Softboard tab is blocking a storage upgrade. Close the other tab and try again.'));
  });
}

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('The local storage transaction was cancelled. No partial document was saved.'));
    transaction.onerror = () => { /* onabort is the final failure signal. */ };
  });
}

async function withRead<T>(store: 'assets'|'documents', action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try { const tx = db.transaction(store, 'readonly'); const done = transactionDone(tx); const result = await requestValue(action(tx.objectStore(store))); await done; return result; }
  finally { db.close(); }
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number): Promise<Blob> {
  const reader = stream.getReader(); const chunks: Uint8Array<ArrayBuffer>[] = []; let total = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; total += value.length; if (total > limit) { await reader.cancel(); throw new Error('The document exceeds the supported local size limit.'); } chunks.push(new Uint8Array(value)); }
  } finally { reader.releaseLock(); }
  return new Blob(chunks);
}

async function preparePayload(document: SoftDocument): Promise<{ payload: Blob; encoding: StoredDocument['encoding'] }> {
  const json = new Blob([JSON.stringify(document)], { type: 'application/json' });
  if (json.size > MAX_DOCUMENT_BYTES) throw new Error('This document has too much drawing data (maximum 40 MB). Split it into smaller boards.');
  if (!document.compressed) return { payload: json, encoding: 'json' };
  if (typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') throw new CompressionUnsupportedError();
  const payload = await readBounded(json.stream().pipeThrough(new CompressionStream('gzip')), MAX_DOCUMENT_BYTES);
  return { payload, encoding: 'gzip' };
}

async function decode(row: StoredDocument): Promise<SoftDocument> {
  let payload = row.payload;
  if (row.encoding === 'gzip') {
    if (typeof DecompressionStream === 'undefined') throw new Error('This document is compressed. Open it in a current Safari, Chrome, Edge, or Firefox browser to read it.');
    payload = await readBounded(payload.stream().pipeThrough(new DecompressionStream('gzip')), MAX_DOCUMENT_BYTES);
  }
  const value: unknown = JSON.parse(await payload.text()); validateDocument(value); return value;
}

export async function listDocuments(): Promise<DocumentSummary[]> {
  const rows = await withRead<StoredDocument[]>('documents', store => store.getAll());
  return rows.map(row => row.summary).sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function loadDocument(id: string): Promise<SoftDocument | undefined> {
  const row = await withRead<StoredDocument|undefined>('documents', store => store.get(id));
  return row ? decode(row) : undefined;
}
export async function getAsset(id: string): Promise<AssetRecord | undefined> { return withRead('assets', store => store.get(id)); }

function validateAsset(asset: AssetRecord): void {
  if (!string(asset.id, 160, false) || !(asset.blob instanceof Blob) || asset.blob.size === 0 || asset.blob.size > MAX_ASSET_BYTES
    || !string(asset.name, 500, false) || !finite(asset.createdAt, 0, 1e15) || (asset.mime !== 'application/pdf' && !imageTypes.has(asset.mime))) {
    throw new Error('Use a PDF or PNG, JPEG, WebP, GIF, BMP, or AVIF image smaller than 150 MB.');
  }
}

export async function putAsset(blob: Blob, name: string): Promise<string> {
  const asset: AssetRecord = { id: newId(), blob, name: name.slice(0, 500) || 'Untitled asset', mime: blob.type, createdAt: Date.now() }; validateAsset(asset);
  const db = await openDatabase();
  try { const tx = db.transaction('assets', 'readwrite'); const done = transactionDone(tx); tx.objectStore('assets').add(asset); await done; return asset.id; }
  finally { db.close(); }
}

/** One transaction checks the revision, inserts all import assets, and writes the document. */
export async function commitDocumentWithAssets(input: SoftDocument, importedAssets: AssetRecord[] = []): Promise<SoftDocument> {
  validateDocument(input); importedAssets.forEach(validateAsset);
  const document: SoftDocument = structuredClone(input);
  const expectedRevision = document.revision;
  const stagedAssets = importedAssets.map(asset => ({ ...asset }));
  document.revision++; document.updatedAt = Date.now(); document.compressed = !!document.compressed;
  const { payload, encoding } = await preparePayload(document);
  const assetIds = referencedAssetIds(document);
  const imageIds = new Set(document.pages.flatMap(page => page.objects.filter(object => object.type === 'image').map(object => object.assetId!)));
  const db = await openDatabase();
  try {
    const tx = db.transaction(['documents', 'assets'], 'readwrite');
    const done = transactionDone(tx); // Attach rejection handler before issuing requests.
    const documents = tx.objectStore('documents'); const assets = tx.objectStore('assets');
    let domainError: Error | undefined;
    const fail = (error: Error) => { domainError = error; tx.abort(); };
    const previous = documents.get(document.id);
    previous.onsuccess = () => {
      const stored = previous.result as StoredDocument | undefined;
      if (stored ? stored.summary.revision !== expectedRevision : expectedRevision !== 0) { fail(new StorageConflictError()); return; }
      const importIds = new Set<string>();
      for (const asset of stagedAssets) {
        if (importIds.has(asset.id) || !assetIds.includes(asset.id)) { fail(new Error('The import contains duplicate or unused assets.')); return; }
        importIds.add(asset.id); assets.add(asset);
      }
      let remaining = assetIds.length; let size = payload.size;
      const finish = () => {
        const { pages, ...metadata } = document;
        const summary: DocumentSummary = { ...metadata, pageCount: pages.length, objectCount: pages.reduce((sum, page) => sum + page.objects.length, 0), size };
        // Retain removed image references until document deletion: in-session undo can
        // still restore them. Deleting the document then reclaims its entire history.
        const retainedAssetIds = [...new Set([...(stored?.assetIds ?? []), ...assetIds])];
        documents.put({ id: document.id, summary, assetIds: retainedAssetIds, payload, encoding } satisfies StoredDocument);
      };
      if (remaining === 0) finish();
      for (const id of assetIds) {
        const request = assets.get(id);
        request.onsuccess = () => {
          const asset = request.result as AssetRecord|undefined;
          if (!asset) { fail(new MissingAssetError(id)); return; }
          if ((id === document.pdfAssetId && asset.mime !== 'application/pdf') || (imageIds.has(id) && !imageTypes.has(asset.mime))) { fail(new Error('An asset has the wrong type for this document.')); return; }
          size += asset.blob.size; remaining--; if (remaining === 0) finish();
        };
      }
    };
    try { await done; } catch (error) { if (domainError) throw domainError; if (error instanceof DOMException && error.name === 'QuotaExceededError') throw new Error('This device is out of browser storage. Export an editable backup, then remove unneeded boards or free device space.'); throw error; }
    return document;
  } finally { db.close(); }
}
export async function saveDocument(document: SoftDocument): Promise<SoftDocument> { return commitDocumentWithAssets(document); }

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(['documents', 'assets'], 'readwrite'); const done = transactionDone(tx);
    const documents = tx.objectStore('documents'); const request = documents.getAll();
    request.onsuccess = () => {
      const rows = request.result as StoredDocument[]; const removed = rows.find(row => row.id === id);
      if (!removed) return;
      const retained = new Set(rows.filter(row => row.id !== id).flatMap(row => row.assetIds));
      documents.delete(id);
      for (const assetId of removed.assetIds) if (!retained.has(assetId)) tx.objectStore('assets').delete(assetId);
    };
    await done;
  } finally { db.close(); }
}
export async function duplicateDocument(id: string): Promise<SoftDocument> {
  const document = await loadDocument(id); if (!document) throw new Error('This document no longer exists.');
  const now = Date.now();
  return saveDocument({ ...document, id: newId(), title: `${document.title.slice(0, 290)} (copy)`, revision: 0, createdAt: now, updatedAt: now });
}
export async function setDocumentCompressed(id: string, compressed: boolean): Promise<SoftDocument> {
  const document = await loadDocument(id); if (!document) throw new Error('This document no longer exists.');
  if (!!document.compressed === compressed) return document;
  return saveDocument({ ...document, compressed });
}
export async function requestPersistence(): Promise<boolean> {
  try { if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false; return await navigator.storage.persisted() || await navigator.storage.persist(); }
  catch { return false; }
}

/** A copied object gets its own identifier while keeping immutable binary references. */
export function cloneObject(object: BoardObject): BoardObject { return { ...structuredClone(object), id: newId() }; }
