import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'file:///C:/Users/Tech%20Store/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { PDFDocument } from 'pdf-lib';

const base = 'http://localhost:4175/';
const directory = path.resolve('tests/artifacts/board-browser');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const errors = [], externalRequests = [], checks = [], findings = [];
const report = {
  url: base, browser: 'Isolated headless Microsoft Edge',
  fallback: 'IAB was attempted; viewport scaling was inconsistent and offline/pointer-sequence simulation unavailable. Parent authorized Playwright fallback.',
  checks, errors, externalRequests, findings, responsive: [], screenshots: [],
};
const observe = context => {
  context.on('page', page => {
    page.on('pageerror', error => errors.push({ url: page.url(), message: error.message }));
    page.on('console', message => { if (message.type() === 'error') errors.push({ url: page.url(), message: message.text(), location: message.location() }); });
  });
  context.on('request', request => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin) externalRequests.push(url);
  });
};
async function screenshot(page, name) {
  await page.screenshot({ path: path.join(directory, name), fullPage: true });
  report.screenshots.push(name);
}
async function saveNow(page) {
  await page.keyboard.press('Control+s');
  await page.locator('.editor-busy').waitFor({ state: 'detached' });
  await page.waitForFunction(() => document.querySelector('.save-status')?.textContent === 'Saved on this device');
  assert.equal(await page.locator('.editor-error').count(), 0);
}
async function closeEditor(page) {
  await page.locator('.library-back').click();
  await page.getByRole('heading', { name: 'A little space for big ideas.' }).waitFor();
}
async function title(page, name) {
  await page.getByLabel('Project title', { exact: true }).fill(name);
  await page.getByLabel('Project title', { exact: true }).press('Tab');
}
async function curve(page, count = 72) {
  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.getByLabel('Writing style', { exact: true }).selectOption('course');
  const box = await page.locator('.drawing-page').boundingBox();
  const stage = await page.locator('.editor-stage').boundingBox();
  const left = Math.max(stage.x + 50, box.x + 10), right = Math.min(stage.x + stage.width - 35, box.x + box.width - 10);
  const top = Math.max(stage.y + 100, box.y + 35), bottom = Math.min(stage.y + stage.height * .55, box.y + box.height - 30);
  const start = { x: left + (right - left) * .2, y: top + (bottom - top) * .35 };
  const length = Math.min(220, (right - left) * .6), height = Math.min(25, (bottom - top) * .2);
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  for (let index = 1; index <= count; index++) await page.mouse.move(start.x + length * index / count, start.y + Math.sin(index / count * Math.PI * 4) * height);
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll('.drawing-objects > g[data-object-id]').length > 0);
  return page.locator('.drawing-objects > g[data-object-id]').count();
}
async function backup(page, name) {
  await page.getByRole('button', { name: 'More export options', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Editable backup', exact: true }).click();
  const download = await pending; const file = path.join(directory, name);
  await download.saveAs(file); return { file, value: JSON.parse(await readFile(file, 'utf8')) };
}
async function waitOfflineReady(page) {
  await page.waitForFunction(() => [...document.querySelectorAll('.library-footer,.rail-footer')].some(element => element.textContent?.includes('Ready offline')), undefined, { timeout: 60_000 });
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
}
async function assertLayout(page, label) {
  const measurements = await page.evaluate(() => {
    const box = element => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, right: rect.right, bottom: rect.bottom }; };
    const toolbar = document.querySelector('.drawing-toolbar'); const row = document.querySelector('.tool-row');
    return { viewport: { width: innerWidth, height: innerHeight }, documentWidth: document.documentElement.scrollWidth,
      toolbar: toolbar && box(toolbar), row: row && { ...box(row), scrollWidth: row.scrollWidth, clientWidth: row.clientWidth, overflowX: getComputedStyle(row).overflowX },
      header: document.querySelector('.editor-header') && box(document.querySelector('.editor-header')) };
  });
  report.responsive.push({ label, ...measurements });
  assert.ok(measurements.documentWidth <= measurements.viewport.width + 1, `${label}: document horizontal overflow`);
  if (measurements.toolbar) {
    const toolbar = measurements.toolbar;
    assert.ok(toolbar.x >= -1 && toolbar.right <= measurements.viewport.width + 1 && toolbar.y >= 0 && toolbar.bottom <= measurements.viewport.height + 1, `${label}: toolbar clipped outside viewport`);
    if (measurements.row.scrollWidth > measurements.row.clientWidth + 1) assert.ok(['auto', 'scroll'].includes(measurements.row.overflowX), `${label}: toolbar controls overflow without scrolling`);
  }
}
async function checkToolReachable(page, name) {
  const tool = page.getByRole('button', { name, exact: true });
  await tool.scrollIntoViewIfNeeded();
  const result = await tool.evaluate(element => {
    const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    return { x, y, width: innerWidth, height: innerHeight, hit: element.contains(document.elementFromPoint(x, y)) };
  });
  assert.ok(result.x >= 0 && result.x <= result.width && result.y >= 0 && result.y <= result.height && result.hit, `${name} cannot be reached in viewport`);
}

