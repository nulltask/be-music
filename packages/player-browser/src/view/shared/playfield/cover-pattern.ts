/** The diagonal stripes on a lane cover: polygons clipped exactly to the cover, so no stripe pokes past its edges. */

/** A cover's rectangle in stage pixels. */
export interface CoverRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** The distance between two stripes, along the cover's edge, in stage pixels. */
export const COVER_STRIPE_SPACING = 12;
/** A stripe's width, along the cover's edge, in stage pixels. */
export const COVER_STRIPE_WIDTH = 4;

/**
 * The stripes on `rect`: rising 45° bands `width` wide every `spacing` pixels (both measured along a horizontal
 * edge), placed from (`rect.x`, `anchorY`), so a cover that moves with `anchorY` at its inner edge carries its stripes
 * with it. Each stripe is a flat `[x0, y0, x1, y1, ...]` polygon inside `rect`. Empty for an empty rect.
 */
export function resolveCoverStripes(
  rect: CoverRect,
  anchorY: number,
  spacing = COVER_STRIPE_SPACING,
  width = COVER_STRIPE_WIDTH,
): number[][] {
  if (!(rect.w > 0) || !(rect.h > 0) || !(spacing > 0) || !(width > 0)) return [];
  const width_ = Math.min(width, spacing);
  // A point's place across the stripes: `u = (x - rect.x) + (y - anchorY)`; a stripe holds u in [k·spacing, +width).
  const uOf = (x: number, y: number): number => x - rect.x + (y - anchorY);
  const uMin = uOf(rect.x, rect.y);
  const uMax = uOf(rect.x + rect.w, rect.y + rect.h);
  const corners = [rect.x, rect.y, rect.x + rect.w, rect.y, rect.x + rect.w, rect.y + rect.h, rect.x, rect.y + rect.h];
  const stripes: number[][] = [];
  for (let k = Math.floor((uMin - width_) / spacing) + 1; k * spacing < uMax; k++) {
    const from = k * spacing;
    const band = clipAbove(clipAbove(corners, uOf, from, 1), uOf, -(from + width_), -1);
    if (band.length >= 6 && polygonArea(band) > 1e-6) stripes.push(band);
  }
  return stripes;
}

/** `polygon` clipped to the half-plane `sign · u(x, y) >= bound` (one Sutherland-Hodgman pass). */
function clipAbove(
  polygon: readonly number[],
  uOf: (x: number, y: number) => number,
  bound: number,
  sign: 1 | -1,
): number[] {
  const out: number[] = [];
  const count = polygon.length / 2;
  for (let i = 0; i < count; i++) {
    const ax = polygon[i * 2]!;
    const ay = polygon[i * 2 + 1]!;
    const bx = polygon[((i + 1) % count) * 2]!;
    const by = polygon[((i + 1) % count) * 2 + 1]!;
    const da = sign * uOf(ax, ay) - bound;
    const db = sign * uOf(bx, by) - bound;
    if (da >= 0) out.push(ax, ay);
    if (da >= 0 !== db >= 0) {
      const t = da / (da - db);
      out.push(ax + (bx - ax) * t, ay + (by - ay) * t);
    }
  }
  return out;
}

function polygonArea(polygon: readonly number[]): number {
  let twice = 0;
  const count = polygon.length / 2;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    twice += polygon[i * 2]! * polygon[j * 2 + 1]! - polygon[j * 2]! * polygon[i * 2 + 1]!;
  }
  return Math.abs(twice) / 2;
}
