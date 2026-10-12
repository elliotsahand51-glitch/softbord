import type { AssetRecord, BoardObject, Point, SoftDocument } from '../types';
import { commitDocumentWithAssets, getAsset, MAX_ASSET_BYTES, MissingAssetError, newId, referencedAssetIds, validateDocument } from './storage';

export const MAX_BACKUP_BYTES = 250 * 1024 * 1024;
interface PortableAsset { id: string; name: string; mime: string; data: string; }
interface PortableBackup { format: 'softboard-web/1'; document: SoftDocument; assets: PortableAsset[]; }
type JsonRecord = Record<string, unknown>;
function record(value: unknown): value is JsonRecord { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function text(value: unknown, fallback: string, max = 500_000): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error('The backup contains invalid or excessive text.');
  return value;
}
function number(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e8) throw new Error('The backup contains invalid coordinates.');
  return value;
}

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  // Each chunk is divisible by three so padding never appears between chunks.
  for (let offset = 0; offset < bytes.length; offset += 24_576) parts.push(btoa(String.fromCharCode(...bytes.subarray(offset, offset + 24_576))));
  return parts.join('');
}
function fromBase64(value: unknown): Uint8Array<ArrayBuffer> {
  if (typeof value !== 'string' || value.length === 0 || value.length > Math.ceil(MAX_ASSET_BYTES / 3) * 4
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('The backup has invalid or oversized embedded file data.');
  let binary: string;
  try { binary = atob(value); } catch { throw new Error('The backup contains damaged embedded file data.'); }
  if (binary.length === 0 || binary.length > MAX_ASSET_BYTES) throw new Error('An embedded file exceeds the 150 MB limit.');
  const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
function detectMime(bytes: Uint8Array): string {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71 && bytes[4] === 13 && bytes[5] === 10 && bytes[6] === 26 && bytes[7] === 10) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  const header = new TextDecoder('latin1').decode(bytes.subarray(0, 32));
  if (/^GIF8[79]a/.test(header)) return 'image/gif';
  if (header.startsWith('BM')) return 'image/bmp';
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') return 'image/webp';
  if (header.slice(4, 8) === 'ftyp' && /avif|avis/.test(header.slice(8))) return 'image/avif';
  if (new TextDecoder('latin1').decode(bytes.subarray(0, 1024)).includes('%PDF-')) return 'application/pdf';
  throw new Error('An embedded file is not a supported PDF or image.');
}

/** A portable, editable snapshot includes every referenced PDF and image. */
export async function exportDocumentBackup(input: SoftDocument): Promise<Blob> {
  validateDocument(input); const document = structuredClone(input); const assets: PortableAsset[] = [];
  let estimatedSize = new Blob([JSON.stringify(document)]).size;
  for (const id of referencedAssetIds(document)) {
    const asset = await getAsset(id); if (!asset) throw new MissingAssetError(id);
    estimatedSize += Math.ceil(asset.blob.size / 3) * 4 + asset.name.length + 200;
    if (estimatedSize > MAX_BACKUP_BYTES) throw new Error('This editable backup exceeds 250 MB. Split the document into smaller boards before exporting.');
    assets.push({ id, name: asset.name, mime: asset.mime, data: toBase64(new Uint8Array(await asset.blob.arrayBuffer())) });
  }
  const backup: PortableBackup = { format: 'softboard-web/1', document, assets };
  const blob = new Blob([JSON.stringify(backup)], { type: 'application/json' });
  if (blob.size > MAX_BACKUP_BYTES) throw new Error('This editable backup exceeds 250 MB. Split the document into smaller boards before exporting.');
  return blob;
}

function portableAssets(value: unknown): AssetRecord[] {
  if (!Array.isArray(value) || value.length > 10_000) throw new Error('The backup has an invalid asset list.');
  const seen = new Set<string>();
  return value.map(entry => {
    if (!record(entry) || typeof entry.id !== 'string' || !entry.id || entry.id.length > 160 || seen.has(entry.id)
      || typeof entry.name !== 'string' || !entry.name || entry.name.length > 500 || typeof entry.mime !== 'string') throw new Error('The backup has invalid or duplicate embedded files.');
    seen.add(entry.id); const bytes = fromBase64(entry.data); const mime = detectMime(bytes);
    if (mime !== entry.mime) throw new Error('An embedded file does not match its declared type.');
    return { id: entry.id, name: entry.name, mime, blob: new Blob([bytes], { type: mime }), createdAt: Date.now() };
  });
}

function nativeColor(value: unknown, fallback: string): string {
  const color = text(value, fallback, 100);
  // WPF uses ARGB; CSS uses RGBA.
  return /^#[A-Fa-f0-9]{8}$/.test(color) ? `#${color.slice(3)}${color.slice(1, 3)}` : color;
}
function nativeObject(entry: unknown): BoardObject {
  if (!record(entry)) throw new Error('The desktop backup contains an invalid object.');
  const kind = text(entry.Kind, '', 30);
  const map: Record<string, BoardObject['type']> = { stroke: 'stroke', rectangle: 'rect', ellipse: 'ellipse', line: 'line', arrow: 'arrow', text: 'text', note: 'note', image: 'image', link: 'link', reaction: 'text' };
  if (!map[kind]) throw new Error(`The desktop backup contains a ${kind || 'missing'} object type that cannot yet be imported. Export that board as PDF in desktop Softboard to preserve its appearance.`);
  const id = text(entry.Id, '', 160); if (!id) throw new Error('A desktop object is missing its identifier.');
  const x = number(entry.X, 0); const y = number(entry.Y, 0); const width = number(entry.Width, 0); const height = number(entry.Height, 0);
  const object: BoardObject = {
    id, type: map[kind], x: Math.min(x, x + width), y: Math.min(y, y + height), width: Math.abs(width), height: Math.abs(height),
    color: nativeColor(entry.Color, '#242b39'), fill: nativeColor(entry.Fill, '#fff3a6'),
    strokeWidth: number(entry.Thickness, 3), opacity: number(entry.Opacity, 1), rotation: number(entry.Rotation, 0),
    text: text(entry.Text, ''), fontSize: number(entry.FontSize, 0) || (kind === 'reaction' ? 52 : 21), bold: entry.Bold === true, locked: entry.Locked === true,
  };
  if (kind === 'image') object.assetId = text(entry.AssetId, '', 160);
  if (kind === 'link' && /^(https?:\/\/|mailto:)/i.test(object.text!)) object.url = object.text;
  if (kind === 'line' || kind === 'arrow') {
    object.points = [[x - object.x, y - object.y], [x + width - object.x, y + height - object.y]];
    if (entry.ArrowStart === true) throw new Error('This desktop board contains a start-arrow marker that cannot yet be imported. Export it as PDF in desktop Softboard to preserve its appearance.');
    if (entry.ArrowEnd === true) object.type = 'arrow';
  }
  if (kind === 'stroke') {
    if (!Array.isArray(entry.Points) || entry.Points.length < 1 || entry.Points.length > 2_000_000) throw new Error('A desktop stroke has invalid points.');
    const points: Point[] = entry.Points.map(point => { if (!record(point)) throw new Error('A desktop stroke has invalid points.'); return [number(point.X, NaN), number(point.Y, NaN)]; });
    let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity;
    for (const [px, py] of points) { left = Math.min(left, px); top = Math.min(top, py); right = Math.max(right, px); bottom = Math.max(bottom, py); }
    object.x = left; object.y = top; object.width = right - left; object.height = bottom - top;
    object.points = points.map(([px, py]) => [px - left, py - top]); object.smoothing = 'course'; object.rotation = 0;
    delete object.fill;
  }
  return object;
}

function convertNative(value: JsonRecord): { document: SoftDocument; assets: AssetRecord[] } {
  if (!record(value.Document) || value.Document.Version !== 1 || !Array.isArray(value.Document.Items) || value.Document.Items.length > 100_000 || !record(value.Assets)) throw new Error('This desktop Softboard backup is unsupported or damaged.');
  const objects = value.Document.Items.map(nativeObject);
  let left = 0; let top = 0; let right = 1440; let bottom = 1000;
  for (const object of objects) {
    const angle = (object.rotation ?? 0) * Math.PI / 180; const cos = Math.cos(angle); const sin = Math.sin(angle);
    const rx = Math.abs(object.width * cos / 2) + Math.abs(object.height * sin / 2) + object.strokeWidth;
    const ry = Math.abs(object.width * sin / 2) + Math.abs(object.height * cos / 2) + object.strokeWidth;
    const cx = object.x + object.width / 2; const cy = object.y + object.height / 2;
    left = Math.min(left, cx - rx); top = Math.min(top, cy - ry); right = Math.max(right, cx + rx); bottom = Math.max(bottom, cy + ry);
  }
  for (const object of objects) { object.x += 48 - left; object.y += 48 - top; }
  const now = Date.now();
  const pattern = text(value.Document.Pattern, 'dots', 30);
  if (!['dots', 'blank', 'grid', 'ruled'].includes(pattern)) throw new Error('The desktop backup has an unknown page pattern.');
  const document: SoftDocument = { schemaVersion: 1, id: newId(), title: text(value.Title, 'Imported desktop board', 300) || 'Imported desktop board', kind: 'board', createdAt: now, updatedAt: now, revision: 0,
    pages: [{ id: newId(), width: Math.ceil(right - left + 96), height: Math.ceil(bottom - top + 96), objects, background: value.Document.Background === 'auto' ? '#fffdf9' : nativeColor(value.Document.Background, '#fffdf9'), pattern: pattern === 'ruled' ? 'lines' : pattern as 'dots'|'blank'|'grid' }] };
  validateDocument(document);
  const assets: AssetRecord[] = [];
  for (const id of referencedAssetIds(document)) {
    const encoded = value.Assets[id]; if (!encoded) throw new Error('A desktop board image is missing from this backup.');
    const bytes = fromBase64(encoded); const mime = detectMime(bytes); if (!mime.startsWith('image/')) throw new Error('A desktop board image is not a supported image file.');
    assets.push({ id, name: `Desktop image ${assets.length + 1}`, mime, blob: new Blob([bytes], { type: mime }), createdAt: now });
  }
  return { document, assets };
}

/** Parse and validate everything before a single atomic database transaction. */
export async function importDocumentBackup(file: File|Blob): Promise<SoftDocument> {
  if (file.size < 2 || file.size > MAX_BACKUP_BYTES) throw new Error('Choose an editable Softboard JSON backup smaller than 250 MB.');
  let value: unknown;
  try { value = JSON.parse(await file.text()); } catch { throw new Error('This is not valid JSON. Choose an editable Softboard backup file.'); }
  if (!record(value)) throw new Error('This is not an editable Softboard backup.');
  let document: SoftDocument; let assets: AssetRecord[];
  if (value.Format === 'softboard/1') ({ document, assets } = convertNative(value));
  else {
    if (value.format !== 'softboard-web/1') throw new Error('This backup version is not supported. Choose a Softboard Web or desktop Softboard editable JSON backup.');
    validateDocument(value.document); document = structuredClone(value.document); assets = portableAssets(value.assets);
  }
  const references = new Set(referencedAssetIds(document));
  const imported = new Set(assets.map(asset => asset.id));
  if (references.size !== imported.size || [...references].some(id => !imported.has(id))) throw new Error('This backup has missing or unused embedded files. Nothing was imported.');
  const idMap = new Map(assets.map(asset => [asset.id, newId()]));
  assets = assets.map(asset => ({ ...asset, id: idMap.get(asset.id)! }));
  document.id = newId(); document.revision = 0; document.compressed = false; document.createdAt = Date.now(); document.updatedAt = document.createdAt;
  if (document.pdfAssetId) document.pdfAssetId = idMap.get(document.pdfAssetId)!;
  for (const page of document.pages) {
    page.id = newId();
    for (const object of page.objects) { object.id = newId(); if (object.assetId) object.assetId = idMap.get(object.assetId)!; }
  }
  return commitDocumentWithAssets(document, assets);
}
