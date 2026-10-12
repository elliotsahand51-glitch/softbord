import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFNumber, StandardFonts, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from 'pdf-lib';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { boundedRasterScale, invertMatrix, overlayMatrix, selectionRectsToPage, transformPoint } from '../src/lib/pdfCoordinates.ts';

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < .0001, `${actual} should equal ${expected}`);

export async function pdfFixture(): Promise<Uint8Array<ArrayBuffer>> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const normal = pdf.addPage([600, 800]);
  normal.drawText('Normal page selectable text', { x: 70, y: 700, font, size: 22 });
  const cropped = pdf.addPage([700, 900]);
  cropped.setCropBox(70, 110, 460, 610); cropped.setRotation(degrees(90));
  cropped.drawText('Cropped rotated page selectable text', { x: 100, y: 600, font, size: 18 });
  const rotated = pdf.addPage([640, 840]);
  rotated.setCropBox(30, 80, 500, 640); rotated.setRotation(degrees(270));
  rotated.node.set(PDFName.of('UserUnit'), PDFNumber.of(1.25));
  rotated.drawText('Third page selectable text', { x: 80, y: 610, font, size: 18 });
  return await pdf.save() as Uint8Array<ArrayBuffer>;
}

test('image placement transforms correctly through every PDF page rotation and crop offset', async () => {
  const bytes = await pdfFixture();
  const source = await getDocument({ data: bytes.slice() }).promise;
  try {
    for (let index = 1; index <= source.numPages; index++) {
      const page = await source.getPage(index);
      for (const rotation of [0, 90, 180, 270]) {
        const viewport = page.getViewport({ scale: 1, rotation });
        const m = overlayMatrix(viewport.transform, viewport.width, viewport.height);
        for (const [u, v] of [[0, 0], [1, 0], [0, 1], [1, 1], [.37, .63]]) {
          const native = transformPoint(m, u, v);
          const visual = transformPoint(viewport.transform, ...native);
          close(visual[0], viewport.width * u); close(visual[1], viewport.height * (1 - v));
        }
      }
    }
    assert.equal(bytes.byteLength > 100, true, 'source PDF buffer remains usable after worker import');
  } finally { await source.destroy(); }
});

test('copied exported PDF preserves selectable original text and contains the correct overlay matrices', async () => {
  const sourceBytes = await pdfFixture();
  const parsed = await getDocument({ data: sourceBytes.slice() }).promise;
  const original = await PDFDocument.load(sourceBytes);
  const output = await PDFDocument.create();
  // A small valid PNG is enough to assert the same image placement path used by exportPdf.
  const image = await output.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4ioAAAAASUVORK5CYII=', 'base64'));
  const expected: number[][] = [];
  try {
    for (let index = 0; index < original.getPageCount(); index++) {
      const [copied] = await output.copyPages(original, [index]);
      output.addPage(copied);
      const source = await parsed.getPage(index + 1);
      const viewport = source.getViewport({ scale: 1 });
      const matrix = overlayMatrix(viewport.transform, viewport.width, viewport.height);
      expected.push(matrix);
      const name = copied.node.newXObject('SoftboardOverlay', image.ref);
      copied.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix), drawObject(name), popGraphicsState());
    }
    const resultBytes = await output.save();
    const result = await getDocument({ data: resultBytes.slice(), useSystemFonts: true }).promise;
    try {
      assert.equal(result.numPages, 3);
      for (let index = 0; index < result.numPages; index++) {
        const page = await result.getPage(index + 1);
        const text = await page.getTextContent();
        assert.ok(text.items.some(item => 'str' in item && item.str.includes('selectable text')), `page ${index + 1} retains text`);
        const operators = await page.getOperatorList();
        assert.ok(operators.fnArray.some((fn, i) => fn === OPS.transform && (operators.argsArray[i] as number[]).every((x, p) => Math.abs(x - expected[index][p]) < .0001)));
        assert.ok(operators.fnArray.includes(OPS.paintImageXObject));
        const source = await parsed.getPage(index + 1);
        assert.deepEqual(page.view, source.view, 'CropBox is preserved');
        assert.equal(page.rotate, source.rotate, 'native page rotation is preserved');
      }
    } finally { await result.destroy(); }
  } finally { await parsed.destroy(); }
});

test('highlight rectangles compensate for scroll/zoom, clip to page and remove duplicates', () => {
  const bounds = { left: 50, top: 120, width: 1200, height: 1600 };
  const rects = selectionRectsToPage([
    { left: 90, top: 160, right: 390, bottom: 200 },
    { left: 90, top: 160, right: 390, bottom: 200 },
    { left: 20, top: 150, right: 80, bottom: 190 },
  ], bounds, 600, 800);
  assert.deepEqual(rects, [{ x: 20, y: 20, width: 150, height: 20 }, { x: 0, y: 15, width: 15, height: 20 }]);
  assert.deepEqual(selectionRectsToPage([], { ...bounds, width: 0 }, 600, 800), []);
});

test('rendered overlays land at the same visual location on normal, rotated, cropped and UserUnit pages', async () => {
  const bytes = await pdfFixture();
  const original = await PDFDocument.load(bytes);
  const parsed = await getDocument({ data: bytes.slice(), useSystemFonts: true }).promise;
  const output = await PDFDocument.create();
  try {
    for (let index = 0; index < parsed.numPages; index++) {
      const viewport = (await parsed.getPage(index + 1)).getViewport({ scale: 1 });
      const raster = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = raster.getContext('2d');
      context.fillStyle = '#ff0000'; context.fillRect(40, 70, 35, 25);
      const image = await output.embedPng(raster.toBuffer('image/png'));
      const [page] = await output.copyPages(original, [index]); output.addPage(page);
      const name = page.node.newXObject('SoftboardOverlay', image.ref);
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...overlayMatrix(viewport.transform, viewport.width, viewport.height)), drawObject(name), popGraphicsState());
    }
    const exported = await getDocument({ data: await output.save(), useSystemFonts: true }).promise;
    try {
      for (let index = 0; index < exported.numPages; index++) {
        const page = await exported.getPage(index + 1), viewport = page.getViewport({ scale: 1 });
        const raster = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvas: raster as unknown as HTMLCanvasElement, viewport }).promise;
        const sample = raster.getContext('2d').getImageData(55, 80, 1, 1).data;
        assert.ok(sample[0] > 245 && sample[1] < 10 && sample[2] < 10, `page ${index + 1} red mark appears at viewport (55,80): ${sample}`);
        const outside = raster.getContext('2d').getImageData(20, 20, 1, 1).data;
        assert.ok(outside[0] > 245 && outside[1] > 245 && outside[2] > 245, 'transparent overlay does not paint outside its mark');
      }
    } finally { await exported.destroy(); }
  } finally { await parsed.destroy(); }
});

test('raster limits protect mobile memory and invalid transforms fail explicitly', () => {
  assert.equal(boundedRasterScale(600, 800, 2.5), 2.5);
  const scale = boundedRasterScale(30_000, 40_000, 4);
  assert.ok(30_000 * 40_000 * scale ** 2 <= 12_000_001);
  assert.ok(40_000 * scale <= 8192);
  assert.throws(() => boundedRasterScale(0, 800), /dimensions/);
  assert.throws(() => invertMatrix([0, 0, 0, 0, 1, 1]), /transform/);
});
