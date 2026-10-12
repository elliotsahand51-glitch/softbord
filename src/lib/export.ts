import { PDFDocument, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from 'pdf-lib';
import type { BoardObject, BoardPage, SoftDocument } from '../types';
import { getAsset } from './storage';
import { acquirePdf } from './pdf';
import { boundedRasterScale, overlayMatrix } from './pdfCoordinates';
import { wrapText, textIsRtl, strokePath } from './ink';
import { boardPdfSize, pageBounds, type PageBounds } from './boardBounds';

const escapeXml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!));
const n = (value: number) => Number.isFinite(value) ? Number(value.toFixed(5)) : 0;
const rtl = textIsRtl;

async function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onerror = () => reject(new Error('Could not read an image for export.'));
    reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob);
  });
}

function pageAt(doc: SoftDocument, index: number): BoardPage {
  const page = doc.pages[index];
  if (!page) throw new Error('This page no longer exists. Choose another page and export again.');
  return page;
}

async function objectSvg(object: BoardObject, imageCache: Map<string, string>): Promise<string> {
  const o = object, color = escapeXml(o.color), w = n(o.width), h = n(o.height);
  let contents = '';
  const stroke = `stroke="${color}" stroke-width="${n(o.strokeWidth)}" stroke-linecap="round" stroke-linejoin="round"`;
  if (o.type === 'stroke' || o.type === 'highlight') {
    const path = o.path || strokePath(o.points || [], o.smoothing, o.smoothingScale);
    contents = `<path d="${escapeXml(path)}" fill="none" ${stroke}/>`;
  } else if (o.type === 'rect') contents = `<rect width="${w}" height="${h}" fill="${escapeXml(o.fill || 'none')}" ${stroke}/>`;
  else if (o.type === 'ellipse') contents = `<ellipse cx="${w / 2}" cy="${h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${escapeXml(o.fill || 'none')}" ${stroke}/>`;
  else if (o.type === 'line' || o.type === 'arrow') {
    const [start, end] = o.points?.length && o.points.length >= 2 ? [o.points[0], o.points[o.points.length - 1]] : [[0, 0], [w, h]];
    let d = `M${n(start[0])} ${n(start[1])} L${n(end[0])} ${n(end[1])}`;
    if (o.type === 'arrow') {
      const angle = Math.atan2(end[1] - start[1], end[0] - start[0]);
      const length = Math.max(12, o.strokeWidth * 4);
      d += ` M${n(end[0] - length * Math.cos(angle - Math.PI / 6))} ${n(end[1] - length * Math.sin(angle - Math.PI / 6))} L${n(end[0])} ${n(end[1])} L${n(end[0] - length * Math.cos(angle + Math.PI / 6))} ${n(end[1] - length * Math.sin(angle + Math.PI / 6))}`;
    }
    contents = `<path d="${d}" fill="none" ${stroke}/>`;
  } else if (o.type === 'image') {
    if (!o.assetId) throw new Error('An image has no saved source. Remove it or add it again before exporting.');
    let source = imageCache.get(o.assetId);
    if (!source) {
      const asset = await getAsset(o.assetId);
      if (!asset) throw new Error('An image is missing from local storage. Restore a Softboard backup before exporting.');
      source = await dataUrl(asset.blob); imageCache.set(o.assetId, source);
    }
    contents = `<image width="${w}" height="${h}" href="${escapeXml(source)}" preserveAspectRatio="none"/>`;
  } else if (o.type === 'text' || o.type === 'note' || o.type === 'link') {
    const padding = o.type === 'note' ? 12 : 0;
    const size = o.fontSize || 20;
    const lines = wrapText(o.text || '', o.width, size, padding, o.bold);
    if (o.type === 'note') contents = `<rect width="${w}" height="${h}" rx="10" fill="${escapeXml(o.fill || '#fff2ae')}"/>`;
    contents += lines.map((line, index) => `<text x="${rtl(line) ? w - padding : padding}" y="${n(padding + size + index * size * 1.3)}" font-family="Arial,sans-serif" font-size="${size}" font-weight="${o.bold ? 700 : 400}" fill="${color}" direction="${rtl(line) ? 'rtl' : 'ltr'}" text-anchor="start" unicode-bidi="plaintext"${o.type === 'link' ? ' text-decoration="underline"' : ''}>${escapeXml(line)}</text>`).join('');
  }
  return `<g transform="translate(${n(o.x)} ${n(o.y)}) rotate(${n(o.rotation || 0)} ${w / 2} ${h / 2})" opacity="${n(o.opacity)}">${contents}</g>`;
}

