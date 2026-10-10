import type { Graphics } from 'pixi.js';

/** Height (px) of the built-in caution-striped mine. */
export const CAUTION_MINE_HEIGHT = 12;
/** Horizontal pitch (px) of the caution stripes. */
const STRIPE_STEP = 8;

/**
 * Clips the convex polygon `points` (`[x0, y0, x1, y1, …]`) to the vertical band `minX..maxX` (Sutherland–Hodgman
 * against its two edges). Returns the clipped outline, or an empty array when nothing of it lies in the band.
 */
export function clipPolygonToSpan(points: readonly number[], minX: number, maxX: number): number[] {
  const clipEdge = (input: readonly number[], keep: (x: number) => boolean, edgeX: number): number[] => {
    const output: number[] = [];
    const count = input.length / 2;
    for (let index = 0; index < count; index += 1) {
      const ax = input[index * 2]!;
      const ay = input[index * 2 + 1]!;
      const next = (index + 1) % count;
      const bx = input[next * 2]!;
      const by = input[next * 2 + 1]!;
      const aIn = keep(ax);
      const bIn = keep(bx);
      if (aIn) output.push(ax, ay);
      if (aIn !== bIn) {
        const t = (edgeX - ax) / (bx - ax);
        output.push(edgeX, ay + (by - ay) * t);
      }
    }
    return output;
  };
  const left = clipEdge(points, (x) => x >= minX, minX);
  if (left.length < 6) return [];
  const both = clipEdge(left, (x) => x <= maxX, maxX);
  return both.length < 6 ? [] : both;
}

/**
 * The diagonal caution stripes of a mine whose body spans `x..x + w` with its bottom edge at `y`, each clipped to the
 * body so none spills into the neighbouring lanes.
 */
export function cautionMineStripes(x: number, w: number, y: number): number[][] {
  const stripes: number[][] = [];
  const top = y - CAUTION_MINE_HEIGHT;
  for (let sx = x - CAUTION_MINE_HEIGHT; sx < x + w; sx += STRIPE_STEP) {
    const stripe = clipPolygonToSpan([sx, y - 1, sx + 4, y - 1, sx + 12, top + 1, sx + 8, top + 1], x, x + w);
    if (stripe.length > 0) stripes.push(stripe);
  }
  return stripes;
}

/**
 * The player's built-in mine: a dark red bar with yellow caution stripes, inset 2 px into its lane, bottom edge at the
 * just-timing `y`. Used for skins that don't draw mines themselves.
 */
export function drawCautionMine(graphics: Graphics, laneX: number, laneW: number, y: number): void {
  const x = laneX + 2;
  const w = Math.max(4, laneW - 4);
  graphics
    .roundRect(x, y - CAUTION_MINE_HEIGHT, w, CAUTION_MINE_HEIGHT, 3)
    .fill(0x6e1414)
    .stroke({ color: 0xffd166, width: 1, alignment: 1 });
  for (const stripe of cautionMineStripes(x, w, y)) graphics.poly(stripe).fill({ color: 0xffd166, alpha: 0.55 });
  graphics.rect(x, y - CAUTION_MINE_HEIGHT, w, 1).fill({ color: 0xff8a8a, alpha: 0.8 });
}
