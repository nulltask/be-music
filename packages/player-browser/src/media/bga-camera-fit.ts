/** A rectangle in the skin's coordinates. */
export interface BGACameraRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Where a camera picture of `width` x `height` goes in the BGA rect `rect`: as large as fits whole, centered, so a
 * 16:9 webcam in a square BGA frame keeps its proportions with black bands above and below. A picture with no size yet
 * fills the rect.
 */
export function fitBGACameraRect(width: number, height: number, rect: BGACameraRect): BGACameraRect {
  if (!(width > 0) || !(height > 0) || !(rect.w > 0) || !(rect.h > 0)) return rect;
  const scale = Math.min(rect.w / width, rect.h / height);
  const w = width * scale;
  const h = height * scale;
  return { x: rect.x + (rect.w - w) / 2, y: rect.y + (rect.h - h) / 2, w, h };
}
