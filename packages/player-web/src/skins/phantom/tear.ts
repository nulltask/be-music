import type { Graphics, Text } from 'pixi.js';
import { DEFAULT_DISPLAY_FONT, DEFAULT_HEADLINE_FONT } from './fonts.ts';
import {
  PHANTOM_INK,
  PHANTOM_PAPER,
  PHANTOM_RED,
  PHANTOM_WHITE,
  ransomLayout,
  tornBandPoints,
  type RansomPaper,
} from './style.ts';
import { easeOutBack, easeOutCubic, DEFAULT_TEXT_FONT, hash01 } from '@be-music/skin-sdk';

/**
 * Phantom cut-in pieces: the torn-paper strip that rips across the screen (red splash behind a white rim around an ink
 * band, with speed lines racing through it), and ransom-note lettering. Callers own the `Graphics` and supply a text
 * factory, so the same pieces serve pooled gameplay HUD text and per-render select / result text.
 */

export interface TearStrip {
  /** Centre of the strip. */
  cx: number;
  cy: number;
  /** Direction of the rip, radians (small negative tilts it up to the right). */
  angle: number;
  length: number;
  thickness: number;
  seed: number;
}

/** How open the strip is at cut-in progress `t`: it rips open fast, holds, and snaps shut from 85 %. */
export function tearOpenness(t: number): number {
  if (t <= 0 || t >= 1) return 0;
  const open = easeOutBack(Math.min(1, t / 0.12), 2.2);
  const close = t > 0.85 ? easeOutCubic((t - 0.85) / 0.15) : 0;
  return Math.max(0, open * (1 - close));
}

/** Point `u` px along and `v` px across the strip from its centre (for placing content inside it). */
export function stripPoint(strip: TearStrip, u: number, v: number): { x: number; y: number } {
  const cos = Math.cos(strip.angle);
  const sin = Math.sin(strip.angle);
  return { x: strip.cx + u * cos - v * sin, y: strip.cy + u * sin + v * cos };
}

/**
 * Draws the strip at cut-in progress `t`: the rip slides in along its own axis as it opens, then shuts to a hairline
 * and flies on. Returns the openness (0..1) so content can scale with it.
 */