function paperSvg(page: BoardPage, bounds: PageBounds): string {
  const frame = `x="${n(bounds.x)}" y="${n(bounds.y)}" width="${n(bounds.width)}" height="${n(bounds.height)}"`;
  let contents = `<rect ${frame} fill="${escapeXml(page.background)}"/>`;
  if (page.pattern !== 'blank') {
    const motif = page.pattern === 'dots' ? '<circle cx="2" cy="2" r="1" fill="#c9d2dd"/>' : page.pattern === 'grid' ? '<path d="M24 0H0V24" fill="none" stroke="#dbe1e9" stroke-width=".7"/>' : '<path d="M0 23.5H24" stroke="#dbe1e9" stroke-width=".7"/>';
    contents += `<defs><pattern id="paperPattern" width="24" height="24" patternUnits="userSpaceOnUse">${motif}</pattern></defs><rect ${frame} fill="url(#paperPattern)"/>`;
  }
  return contents;
}

async function createSvg(doc: SoftDocument, pageIndex: number, background: boolean, rasterSize?: { width: number; height: number }): Promise<string> {
  const page = pageAt(doc, pageIndex);
  const bounds = pageBounds(page);
  const imageCache = new Map<string, string>();
  const items: string[] = [];
  // A sequential walk avoids large parallel image allocations on mobile devices.
  for (const object of page.objects) items.push(await objectSvg(object, imageCache));
  let paper = '';
  if (background) {
    if (page.pdfPageIndex !== undefined && doc.pdfAssetId) {
      const canvas = await renderPdfBackground(doc, pageIndex, 1.5);
      try { paper = `<image width="${page.width}" height="${page.height}" href="${canvas.toDataURL('image/png')}"/>`; }
      finally { canvas.width = canvas.height = 0; }
    } else paper = paperSvg(page, bounds);
  }
  const size = rasterSize ?? bounds;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${n(size.width)}" height="${n(size.height)}" viewBox="${n(bounds.x)} ${n(bounds.y)} ${n(bounds.width)} ${n(bounds.height)}" preserveAspectRatio="none">${paper}${items.join('')}</svg>`;
}

/** Standalone SVG with images embedded. PDF page backgrounds are rendered locally. */
export function buildPageSvg(doc: SoftDocument, pageIndex: number): Promise<string> { return createSvg(doc, pageIndex, true); }

async function svgImage(svg: string): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('Could not render the page for export. Please try again.')); image.src = url;
    });
    return image;
  } finally { URL.revokeObjectURL(url); }
}

function makeCanvas(page: { width: number; height: number }, desiredScale: number): { canvas: HTMLCanvasElement; scale: number; context: CanvasRenderingContext2D } {
  const scale = boundedRasterScale(page.width, page.height, desiredScale);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(page.width * scale)); canvas.height = Math.max(1, Math.ceil(page.height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser could not allocate an export canvas. Close other tabs and try again.');
  return { canvas, scale, context };
}

async function renderPdfBackground(doc: SoftDocument, index: number, density: number): Promise<HTMLCanvasElement> {
  const page = pageAt(doc, index);
  if (!doc.pdfAssetId || page.pdfPageIndex === undefined) throw new Error('Missing PDF source.');
  const { pdf, release } = await acquirePdf(doc.pdfAssetId);
  let canvas: HTMLCanvasElement | undefined;
  try {
    const source = await pdf.getPage(page.pdfPageIndex + 1);
    const raster = makeCanvas(page, density); canvas = raster.canvas;
    await source.render({ canvas, viewport: source.getViewport({ scale: raster.scale }) }).promise;
    return canvas;
  } catch (error) { if (canvas) canvas.width = canvas.height = 0; throw error; }
  finally { release(); }
}

async function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('The browser could not encode this page. Try exporting one page at a time.')), 'image/png'));
}

