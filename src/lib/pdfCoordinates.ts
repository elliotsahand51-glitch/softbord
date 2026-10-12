/** Affine transform [a,b,c,d,e,f], using PDF/Canvas conventions. */
export type Matrix = [number, number, number, number, number, number];
export interface HighlightRect { x: number; y: number; width: number; height: number }

export function invertMatrix(m: readonly number[]): Matrix {
  const [a, b, c, d, e, f] = m;
  const determinant = a * d - b * c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new Error('Invalid PDF page transform.');
  return [d / determinant, -b / determinant, -c / determinant, a / determinant,
    (c * f - d * e) / determinant, (b * e - a * f) / determinant];
}

export function transformPoint(m: readonly number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Place a bottom-left-origin unit PDF image over a top-left-origin PDF.js viewport.
 * Using the inverse viewport handles every rotation, CropBox offset and UserUnit.
 */
export function overlayMatrix(viewportTransform: readonly number[], width: number, height: number): Matrix {
  const inverse = invertMatrix(viewportTransform);
  return [inverse[0] * width, inverse[1] * width, -inverse[2] * height, -inverse[3] * height,
    inverse[2] * height + inverse[4], inverse[3] * height + inverse[5]];
}

/** Convert browser selection boxes through the actual rendered bounds, including zoom. */
export function selectionRectsToPage(
  boxes: readonly { left: number; top: number; right: number; bottom: number }[],
  bounds: { left: number; top: number; width: number; height: number },
  pageWidth: number, pageHeight: number,
): HighlightRect[] {
  if (!(bounds.width > 0 && bounds.height > 0)) return [];
  const sx = pageWidth / bounds.width, sy = pageHeight / bounds.height;
  const result: HighlightRect[] = [];
  for (const box of boxes) {
    const x = Math.max(0, (box.left - bounds.left) * sx);
    const y = Math.max(0, (box.top - bounds.top) * sy);
    const right = Math.min(pageWidth, (box.right - bounds.left) * sx);
    const bottom = Math.min(pageHeight, (box.bottom - bounds.top) * sy);
    if (right - x < .25 || bottom - y < .25) continue;
    const rect = { x, y, width: right - x, height: bottom - y };
    if (!result.some(r => Math.abs(r.x - x) < .3 && Math.abs(r.y - y) < .3 && Math.abs(r.width - rect.width) < .3 && Math.abs(r.height - rect.height) < .3)) result.push(rect);
  }
  return result;
}

/** Keep raster allocations bounded on iPad and exceptionally large PDF pages. */
export function boundedRasterScale(width: number, height: number, desired = 2, maxPixels = 12_000_000): number {
  if (!(width > 0 && height > 0) || !Number.isFinite(width + height)) throw new Error('Invalid page dimensions.');
  return Math.min(Math.max(.1, desired), Math.sqrt(maxPixels / (width * height)), 8192 / Math.max(width, height));
}