const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, acceptDownloads: true });
observe(context); let page = await context.newPage();
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  assert.equal(await page.title(), 'Softboard');
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  await page.getByRole('heading', { name: 'A little space for big ideas.' }).waitFor();
  await waitOfflineReady(page); await assertLayout(page, 'Desktop gallery');
  await screenshot(page, '01-desktop-gallery.png');
  await page.setViewportSize({ width: 1536, height: 1024 });
  await assertLayout(page, 'Desktop 1536 gallery'); await screenshot(page, 'gallery-1536x1024.png');
  await page.setViewportSize({ width: 1440, height: 960 });
  checks.push('App identity, meaningful gallery, no framework error overlay; offline shell installed');

  await page.getByRole('button', { name: /New whiteboard/ }).click();
  await title(page, 'QA handwriting');
  assert.equal(await curve(page), 1);
  const renderedPath = await page.locator('.drawing-objects > g[data-object-id] path').getAttribute('d');
  assert.ok(renderedPath.includes(' Q '), 'course handwriting uses curved path segments');
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  assert.equal(await page.locator('.drawing-objects > g[data-object-id]').count(), 0);
  await page.getByRole('button', { name: 'Redo (Ctrl+Y)', exact: true }).click();
  assert.equal(await page.locator('.drawing-objects > g[data-object-id]').count(), 1);
  await saveNow(page); await assertLayout(page, 'Desktop editor'); await screenshot(page, '02-desktop-ink.png');
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.waitForFunction(() => window.innerWidth === 1536 && window.innerHeight === 1024);
  await assertLayout(page, 'Desktop 1536 editor'); await screenshot(page, 'desktop-1536x1024.png');
  await page.setViewportSize({ width: 1440, height: 960 });
  const beforeReload = await backup(page, 'before-reload.softboard.json');
  assert.ok(beforeReload.value.document.pages[0].objects[0].points.length >= 70, 'raw pointer samples retained');
  checks.push('Curved real mouse stroke, raw sample retention, undo/redo and saved state');

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByLabel('Project title', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Project title', { exact: true }).inputValue(), 'QA handwriting');
  await page.locator('.drawing-objects > g[data-object-id]').waitFor();
  assert.equal(await page.locator('.drawing-objects > g[data-object-id]').count(), 1);
  const afterReload = await backup(page, 'after-reload.softboard.json');
  assert.deepEqual(afterReload.value.document.pages, beforeReload.value.document.pages);
  checks.push('Reload stays in the open board and restores exact ink geometry from local IndexedDB');

  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.page-navigation > span')?.textContent === '2 / 2');
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.page-navigation > span')?.textContent === '1 / 1');
  assert.equal(await page.locator('.drawing-objects > g[data-object-id]').count(), 1);
  checks.push('Undoing a newly added active page returns navigation to the surviving page and restores its ink');

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Select', exact: true }).click();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await page.waitForFunction(() => document.querySelectorAll('.drawing-objects > g[data-object-id]').length === 2);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  await page.evaluate(() => navigator.clipboard.writeText('External clipboard text after copying a Softboard object'));
  await page.keyboard.press('Control+v');
  await page.waitForFunction(() => document.querySelector('.drawing-objects')?.textContent?.includes('External clipboard text after copying'));
  assert.equal(await page.locator('.drawing-objects > g[data-object-id]').count(), 2);
  await page.getByRole('button', { name: 'Undo (Ctrl+Z)', exact: true }).click();
  assert.equal(await page.locator('.drawing-objects > g[data-object-id]').count(), 1);
  checks.push('Native clipboard copies and pastes objects, then correctly pastes external text after the clipboard changes');
  await closeEditor(page);
  await page.locator('input[type=file][accept="application/json,.json,.softboard"]').setInputFiles(beforeReload.file);
  await page.locator('.editor-stage').waitFor();
  const restored = await backup(page, 'restored.softboard.json');
  assert.notEqual(restored.value.document.id, beforeReload.value.document.id);
  assert.deepEqual(restored.value.document.pages[0].objects[0].points, beforeReload.value.document.pages[0].objects[0].points);
  await title(page, 'QA restored'); await saveNow(page); await closeEditor(page);
  checks.push('Editable JSON download/import preserves geometry under fresh identifiers');

  await page.getByRole('button', { name: 'Options for QA handwriting', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await page.getByRole('button', { name: 'Open QA handwriting (copy)', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Options for QA handwriting (copy)', exact: true }).click();
  await page.getByRole('button', { name: 'Compress', exact: true }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.document-card')].find(card => card.querySelector('h3')?.textContent === 'QA handwriting (copy)')?.textContent.includes('Compressed'));
  await page.getByRole('button', { name: 'Open QA handwriting (copy)', exact: true }).click();
  await page.locator('.drawing-objects > g[data-object-id]').waitFor();
  assert.equal(await page.locator('.drawing-objects > g[data-object-id]').count(), 1);
  await closeEditor(page);
  await page.getByRole('button', { name: 'Options for QA handwriting (copy)', exact: true }).click();
  await page.getByRole('button', { name: 'Expand', exact: true }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.document-card')].find(card => card.querySelector('h3')?.textContent === 'QA handwriting (copy)')?.textContent.includes('Compressed'));
  for (const name of ['QA handwriting (copy)', 'QA restored']) {
    await page.getByRole('button', { name: `Options for ${name}`, exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete project', exact: true }).click();
    await page.getByRole('button', { name: `Open ${name}`, exact: true }).waitFor({ state: 'detached' });
  }
  assert.equal(await page.locator('.document-card').count(), 1);
  checks.push('Library duplicate, compression, compressed reopening, expansion and confirmed deletion');

  await context.setOffline(true); await page.close(); page = await context.newPage();
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Open QA handwriting', exact: true }).waitFor();
  await page.getByRole('button', { name: /New whiteboard/ }).click();
  await title(page, 'QA offline whiteboard'); await curve(page); await saveNow(page);
  const pdfDownload = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const output = path.join(directory, 'offline-whiteboard.pdf'); await (await pdfDownload).saveAs(output);
  const pdf = await PDFDocument.load(await readFile(output)); assert.equal(pdf.getPageCount(), 1);
  await screenshot(page, '03-offline-whiteboard.png'); await closeEditor(page);
  checks.push('New cold tab navigates while network disabled; create, draw, save and PDF export all succeed offline');

  await page.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles('tests/fixtures/rotation-crop.pdf');
  await page.locator('.pdf-raster canvas').waitFor();
  await page.locator('.pdf-loading').waitFor({ state: 'detached', timeout: 30_000 });
  assert.equal(await page.locator('.pdf-error').count(), 0);
  await curve(page); await saveNow(page); await screenshot(page, '04-offline-pdf-import.png');
  const importedBackup = await backup(page, 'offline-pdf.softboard.json');
  assert.equal(importedBackup.value.document.pages.length, 3); assert.equal(importedBackup.value.assets.length, 1);
  const offlinePdfDownload = page.waitForEvent('download', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export PDF', exact: true }).click();
  const offlinePdf = path.join(directory, 'offline-annotated.pdf'); await (await offlinePdfDownload).saveAs(offlinePdf);
  assert.equal((await PDFDocument.load(await readFile(offlinePdf))).getPageCount(), 3);
  checks.push('Imported a local 3-page PDF while entirely offline, wrote on it, saved, exported editable backup and annotated PDF');
} catch (error) {
  findings.push({ phase: 'Board/library/offline flow', message: error.stack });
  await screenshot(page, 'failure-main.png').catch(() => {});
} finally { await context.close(); }

for (const specification of [
  { label: 'ipad-portrait', viewport: { width: 820, height: 1180 }, hasTouch: true },
  { label: 'ipad-landscape', viewport: { width: 1180, height: 820 }, hasTouch: true },
  { label: 'mobile', viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
]) {
  const { label: _label, ...options } = specification;
  const responsive = await browser.newContext({ ...options, acceptDownloads: true }); observe(responsive);
  const view = await responsive.newPage();
  try {
    await view.goto(base, { waitUntil: 'networkidle' });
    await assertLayout(view, `${specification.label} gallery`); await screenshot(view, `${specification.label}-gallery.png`);
    await view.getByRole('button', { name: /New whiteboard/ }).tap();
    await view.locator('.drawing-toolbar').waitFor();
    await curve(view); await saveNow(view);
    await assertLayout(view, `${specification.label} editor`); await screenshot(view, `${specification.label}-editor.png`);
    for (const name of ['Select', 'Pen', 'Highlight', 'Text', 'Eraser', 'Image', 'More']) await checkToolReachable(view, name);
    await view.getByRole('button', { name: 'More', exact: true }).tap();
    for (const name of ['Pan', 'Sticky note', 'Rectangle', 'Ellipse', 'Line', 'Arrow', 'Laser', 'Lasso']) await checkToolReachable(view, name);
    await assertLayout(view, `${specification.label} expanded toolbar`); await screenshot(view, `${specification.label}-more-tools.png`);
    await view.getByRole('button', { name: 'More', exact: true }).tap();
    await view.getByRole('button', { name: 'Workspace settings', exact: true }).tap();
    await view.getByRole('dialog').waitFor();
    await assertLayout(view, `${specification.label} settings`); await screenshot(view, `${specification.label}-settings.png`);
    await view.getByRole('button', { name: 'Close dialog', exact: true }).tap();
    await closeEditor(view);
    await view.locator('input[type=file][accept="application/pdf,.pdf"]').setInputFiles('tests/fixtures/rotation-crop.pdf');
    await view.locator('.pdf-raster canvas').waitFor();
    await view.locator('.pdf-loading').waitFor({ state: 'detached', timeout: 30_000 });
    await assertLayout(view, `${specification.label} PDF editor`);
    for (const name of ['Select', 'Pen', 'Highlight', 'Text', 'Eraser', 'Image', 'Text highlight', 'More']) await checkToolReachable(view, name);
    await screenshot(view, `${specification.label}-pdf.png`);
    checks.push(`${specification.label}: gallery/editor/settings/PDF have no horizontal overflow; main, expanded and PDF tools are reachable by touch`);
  } catch (error) {
    findings.push({ phase: specification.label, message: error.stack }); await screenshot(view, `${specification.label}-failure.png`).catch(() => {});
  } finally { await responsive.close(); }
}
report.ok = findings.length === 0 && errors.length === 0 && externalRequests.length === 0;
await writeFile(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: report.ok, checks, errors, findings, externalRequests, report: path.join(directory, 'report.json') }, null, 2));
await browser.close();
if (!report.ok) process.exitCode = 1;
