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

/** Draws `text` with its left edge (or `align` point) at `x` and its middle at `y`. */
export function text(
  ctx: CanvasRenderingContext2D,
  value: string,
  x: number,
  y: number,
  options: { size: number; color?: string; weight?: number; align?: CanvasTextAlign; maxWidth?: number },
): void {
  const wanted = font(options.size, options.weight);
  if (CURRENT_FONTS.get(ctx) !== wanted) {
    ctx.font = wanted;
    CURRENT_FONTS.set(ctx, wanted);
  }
  ctx.fillStyle = options.color ?? TEXT;
  ctx.textAlign = options.align ?? 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(value, x, y, options.maxWidth);
}

/** A label above a value: the small grey caption and the figure under it. */
export function stat(ctx: CanvasRenderingContext2D, label: string, value: string, x: number, y: number): void {
  text(ctx, label, x, y, { size: 9, color: MUTED, weight: 700 });
  text(ctx, value, x, y + 16, { size: 16 });
}
