import type { ANSIFrame } from './bga-frame.ts';

/** Legacy frames without a coverage array retain their binary-mask meaning. */
export function getANSIFrameAlpha(frame: ANSIFrame, pixel: number): number {
  return frame.opaqueMask[pixel] ? (frame.alpha?.[pixel] ?? 255) : 0;
}

/** Allocate coverage only when fractional alpha occurs; existing opaque/masked frames stay compact. */
export function setANSIFrameAlpha(frame: ANSIFrame, pixel: number, alpha: number): void {
  const value = Number.isFinite(alpha) ? Math.max(0, Math.min(255, Math.round(alpha))) : 0;
  if (!frame.alpha && value > 0 && value < 255)
    frame.alpha = Uint8Array.from(frame.opaqueMask, (mask) => (mask ? 255 : 0));
  frame.opaqueMask[pixel] = value > 0 ? 1 : 0;
  if (frame.alpha) frame.alpha[pixel] = value;
}
