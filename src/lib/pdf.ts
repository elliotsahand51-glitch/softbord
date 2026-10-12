import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { getAsset, putAsset } from './storage';
import type { SoftDocument } from '../types';

GlobalWorkerOptions.workerSrc = workerUrl;
const resourceBase = `${import.meta.env.BASE_URL}pdf/`;

export function pdfError(error: unknown): Error {
  const name = error instanceof Error ? error.name : '';
  if (name === 'PasswordException') return new Error('This PDF is password protected. Save an unlocked copy in your PDF reader, then import that copy.');
  if (name === 'InvalidPDFException') return new Error('This file is not a readable PDF. Try opening it in a PDF reader and saving a new copy.');
  return error instanceof Error ? error : new Error('The PDF could not be opened. Please try another file.');
}

export async function openPdfBytes(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // PDF.js transfers ownership of its input buffer to its worker. Always transfer a copy.
  const task = getDocument({ data: bytes.slice(), cMapUrl: `${resourceBase}cmaps/`, cMapPacked: true,
    standardFontDataUrl: `${resourceBase}standard_fonts/`, wasmUrl: `${resourceBase}wasm/`,
    enableXfa: false });
  try { return await task.promise; }
  catch (error) { await task.destroy().catch(() => undefined); throw pdfError(error); }
}

interface CacheEntry { promise: Promise<PDFDocumentProxy>; users: number; timer?: ReturnType<typeof setTimeout> }
const cache = new Map<string, CacheEntry>();

/** Reference-counted cache; idle documents are released rather than retained indefinitely. */
export async function acquirePdf(assetId: string): Promise<{ pdf: PDFDocumentProxy; release: () => void }> {
  let entry = cache.get(assetId);
  if (!entry) {
    const promise = (async () => {
      const asset = await getAsset(assetId);
      if (!asset) throw new Error('The original PDF is missing from this device. Restore a Softboard backup or import the PDF again.');
      return openPdfBytes(new Uint8Array(await asset.blob.arrayBuffer()));
    })();
    entry = { promise, users: 0 };
    cache.set(assetId, entry);
  }
  const current = entry;
  if (current.timer) clearTimeout(current.timer);
  current.users++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    current.users--;
    if (current.users === 0) current.timer = setTimeout(() => {
      if (current.users !== 0) return;
      if (cache.get(assetId) === current) cache.delete(assetId);
      void current.promise.then(pdf => pdf.destroy()).catch(() => undefined);
    }, 15_000);
  };
  try { return { pdf: await current.promise, release }; }
  catch (error) { release(); if (cache.get(assetId) === current) cache.delete(assetId); throw pdfError(error); }
}

/** Imported documents are returned unsaved; the caller saves once after successful import. */
export async function importPdf(file: File): Promise<SoftDocument> {
  if (!file.size) throw new Error('This PDF is empty. Choose a file with at least one page.');
  if (file.size > 150 * 1024 * 1024) throw new Error('Choose a PDF smaller than 150 MB to keep editing reliable on this device.');
  const sourceBytes = new Uint8Array(await file.arrayBuffer());
  const pdf = await openPdfBytes(sourceBytes);
  try {
    // Some encrypted PDFs can be viewed without a password but cannot be safely
    // rewritten by the local exporter. Reject them before promising edit/export.
    if (await pdf.getPermissions() !== null) throw new Error('This PDF has document encryption. Save an unlocked PDF copy in your PDF reader, then import that copy to annotate and export it.');
    if (pdf.numPages > 2000) throw new Error('This PDF has more than 2,000 pages. Split it into smaller PDFs before importing.');
    const pages: SoftDocument['pages'] = [];
    for (let index = 0; index < pdf.numPages; index++) {
      const source = await pdf.getPage(index + 1);
      const viewport = source.getViewport({ scale: 1 });
      if (!(viewport.width >= 1 && viewport.height >= 1) || !Number.isFinite(viewport.width + viewport.height) || viewport.width > 100_000 || viewport.height > 100_000) throw new Error(`PDF page ${index + 1} has unsupported dimensions. Save a resized copy in your PDF reader before importing.`);
      pages.push({ id: crypto.randomUUID(), width: viewport.width, height: viewport.height,
        pdfPageIndex: index, objects: [], background: '#ffffff', pattern: 'blank' });
      source.cleanup();
    }
    const pdfAssetId = await putAsset(new Blob([sourceBytes], { type: 'application/pdf' }), file.name);
    const now = Date.now();
    return { schemaVersion: 1, id: crypto.randomUUID(), title: file.name.replace(/\.pdf$/i, '').slice(0, 300) || 'Imported PDF',
      kind: 'pdf', pages, pdfAssetId, createdAt: now, updatedAt: now, revision: 0 };
  } finally { await pdf.destroy(); }
}
