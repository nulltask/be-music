/** Plain's palette, type, and a few small drawing helpers shared by its three screens. */

export const INK = '#111114';
export const PANEL = '#1c1c21';
export const LINE = '#3a3a42';
export const TEXT = '#f2f2f2';
export const MUTED = '#8c8c96';
export const ACCENT = '#3d7bff';
export const DANGER = '#ff4d5e';

/** Lane backgrounds and note colours by lane kind. */
export const LANE_FILL = { white: '#1d1d22', black: '#16161a', scratch: '#16161a' } as const;
export const NOTE_FILL = { white: '#f2f2f2', black: '#5b8cff', scratch: '#ff4d5e' } as const;

/** Colours the PERFECT judgement (shown as GREAT) cycles through. */
export const FLASHING_GREAT = [0xffffff, 0x5b8cff, 0xffd84d] as const;

export const FONT = '"M PLUS 1p", system-ui, sans-serif';

const FONTS = new Map<string, string>();

/** A CSS font for `ctx.font` (the same string for the same size and weight). */
export function font(size: number, weight = 500): string {
  const key = `${weight}/${size}`;
  let value = FONTS.get(key);
  if (!value) {
    value = `${weight} ${size}px ${FONT}`;
    FONTS.set(key, value);
  }
  return value;
}

/** The font last set on each context: the browser re-parses `ctx.font` on every assignment, so skip repeats. */
const CURRENT_FONTS = new WeakMap<CanvasRenderingContext2D, string>();

/** `0xrrggbb` → `#rrggbb`, for colours the SDK hands out as numbers. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** The narrowest a `maxWidth` text is squeezed; anything longer is clipped to the box and scrolls instead. */
export const MIN_SQUEEZE = 0.85;
/** Marquee timing: rest at the start so it reads, scroll at a steady pace, rest at the end, then jump back. */
const MARQUEE_START_HOLD_MS = 1500;
const MARQUEE_SPEED_PX_PER_S = 32;
const MARQUEE_END_HOLD_MS = 1000;

/** How far (px) a text overflowing its box by `overflow` px has scrolled `elapsedMs` after it appeared. */
export function marqueeOffset(elapsedMs: number, overflow: number): number {
  if (!(overflow > 0) || !(elapsedMs > 0)) return 0;
  const scrollMs = (overflow / MARQUEE_SPEED_PX_PER_S) * 1000;
  const t = elapsedMs % (MARQUEE_START_HOLD_MS + scrollMs + MARQUEE_END_HOLD_MS);
  if (t <= MARQUEE_START_HOLD_MS) return 0;
  return Math.min(overflow, ((t - MARQUEE_START_HOLD_MS) * MARQUEE_SPEED_PX_PER_S) / 1000);
}

/** When each scrolling string was first drawn, so it starts from its beginning; forgotten once it leaves the screen. */
const MARQUEE_SINCE = new Map<string, { startMs: number; seenMs: number }>();

function marqueeElapsed(value: string, nowMs: number): number {
  let since = MARQUEE_SINCE.get(value);
  if (!since || nowMs - since.seenMs > 400) {
    if (MARQUEE_SINCE.size > 64) {
      for (const [key, entry] of MARQUEE_SINCE) if (nowMs - entry.seenMs > 400) MARQUEE_SINCE.delete(key);
    }
    since = { startMs: nowMs, seenMs: nowMs };
    MARQUEE_SINCE.set(value, since);
  }
  since.seenMs = nowMs;
  return nowMs - since.startMs;
}

export interface TextOptions {
  size: number;
  color?: string;
  weight?: number;
  align?: CanvasTextAlign;
  /**
   * Box the text must fit: squeezed down to {@link MIN_SQUEEZE}, then clipped to the box. With `nowMs` (the frame's
   * clock) a clipped text scrolls through the box like a marquee; without it, it shows its start.
   */
  maxWidth?: number;
  nowMs?: number;
}

/** Draws `text` with its left edge (or `align` point) at `x` and its middle at `y`. */
export function text(ctx: CanvasRenderingContext2D, value: string, x: number, y: number, options: TextOptions): void {
  const wanted = font(options.size, options.weight);
  if (CURRENT_FONTS.get(ctx) !== wanted) {
    ctx.font = wanted;
    CURRENT_FONTS.set(ctx, wanted);
  }
  ctx.fillStyle = options.color ?? TEXT;
  ctx.textAlign = options.align ?? 'left';
  ctx.textBaseline = 'middle';
  const { maxWidth } = options;
  if (maxWidth === undefined) {
    ctx.fillText(value, x, y);
    return;
  }
  const overflow = ctx.measureText(value).width * MIN_SQUEEZE - maxWidth;
  if (overflow <= 0.5) {
    // Fits as it is, or squeezed a little: `fillText` squeezes to `maxWidth` by itself.
    ctx.fillText(value, x, y, maxWidth);
    return;
  }
  // Too long: draw it at the minimum squeeze, clipped to the box, scrolled by the time it has been on screen.
  const align = options.align ?? 'left';
  const left = align === 'right' || align === 'end' ? x - maxWidth : align === 'center' ? x - maxWidth / 2 : x;
  const offset = options.nowMs === undefined ? 0 : marqueeOffset(marqueeElapsed(value, options.nowMs), overflow);
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, y - options.size, maxWidth, options.size * 2);
  ctx.clip();
  ctx.translate(left - offset, y);
  ctx.scale(MIN_SQUEEZE, 1);
  ctx.textAlign = 'left';
  ctx.fillText(value, 0, 0);
  ctx.restore();
}

/** A label above a value: the small grey caption and the figure under it, the value fitted to `maxWidth`. */
export function stat(
  ctx: CanvasRenderingContext2D,
  label: string,
  value: string,
  x: number,
  y: number,
  fit?: { maxWidth: number; nowMs: number },
): void {
  text(ctx, label, x, y, { size: 9, color: MUTED, weight: 700 });
  text(ctx, value, x, y + 16, { size: 16, maxWidth: fit?.maxWidth, nowMs: fit?.nowMs });
}
