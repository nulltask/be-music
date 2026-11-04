import type { BeMusicRect } from '@be-music/player-skin-sdk';

/** Keeps the monitor height while fitting its width inside the information column. */
export function fitVideoBGARect(rect: BeMusicRect, width: number, height: number, maxWidth: number): BeMusicRect {
  if (!(width > 0) || !(height > 0) || !(maxWidth > 0)) return rect;
  const w = Math.min(maxWidth, (rect.h * width) / height);
  if (!Number.isFinite(w) || w === rect.w) return rect;
  return { ...rect, x: rect.x + (rect.w - w) / 2, w };
}
