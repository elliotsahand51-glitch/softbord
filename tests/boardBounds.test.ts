import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardObject, BoardPage } from '../src/types';
import { boardPdfSize, pageBounds } from '../src/lib/boardBounds';
import { boundedRasterScale } from '../src/lib/pdfCoordinates';

const object = (changes: Partial<BoardObject> = {}): BoardObject => ({
  id: 'mark', type: 'rect', x: 0, y: 0, width: 100, height: 50,
  color: '#000000', strokeWidth: 8, opacity: 1, ...changes,
});
const page = (objects: BoardObject[] = [], changes: Partial<BoardPage> = {}): BoardPage => ({
  id: 'board', width: 2400, height: 1800, background: '#ffffff', pattern: 'dots', objects, ...changes,
});
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} should equal ${expected}`);

test('empty whiteboards retain a useful default export size', () => {
  assert.deepEqual(pageBounds(page()), { x: 0, y: 0, width: 2400, height: 1800 });
});

test('negative content determines the export origin without including an empty world origin', () => {
  const bounds = pageBounds(page([object({ x: -2000, y: -1500 })]));
  assert.deepEqual(bounds, { x: -2068, y: -1568, width: 236, height: 186 });
  // The top-left ink edge lands at the margin after translating the viewBox.
  close(-2000 - 4 - bounds.x, 64);
  close(-1500 - 4 - bounds.y, 64);
  assert.ok(bounds.x + bounds.width < 0);
});

test('distant positive content and rotated negative content are both inside one frame', () => {
  const bounds = pageBounds(page([
    object({ x: -300, y: -200, rotation: 90 }),
    object({ id: 'distant', type: 'image', x: 20_000, y: 30_000, width: 100, height: 200 }),
  ]));
  close(bounds.x, -343); close(bounds.y, -293);
  close(bounds.x + bounds.width, 20_164); close(bounds.y + bounds.height, 30_264);
  // A quarter-turn moves the upper-left corner to (-225,-225); round strokes
  // extend four units farther and must remain included in both axes.
  assert.ok(-225 - 4 >= bounds.x + 64);
  close(-225 - 4 - bounds.y, 64);
});

test('arrowheads and thick rotated strokes cannot be clipped by content fitting', () => {
  const arrow = object({ type: 'arrow', x: -50, y: -80, width: 1, height: 1, strokeWidth: 100, rotation: 45 });
  const bounds = pageBounds(page([arrow]));
  // A 400-unit head and a 50-unit round cap are allowed outside the line box.
  assert.ok(bounds.x <= -50 - 450 - 64);
  assert.ok(bounds.y <= -80 - 450 - 64);
  assert.ok(bounds.width >= 900 + 128);
});

test('PDF pages keep the exact original viewport even when annotations are far outside it', () => {
  assert.deepEqual(pageBounds(page([object({ x: -90_000, y: 80_000 })], {
    pdfPageIndex: 0, width: 612, height: 792,
  })), { x: 0, y: 0, width: 612, height: 792 });
});

test('very large boards scale as a whole for PDF and keep raster allocation bounded', () => {
  const bounds = pageBounds(page([
    object({ x: -50_000, y: -40_000 }), object({ id: 'far', x: 60_000, y: 90_000 }),
  ]));
  const size = boardPdfSize(bounds);
  close(Math.max(size.width, size.height), 14_400);
  close(size.width / size.height, bounds.width / bounds.height);
  const scale = boundedRasterScale(bounds.width, bounds.height, 2.5);
  assert.ok(bounds.width * bounds.height * scale * scale <= 12_000_001);
  assert.ok(Math.max(bounds.width, bounds.height) * scale <= 8192);
  // Every world-space point remains in the normalized exported rectangle.
  for (const [x, y] of [[-50_000, -40_000], [60_100, 90_050]]) {
    const exportedX = (x - bounds.x) / bounds.width * size.width;
    const exportedY = (y - bounds.y) / bounds.height * size.height;
    assert.ok(exportedX > 0 && exportedX < size.width);
    assert.ok(exportedY > 0 && exportedY < size.height);
  }
});
