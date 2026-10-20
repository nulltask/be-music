import type { BeMusicLaneKind } from '@be-music/player-skin-sdk';

/**
 * The outline (`[x0, y0, x1, y1, x2, y2]`) of the arrow a skin draws on a 24 / 48 KEY wheel lane: a triangle centred
 * on `(cx, cy)`, `size` px from its centre to the tip, pointing up for a `'wheel-up'` lane and down for a
 * `'wheel-down'` one. `undefined` for every other lane kind, so callers can pass any lane through.
 */
export function wheelArrowPoints(kind: BeMusicLaneKind, cx: number, cy: number, size: number): number[] | undefined {
  if (kind !== 'wheel-up' && kind !== 'wheel-down') return undefined;
  const tip = kind === 'wheel-up' ? -size : size;
  return [cx, cy + tip, cx - size, cy - tip, cx + size, cy - tip];
}
