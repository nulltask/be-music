import type { Text } from 'pixi.js';

/**
 * Optical vertical alignment for built-in skin text.
 *
 * Pixi sizes a text line from the actual ink of `"|ÉqÅM"`, so a face with a tall accent and a shallow descender (Anton,
 * Michroma) gets a top-heavy line box, and its capitals sit well below the box centre — every `anchorY` lands the
 * type low. {@link alignCapCenter} measures how far a face's cap-height centre sits from that box centre and shifts
 * the node's pivot by it, so `anchorY: 0.5` centres capitals on `y` for every font. Using the pivot (not the position)
 * keeps the correction through later repositioning, rotation, and scaling by per-letter animations.
 */

/** Pixi's line-metrics probe (see `CanvasTextMetrics.METRICS_STRING` + `BASELINE_SYMBOL`). */
const LINE_PROBE = '|ÉqÅM';
const CAP_PROBE = 'HXE0';
const PROBE_SIZE = 100;

/**
 * Distance (in the same units as the inputs) from the centre of Pixi's line box to the centre of the capitals —
 * positive when the capitals sit below the box centre. `ascent` / `descent` are the line probe's ink extents above /
 * below the baseline, `capAscent` the capitals' height.
 */
export function capCenterOffset(ascent: number, descent: number, capAscent: number): number {
  if (![ascent, descent, capAscent].every(Number.isFinite)) return 0;
  return ascent - capAscent / 2 - (ascent + descent) / 2;
}

/** CSS font shorthand for a family list, quoting multi-word names the way Pixi does. */
export function fontShorthand(weight: string, sizePx: number, fontFamily: string): string {
  const generic = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-sans-serif',
    'ui-monospace',
    'ui-serif',
  ]);
  const families = fontFamily
    .split(',')
    .map((family) => family.trim().replace(/^["']|["']$/gu, ''))
    .filter((family) => family.length > 0)
    .map((family) => (generic.has(family) ? family : `"${family}"`));
  return `${weight} ${sizePx}px ${families.join(', ')}`;
}

const OFFSETS = new Map<string, number>();
let context: CanvasRenderingContext2D | null | undefined;

/**
 * Cap-centre offset of `fontFamily` at `weight`, as a fraction of the font size. Cached once the face has loaded;
 * 0 where there is no DOM canvas (headless tests / benchmarks) or before the face is available.
 */
export function capCenterOffsetEm(fontFamily: string, weight: string): number {
  const key = `${weight}|${fontFamily}`;
  const cached = OFFSETS.get(key);
  if (cached !== undefined) return cached;
  if (typeof document === 'undefined') return 0;
  if (context === undefined) context = document.createElement('canvas').getContext('2d');
  if (!context) return 0;
  const font = fontShorthand(weight, PROBE_SIZE, fontFamily);
  const loaded = typeof document.fonts?.check !== 'function' || document.fonts.check(font);
  context.font = font;
  const line = context.measureText(LINE_PROBE);
  const caps = context.measureText(CAP_PROBE);
  const offset =
    capCenterOffset(line.actualBoundingBoxAscent, line.actualBoundingBoxDescent, caps.actualBoundingBoxAscent) /
    PROBE_SIZE;
  // Until the web font arrives the browser measures a fallback; keep asking rather than caching the wrong face.
  if (loaded) OFFSETS.set(key, offset);
  return offset;
}

/** Shifts `node`'s pivot so its capitals centre where Pixi would centre the line box (see the module note). */
export function alignCapCenter(node: Text, fontFamily: string, weight: string, fontSize: number): void {
  node.pivot.y = capCenterOffsetEm(fontFamily, weight) * fontSize;
}