async function overlayPng(doc: SoftDocument, index: number, includePaper: boolean): Promise<Blob> {
  const page = pageAt(doc, index);
  const { canvas, context } = makeCanvas(pageBounds(page), 2.5);
  try {
    // Give the SVG a bounded intrinsic size too: a huge natural SVG size can
    // otherwise trigger a browser allocation before it reaches our canvas.
    const svg = await createSvg(doc, index, includePaper, canvas);
    const image = await svgImage(svg);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas);
  } finally { canvas.width = canvas.height = 0; }
}

/** Current page PNG including original PDF, paper, and all visible objects. */
export async function exportPng(doc: SoftDocument, pageIndex: number): Promise<Blob> {
  const page = pageAt(doc, pageIndex);
  if (page.pdfPageIndex === undefined || !doc.pdfAssetId) return overlayPng(doc, pageIndex, true);
  const canvas = await renderPdfBackground(doc, pageIndex, 2.5);
  try {
    const image = await svgImage(await createSvg(doc, pageIndex, false));
    canvas.getContext('2d')!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await canvasBlob(canvas);
  } finally { canvas.width = canvas.height = 0; }
}

/** Keep original PDF content vector/selectable; additions are flattened for portable viewing.
 * Editable object data remains in the local document and in .softboard backups.
 */
export async function exportPdf(doc: SoftDocument, onProgress?: (completed: number, total: number) => void): Promise<Blob> {
  if (!doc.pages.length) throw new Error('Add a page before exporting.');
  const output = await PDFDocument.create();
  output.setTitle(doc.title); output.setCreator('Softboard Web'); output.setProducer('Softboard Web • local export');
  let sourcePdf: PDFDocument | undefined;
  let acquired: Awaited<ReturnType<typeof acquirePdf>> | undefined;
  try {
    if (doc.pages.some(page => page.pdfPageIndex !== undefined)) {
      if (!doc.pdfAssetId) throw new Error('The original PDF source is missing. Restore a Softboard backup.');
      const asset = await getAsset(doc.pdfAssetId);
      if (!asset) throw new Error('The original PDF source is missing. Restore a Softboard backup.');
      try { sourcePdf = await PDFDocument.load(await asset.blob.arrayBuffer()); }
      catch (error) {
        if (error instanceof Error && /encrypt/i.test(error.message)) throw new Error('This PDF is encrypted. Import an unlocked copy from your PDF reader before exporting annotations.');
        throw error;
      }
      acquired = await acquirePdf(doc.pdfAssetId);
    }
    onProgress?.(0, doc.pages.length);
    for (let index = 0; index < doc.pages.length; index++) {
      const page = doc.pages[index];
      let target;
      let transform: readonly number[] = [1, 0, 0, -1, 0, page.height];
      if (page.pdfPageIndex !== undefined && sourcePdf && acquired) {
        const [copied] = await output.copyPages(sourcePdf, [page.pdfPageIndex]);
        target = output.addPage(copied);
        const sourcePage = await acquired.pdf.getPage(page.pdfPageIndex + 1);
        transform = sourcePage.getViewport({ scale: 1 }).transform;
      } else {
        const size = boardPdfSize(pageBounds(page));
        target = output.addPage([size.width, size.height]);
        transform = [1, 0, 0, -1, 0, size.height];
      }
      if (page.objects.length || page.pdfPageIndex === undefined) {
        const overlay = await overlayPng(doc, index, page.pdfPageIndex === undefined);
        const image = await output.embedPng(await overlay.arrayBuffer());
        const key = target.node.newXObject('SoftboardOverlay', image.ref);
        const size = page.pdfPageIndex === undefined ? boardPdfSize(pageBounds(page)) : page;
        const matrix = overlayMatrix(transform, size.width, size.height);
        target.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix), drawObject(key), popGraphicsState());
      }
      onProgress?.(index + 1, doc.pages.length);
      // Yield between pages, so long exports do not freeze progress controls.
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }
    const bytes = await output.save();
    return new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' });
  } finally { acquired?.release(); }
}
