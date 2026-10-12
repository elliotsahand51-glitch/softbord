import type { BoardPage } from '../types';
import { objectBounds } from './ink';

export interface PageBounds { x: number; y: number; width: number; height: number }

const inkKinds = new Set(['stroke', 'highlight', 'rect', 'ellipse', 'line', 'arrow']);

/** Infinite boards have a finite, content-fit frame for Fit, previews and exports.
 * PDF pages retain their original frame, even if annotations extend outside it.
 * The legacy page dimensions are only the fallback for a completely empty board.
 */
export function pageBounds(page: BoardPage): PageBounds {
  if (page.pdfPageIndex !== undefined || page.objects.length === 0) {
    return { x: 0, y: 0, width: page.width, height: page.height };
  }
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const object of page.objects) {
    const bounds = objectBounds(object);
    // Round caps and joins extend beyond geometry. Arrowheads can be wider than
    // the line's box; a conservative radial pad also covers rotated arrowheads.
    const strokePad = inkKinds.has(object.type) ? object.strokeWidth / 2 : 0;
    const arrowPad = object.type === 'arrow' ? Math.max(12, object.strokeWidth * 4) : 0;
    const pad = strokePad + arrowPad;
    left = Math.min(left, bounds.x - pad);
    top = Math.min(top, bounds.y - pad);
    right = Math.max(right, bounds.x + bounds.width + pad);
    bottom = Math.max(bottom, bounds.y + bounds.height + pad);
  }
  const margin = 64;
  return { x: left - margin, y: top - margin, width: right - left + margin * 2, height: bottom - top + margin * 2 };
}

/** PDF readers support pages up to 200 inches (14,400 points) consistently.
 * Scale the complete board, without clipping any part of its content.
 */
export function boardPdfSize(bounds: PageBounds): { width: number; height: number } {
  const scale = Math.min(1, 14_400 / Math.max(bounds.width, bounds.height));
  return { width: bounds.width * scale, height: bounds.height * scale };
}
