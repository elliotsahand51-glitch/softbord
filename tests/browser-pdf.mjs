import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'file:///C:/Users/Tech%20Store/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const directory = path.resolve('tests/artifacts/pdf-browser');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1536, height: 1024 }, acceptDownloads: true });
const page = await context.newPage();
const pen = await context.newCDPSession(page);
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} (${message.location().url})`); });
const summary = { tests: [], errors };
async function waitPdf() {
  await page.locator('.pdf-raster canvas').waitFor();
  await page.locator('.pdf-loading').waitFor({ state: 'detached', timeout: 30_000 });
  assert.equal(await page.locator('.pdf-error').count(), 0);
}
async function coordinates(x, y, width) {
  const box = await page.locator('.drawing-page').boundingBox();
  assert.ok(box, 'drawing page bounds are available');
  const scale = box.width / width;
  return { x: box.x + x * scale, y: box.y + y * scale, scale };
}
async function strokeAt(x, y, width) {
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.getByRole('button', { name: 'Ink color #ec736b', exact: true }).click();
  await page.getByLabel('Pen thickness', { exact: true }).fill('7');
  const p = await coordinates(x, y, width);
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, pointerType: 'pen' });
  await pen.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', buttons: 1, clickCount: 1, pointerType: 'pen', force: .65 });
  let screenX = p.x, screenY = p.y;
  for (let i = 1; i <= 40; i++) {
    screenX = p.x + i * 2 * p.scale; screenY = p.y + Math.sin(i / 40 * Math.PI * 2) * 18 * p.scale;
    await pen.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: screenX, y: screenY, buttons: 1, pointerType: 'pen', force: .65 });
  }
  await pen.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: screenX, y: screenY, button: 'left', buttons: 0, clickCount: 1, pointerType: 'pen', force: 0 });
}
async function selectPdfText(label) {
  await page.getByRole('button', { name: 'Text highlight', exact: true }).click();
  const count = await page.locator('.drawing-objects > g[data-object-id]').count();
  const originalText = page.locator('.pdf-text-container .textLayer span').filter({ hasText: label }).first();
  const box = await originalText.boundingBox(); assert.ok(box);
  if (box.width > box.height) {
    await page.mouse.move(box.x + 1, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 20 });
  } else {
    await page.mouse.move(box.x + box.width / 2, box.y + 1); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height - 1, { steps: 20 });
  }
  await page.mouse.up();
  await page.waitForFunction(count => document.querySelectorAll('.drawing-objects > g[data-object-id]').length > count, count);
}
async function download(label, filename) {
  const pending = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: label, exact: true }).click();
  const file = await pending;
  await file.saveAs(path.join(directory, filename));
  return path.join(directory, filename);
}
try {
  await page.goto('http://localhost:4175/', { waitUntil: 'networkidle' });
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles('tests/fixtures/rotation-crop.pdf');
  await waitPdf();
  assert.equal(await page.getByRole('button', { name: /^Page \d+$/ }).count(), 3);
  await page.screenshot({ path: path.join(directory, '01-imported.png'), fullPage: true });
  summary.tests.push('Imported all 3 real PDF pages and rendered selectable text');

  await strokeAt(90, 190, 600);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const textPoint = await coordinates(70, 290, 600);
  await page.mouse.click(textPoint.x, textPoint.y);
  await page.getByLabel('Text content', { exact: true }).fill('Browser QA text\nمرحبا بالكتابة');
  await page.getByLabel('Text size', { exact: true }).fill('26');
  await page.getByRole('button', { name: 'Save text', exact: true }).click();
  assert.equal(await page.locator('.drawing-objects > g[data-object-id]').count(), 2);
  summary.tests.push('Drew a curved pointer stroke and inserted Latin/Arabic text through the actual editor');

  await selectPdfText('Normal page selectable text');
  summary.tests.push('Native browser text selection created a PDF text highlight');

  await page.locator('input[type="file"][accept^="image/png"]').setInputFiles('public/icon-192.png');
  await page.locator('.drawing-objects image').waitFor();
  const imageBefore = await page.locator('.drawing-objects image').boundingBox(); assert.ok(imageBefore);
  await page.mouse.move(imageBefore.x + imageBefore.width / 2, imageBefore.y + imageBefore.height / 2);
  await page.mouse.down(); await page.mouse.move(imageBefore.x + imageBefore.width / 2 + 50, imageBefore.y + imageBefore.height / 2 + 50, { steps: 12 }); await page.mouse.up();
  const resize = await page.locator('[data-resize-handle="true"]').boundingBox(); assert.ok(resize);
  await page.mouse.move(resize.x + resize.width / 2, resize.y + resize.height / 2); await page.mouse.down();
  await page.mouse.move(resize.x + resize.width / 2 + 28, resize.y + resize.height / 2 + 18, { steps: 10 }); await page.mouse.up();
  await page.getByLabel('Object rotation', { exact: true }).fill('15');
  await page.getByLabel('Object rotation', { exact: true }).press('Tab');
  summary.tests.push('Imported a local image, moved it, resized it, and rotated it');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Sticky note', exact: true }).click();
  const notePoint = await coordinates(20, 550, 600); await page.mouse.click(notePoint.x, notePoint.y);
  await page.getByLabel('Text content', { exact: true }).fill('Remember this step');
  await page.getByRole('button', { name: 'Save text', exact: true }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  summary.tests.push('Added a movable sticky note on the PDF');
  await page.screenshot({ path: path.join(directory, '02-annotated-page1.png'), fullPage: true });

  for (const [number, width] of [[2, 610], [3, 800]]) {
    await page.getByRole('button', { name: `Page ${number}`, exact: true }).click(); await waitPdf();
    await strokeAt(95, 160, width);
    await selectPdfText(number === 2 ? 'Cropped rotated page selectable text' : 'Third page selectable text');
    await page.screenshot({ path: path.join(directory, `03-annotated-page${number}.png`), fullPage: true });
  }
  summary.tests.push('Drew and natively highlighted text on rotated/cropped PDF pages including a non-default UserUnit');
  const pdfPath = await download('Export PDF', 'annotated.pdf');
  await page.getByRole('button', { name: 'More export options', exact: true }).click();
  const backupPath = await download('Editable backup', 'editable.softboard.json');
  const backup = JSON.parse(await readFile(backupPath, 'utf8'));
  assert.equal(backup.document.pages.length, 3);
  assert.equal(backup.assets.length, 2, 'backup includes original PDF and image');
  assert.ok(backup.document.pages[0].objects.some(object => object.type === 'text' && object.text.includes('مرحبا')));
  assert.ok(backup.document.pages[0].objects.some(object => object.type === 'image' && object.rotation === 15));
  const pdf = await getDocument({ data: new Uint8Array(await readFile(pdfPath)), useSystemFonts: false, standardFontDataUrl: `${path.resolve('public/pdf/standard_fonts')}/` }).promise;
  try {
    assert.equal(pdf.numPages, 3);
    for (let index = 0; index < pdf.numPages; index++) {
      const source = await pdf.getPage(index + 1), viewport = source.getViewport({ scale: 1 });
      const text = await source.getTextContent();
      assert.ok(text.items.some(item => 'str' in item && item.str.includes('selectable text')), 'original PDF text stays selectable');
      const raster = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      await source.render({ canvas: raster, viewport }).promise;
      await writeFile(path.join(directory, `exported-page${index + 1}.png`), raster.toBuffer('image/png'));
      const object = backup.document.pages[index].objects.find(item => item.type === 'stroke'); assert.ok(object);
      const location = { x: Math.round(object.x + object.points[0][0] + 3), y: Math.round(object.y + object.points[0][1] + 3) };
      const sample = raster.getContext('2d').getImageData(Math.max(0, location.x - 7), Math.max(0, location.y - 7), 14, 14).data;
      let coral = 0;
      for (let p = 0; p < sample.length; p += 4) if (sample[p] > 210 && sample[p + 1] > 80 && sample[p + 1] < 155 && sample[p + 2] > 65 && sample[p + 2] < 150) coral++;
      assert.ok(coral >= 5, `page ${index + 1} exported stroke is placed at its stored viewport position (${coral} coral pixels)`);
    }
  } finally { await pdf.destroy(); }
  summary.tests.push('Exported PDF preserves all source text and sampled annotations at correct viewport positions on every page');
  await page.getByRole('button', { name: 'Page 1', exact: true }).click(); await waitPdf();
  await page.getByRole('button', { name: 'More export options', exact: true }).click();
  const pngPath = await download('Export PNG · this page', 'annotated-page.png');
  const png = await loadImage(pngPath);
  assert.equal(png.width, 1500); assert.equal(png.height, 2000);
  const pngCanvas = createCanvas(png.width, png.height); pngCanvas.getContext('2d').drawImage(png, 0, 0);
  const mark = pngCanvas.getContext('2d').getImageData(90 * 2.5, 190 * 2.5, 1, 1).data;
  assert.ok(mark[0] > 210 && mark[1] < 155, 'PNG includes the curve at page coordinates');
  summary.tests.push('PNG export includes the original PDF and annotations at bounded high resolution');
  await page.getByText('Ready offline', { exact: true }).first().waitFor();
  await page.getByRole('button', { name: 'Library', exact: true }).click();
  await page.getByRole('button', { name: 'Open rotation-crop', exact: true }).waitFor();
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open rotation-crop', exact: true }).click();
  await waitPdf();
  assert.equal(await page.locator('.drawing-objects > g[data-object-id]').count(), backup.document.pages[0].objects.length, 'all annotations restored after an offline reload');
  await page.getByRole('button', { name: 'Page 2', exact: true }).click(); await waitPdf();
  const offlinePdfPath = await download('Export PDF', 'offline-annotated.pdf');
  assert.ok((await readFile(offlinePdfPath)).length > 1000);
  summary.tests.push('Reloaded entirely offline, reopened the locally saved PDF with every edit, navigated a rotated page, and exported again');
  assert.deepEqual(errors, [], 'no runtime or console errors');
  summary.ok = true;
} catch (error) {
  summary.ok = false; summary.failure = error.stack;
  await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }).catch(() => {});
  console.error(error); process.exitCode = 1;
} finally {
  await writeFile(path.join(directory, 'report.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await context.close(); await browser.close();
}
