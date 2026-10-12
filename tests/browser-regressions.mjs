import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { chromium } from 'file:///C:/Users/Tech%20Store/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const directory = path.resolve('tests/artifacts/regression-browser');
await mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await context.newPage();
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const objects = () => page.locator('.drawing-objects > g[data-object-id]');
const focusCanvas = () => page.locator('.drawing-surface').focus();
async function expectCount(count) {
  await page.waitForFunction(count => document.querySelectorAll('.drawing-objects > g[data-object-id]').length === count, count);
}
try {
  await page.goto('http://localhost:4175/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /New whiteboard/ }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.locator('.drawing-surface').click({ position: { x: 300, y: 200 } });
  await page.getByLabel('Text content', { exact: true }).fill('Original board text');
  await page.getByRole('button', { name: 'Save text', exact: true }).click();
  await expectCount(1);
  await focusCanvas();
  await page.keyboard.press('Control+c');
  await page.keyboard.press('Control+v');
  await expectCount(2);
  assert.equal(await page.locator('.drawing-objects text').allTextContents().then(values => values.filter(value => value === 'Original board text').length), 2);
  checks.push('Native copy/paste duplicates in-memory editable objects through an opaque clipboard token');

  await page.keyboard.press('Control+z');
  await expectCount(1);
  await page.evaluate(() => navigator.clipboard.writeText('External clipboard text'));
  await page.keyboard.press('Control+v');
  await expectCount(2);
  assert.ok((await page.locator('.drawing-objects text').allTextContents()).includes('External clipboard text'));
  checks.push('External system text pastes after an internal object copy');

  await page.evaluate(async () => {
    const blob = await (await fetch('/icon-192.png')).blob();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await page.keyboard.press('Control+v');
  await expectCount(3);
  await page.locator('.drawing-objects image').waitFor();
  checks.push('External system image pastes after an internal object copy');

  await focusCanvas();
  await page.keyboard.press('Control+x');
  await expectCount(2);
  await page.keyboard.press('Control+v');
  await expectCount(3);
  assert.equal(await page.locator('.drawing-objects image').count(), 1);
  checks.push('Cut and paste preserves the editable image and its local asset');

  await page.locator('.drawing-surface').evaluate(element => {
    const data = new DataTransfer();
    data.setData('application/x-softboard-selection', 'unknown-token');
    data.setData('application/json', JSON.stringify({ objects: [{ type: 'image', assetId: 'untrusted' }] }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  assert.equal(await objects().count(), 3);
  checks.push('An unknown clipboard token never deserializes external object payloads');

  await page.getByLabel('Project title', { exact: true }).fill('Native title copy');
  await page.getByLabel('Project title', { exact: true }).press('Control+a');
  await page.getByLabel('Project title', { exact: true }).press('Control+c');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Native title copy');
  await page.getByLabel('Project title', { exact: true }).press('Tab');
  checks.push('Text input copy remains native even with selected objects');

  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.page-navigation span')?.textContent === '2 / 2');
  await focusCanvas(); await page.keyboard.press('Control+z');
  await page.waitForFunction(() => document.querySelector('.page-navigation span')?.textContent === '1 / 1');
  assert.equal(await page.getByRole('button', { name: 'Page 1', exact: true }).getAttribute('aria-current'), 'page');
  await expectCount(3);
  checks.push('Undo of an added page clamps navigation to the remaining first page');

  await page.getByRole('button', { name: 'Pen', exact: true }).click();
  await page.evaluate(() => navigator.clipboard.writeText('Blocked during writing'));
  const surface = await page.locator('.drawing-surface').boundingBox();
  await page.mouse.move(surface.x + 450, surface.y + 180); await page.mouse.down();
  await page.mouse.move(surface.x + 540, surface.y + 210, { steps: 12 });
  await page.keyboard.press('Control+v');
  await page.mouse.up();
  await expectCount(4);
  assert.ok(!(await page.locator('.drawing-objects text').allTextContents()).includes('Blocked during writing'));
  checks.push('Pasting during an active pen gesture is ignored and captured handwriting is retained');

  await page.locator('.library-back').click();
  await page.locator('input[type="file"][accept="application/pdf,.pdf"]').setInputFiles('tests/fixtures/rotation-crop.pdf');
  await page.locator('.pdf-loading').waitFor({ state: 'detached', timeout: 30_000 });
  await page.locator('.pdf-text-container .textLayer span').first().waitFor();
  await page.locator('input[type="file"][accept^="image/png"]').setInputFiles('public/icon-192.png');
  await page.locator('.drawing-objects image').waitFor();
  await page.getByRole('button', { name: 'Text highlight', exact: true }).click();
  const selectedText = await page.locator('.pdf-text-container .textLayer span').filter({ hasText: 'Normal page selectable text' }).first().evaluate(element => {
    const selection = getSelection(); selection.removeAllRanges();
    const range = document.createRange(); range.selectNodeContents(element); selection.addRange(range);
    return selection.toString();
  });
  await page.keyboard.press('Control+c');
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), selectedText);
  checks.push('Native PDF text copy remains available while an annotation is selected');

  // A fresh loopback origin injects one real worker-fetch failure. This avoids
  // page routing, which does not intercept a service worker's own cache fetches.
  let rejectOfflineAsset = true, injectedFailures = 0;
  const faultServer = http.createServer((request, response) => {
    if (rejectOfflineAsset && request.url === '/pdf/standard_fonts/LiberationSans-Regular.ttf') {
      injectedFailures++; response.writeHead(503).end('Injected offline installation failure'); return;
    }
    http.get(new URL(request.url, 'http://127.0.0.1:4175'), upstream => {
      response.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(response);
    }).on('error', () => response.writeHead(502).end());
  });
  await new Promise(resolve => faultServer.listen(0, '127.0.0.1', resolve));
  const failureContext = await browser.newContext();
  try {
    const failurePage = await failureContext.newPage();
    await failurePage.goto(`http://127.0.0.1:${faultServer.address().port}/`);
    await failurePage.getByText('Offline setup failed. Stay online and reload to retry.', { exact: true }).waitFor({ timeout: 30_000 });
    assert.ok(injectedFailures > 0);
    assert.equal(await failurePage.getByText('Ready offline', { exact: true }).count(), 0);
    checks.push('Failed service-worker cache installation reports an error instead of waiting indefinitely');
    rejectOfflineAsset = false;
    await failurePage.reload();
    await failurePage.getByText('Ready offline', { exact: true }).waitFor({ timeout: 30_000 });
    checks.push('Reload after restoring the missing asset completes offline installation');
  } finally {
    await failureContext.close();
    await new Promise(resolve => faultServer.close(resolve));
  }

  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(directory, 'final.png'), fullPage: true });
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({ ok: true, checks, errors }, null, 2));
  console.log(JSON.stringify({ ok: true, checks: checks.length, errors }));
} catch (error) {
  await writeFile(path.join(directory, 'report.json'), JSON.stringify({ ok: false, checks, errors, failure: error.stack }, null, 2));
  await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally { await browser.close(); }
