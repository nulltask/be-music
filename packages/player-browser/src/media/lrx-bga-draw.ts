/**
 * Pure pieces of the LRX BGA compositor (`lrx-bga-compositor.ts`): where a note rotates about, and how it blends.
 */

/**
 * The point a note rotates about, from its `ctr` (plugout's numeric-keypad layout: 7 top left, 8 top, 9 top right, 4
 * left, 5 or 0 the middle, 6 right, 1 bottom left, 2 bottom, 3 bottom right) on its destination rectangle.
 */
export function resolveLRXBGAPivot(
  center: number,
  x: number,
  y: number,
  w: number,
  h: number,
): readonly [number, number] {
  const column =
    center === 1 || center === 4 || center === 7 ? 0 : center === 3 || center === 6 || center === 9 ? 1 : 0.5;
  const row = center === 7 || center === 8 || center === 9 ? 0 : center === 1 || center === 2 || center === 3 ? 1 : 0.5;
  return [x + w * column, y + h * row];
}

/**
 * The canvas compositing for a note's `bld`: 0 alpha, 1 add, 3 multiply. A canvas has no subtract, so 2 draws as the
 * difference, which matches it wherever the picture is darker than what lies below.
 */
export function resolveLRXBGAComposite(blend: number): GlobalCompositeOperation {
  if (blend === 1) return 'lighter';
  if (blend === 2) return 'difference';
  if (blend === 3) return 'multiply';
  return 'source-over';
}
