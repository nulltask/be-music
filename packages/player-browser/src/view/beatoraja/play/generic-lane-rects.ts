import type { BeatorajaNoteRect } from '@be-music/skin-beatoraja';

/** A generic keyboard borrows the skin's note-area bounds, never its scratch or fixed key-column assignments. */
export function createGenericLaneRects(rects: readonly BeatorajaNoteRect[], count: number): BeatorajaNoteRect[] {
  if (rects.length === 0) return [];
  const left = Math.min(...rects.map((rect) => rect.x));
  const right = Math.max(...rects.map((rect) => rect.x + rect.w));
  const top = Math.min(...rects.map((rect) => rect.y));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.h));
  const width = (right - left) / count;
  return Array.from({ length: count }, (_, index) => ({ x: left + index * width, y: top, w: width, h: bottom - top }));
}