export function drawTearStrip(
  graphics: Graphics,
  strip: TearStrip,
  t: number,
  nowMs: number,
  enterFrom: 'left' | 'right' = 'left',
): number {
  const open = tearOpenness(t);
  if (open <= 0.001) return 0;
  const enter = easeOutCubic(Math.min(1, t / 0.14));
  const exit = t > 0.85 ? easeOutCubic((t - 0.85) / 0.15) : 0;
  // It slides in along its axis from `enterFrom` and flies off to the right; a strip entering from the right never
  // reaches left of its rest position (so it can sit beside the lanes without crossing them).
  const slide = (1 - enter) * (enterFrom === 'left' ? -1 : 1) * strip.length * 0.25 + exit * strip.length * 0.3;
  const from = stripPoint(strip, -strip.length / 2 + slide, 0);
  const to = stripPoint(strip, strip.length / 2 + slide, 0);
  const thickness = strip.thickness * open;
  // Red splash, white rim, ink band — each ripped with its own teeth.
  graphics.poly(tornBandPoints(from.x, from.y, to.x, to.y, thickness * 1.42, 11, strip.seed, 13)).fill(PHANTOM_RED);
  graphics.poly(tornBandPoints(from.x, from.y, to.x, to.y, thickness * 1.14, 7, strip.seed + 3, 9)).fill(PHANTOM_WHITE);
  graphics.poly(tornBandPoints(from.x, from.y, to.x, to.y, thickness, 5, strip.seed + 7, 8)).fill(PHANTOM_INK);
  // Red shards flung off the rip.
  for (let shard = 0; shard < 7; shard += 1) {
    const u = (hash01(strip.seed * 17 + shard) - 0.5) * strip.length * 0.9 + slide;
    const side = shard % 2 === 0 ? 1 : -1;
    const v = side * (thickness * 0.72 + 6 + 16 * hash01(strip.seed * 23 + shard) * open);
    const size = 5 + 9 * hash01(strip.seed * 29 + shard);
    const tip = stripPoint(strip, u, v);
    const left = stripPoint(strip, u - size, v - side * size * 0.4);
    const right = stripPoint(strip, u + size * 0.6, v - side * size * 0.5);
    graphics.poly([tip.x, tip.y, left.x, left.y, right.x, right.y]).fill(PHANTOM_RED);
  }
  // Speed lines racing along the band.
  for (let line = 0; line < 9; line += 1) {
    const lane = (hash01(strip.seed * 31 + line) - 0.5) * thickness * 0.8;
    const speed = 900 + 700 * hash01(strip.seed * 37 + line);
    const span = strip.length;
    const length = 40 + 60 * hash01(line + 5);
    // Lines stay inside the band's ends.
    const u = (((nowMs / 1000) * speed + hash01(strip.seed * 41 + line) * span) % span) - span / 2 + slide;
    const a = stripPoint(strip, u, lane);
    const b = stripPoint(strip, Math.min(strip.length / 2 + slide, u + length), lane);
    graphics.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  graphics.stroke({ color: PHANTOM_WHITE, width: 1.5, alpha: 0.35 * open });
  return open;
}

/** A text node factory: creates one glyph (the caller's pool or a fresh node) and returns it for placement. */
export type GlyphFactory = (
  char: string,
  options: { size: number; weight: '400' | '800'; fill: number; fontFamily: string },
) => Text;

const RANSOM_FONTS: ReadonlyArray<{ family: string; weight: '400' | '800'; tighten: number }> = [
  { family: DEFAULT_DISPLAY_FONT, weight: '400', tighten: 1.05 },
  { family: DEFAULT_HEADLINE_FONT, weight: '400', tighten: 0.9 },
  { family: 'Azeret Mono, ui-monospace, monospace', weight: '800', tighten: 0.92 },
  { family: DEFAULT_TEXT_FONT, weight: '800', tighten: 0.95 },
];

const CARD_FILL: Record<RansomPaper, number> = { ink: PHANTOM_INK, paper: PHANTOM_PAPER, red: PHANTOM_RED };
const LETTER_FILL: Record<RansomPaper, number> = { ink: PHANTOM_WHITE, paper: PHANTOM_INK, red: PHANTOM_WHITE };

/**
 * Ransom-note text centred on `(x, y)` along a baseline tilted by `angle`: each letter on its own tilted card (see
 * {@link ransomLayout}). `appear(index, count)` returns 0..1 per letter so callers can stagger the cards in — each
 * pops from oversized as it lands. Cards go into `graphics`; letters come from `glyph`. `accent` recolours the letters
 * on the ink and red cards (paper cards keep ink letters), so a word can carry a status colour.
 */
export function addRansomText(
  graphics: Graphics,
  glyph: GlyphFactory,
  text: string,
  x: number,
  y: number,
  options: {
    size: number;
    seed: number;
    angle?: number;
    appear?: (index: number, count: number) => number;
    accent?: number;
    /** How oversized a card starts as it pops in (0.9 = 1.9x). Small values keep a quick-fire word in place. */
    pop?: number;
  },
): void {
  const layout = ransomLayout(text, options.seed);
  const angle = options.angle ?? 0;
  const nodes = layout.map((entry) => {
    if (entry.space) return undefined;
    const font = RANSOM_FONTS[entry.font]!;
    return glyph(entry.char, {
      size: Math.round(options.size * entry.scale * font.tighten),
      weight: font.weight,
      fill: options.accent !== undefined && entry.paper !== 'paper' ? options.accent : LETTER_FILL[entry.paper],
      fontFamily: font.family,
    });
  });
  const pad = options.size * 0.12;
  const gap = options.size * 0.05;
  const widths = nodes.map((node) => (node ? node.width + pad * 2 : options.size * 0.4));
  const total = widths.reduce((sum, width) => sum + width + gap, -gap);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let cursor = -total / 2;
  layout.forEach((entry, index) => {
    const width = widths[index]!;
    const node = nodes[index];
    const along = cursor + width / 2;
    cursor += width + gap;
    if (!node) return;
    const appear = Math.max(0, Math.min(1, options.appear?.(index, layout.length) ?? 1));
    if (appear <= 0) {
      node.visible = false;
      return;
    }
    const pop = 1 + (options.pop ?? 0.9) * (1 - easeOutBack(appear, 2.4));
    const lift = entry.dy * options.size;
    const cx = x + along * cos - lift * sin;
    const cy = y + along * sin + lift * cos;
    const rotation = angle + entry.rotation;
    const h = options.size * entry.scale * 1.18 * pop;
    const w = width * pop;
    const c = Math.cos(rotation);
    const s = Math.sin(rotation);
    const corner = (dx: number, dy: number) => [cx + dx * c - dy * s, cy + dx * s + dy * c];
    graphics
      .poly([...corner(-w / 2, -h / 2), ...corner(w / 2, -h / 2), ...corner(w / 2, h / 2), ...corner(-w / 2, h / 2)])
      .fill({ color: CARD_FILL[entry.paper], alpha: Math.min(1, appear * 3) });
    node.anchor.set(0.5, 0.5);
    node.position.set(cx, cy);
    node.rotation = rotation;
    node.scale.set(node.scale.x * pop, node.scale.y * pop);
    node.alpha = Math.min(1, appear * 3);
  });
}
