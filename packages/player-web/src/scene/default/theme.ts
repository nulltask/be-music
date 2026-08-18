import { Container, Graphics } from 'pixi.js';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../gameplay-constants.ts';
import type { ChildPool } from '../pixi-utils.ts';
import { clockAngle } from './motion.ts';

/**
 * Ice-clock palette for the built-in default family. Navy void, ice cyan piping, gold lock-on —
 * geometric rather than neon-arcade, original artwork (no third-party UI assets).
 */
export const DEFAULT_THEME = {
  void: 0x03060c,
  navy: 0x071018,
  panel: 0x0b1a26,
  panelDeep: 0x051018,
  line: 0x1c3d52,
  ice: 0xd8f4ff,
  cyan: 0x3ee8ff,
  cyanDim: 0x1788a4,
  gold: 0xffe07a,
  goldDeep: 0xc9a24a,
  white: 0xf3f7fb,
  mute: 0x7a92a4,
  subtle: 0x4a6574,
  danger: 0xff4d6a,
  great: 0x5dffc8,
  good: 0x7eb4ff,
  bad: 0xff9b54,
  measure: 0x3ee8ff,
} as const;

export const DEFAULT_BG_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0x0a1824, 90],
  [0x07141e, 180],
  [0x050e16, 280],
  [0x040b12, 380],
  [0x03060c, 480],
];

export function defaultJudgeColor(judge: string): number {
  switch (judge) {
    case 'PERFECT':
      return DEFAULT_THEME.gold;
    case 'GREAT':
      return DEFAULT_THEME.great;
    case 'GOOD':
      return DEFAULT_THEME.good;
    case 'BAD':
      return DEFAULT_THEME.bad;
    case 'POOR':
      return DEFAULT_THEME.danger;
    default:
      return DEFAULT_THEME.ice;
  }
}

export function fillTriangle(
  g: Graphics,
  x: number,
  y: number,
  size: number,
  color: number,
  alpha: number,
  inverted = false,
): void {
  const h = size * 0.866;
  if (inverted) {
    g.poly([x, y + h / 2, x - size / 2, y - h / 2, x + size / 2, y - h / 2]).fill({ color, alpha });
    return;
  }
  g.poly([x, y - h / 2, x - size / 2, y + h / 2, x + size / 2, y + h / 2]).fill({ color, alpha });
}

export function strokeClockRing(
  g: Graphics,
  cx: number,
  cy: number,
  radius: number,
  sweep: number,
  color: number,
  alpha: number,
  width: number,
  rotation = -Math.PI / 2,
): void {
  const clamped = Math.max(0, Math.min(1, sweep));
  if (clamped <= 0 || radius <= 0) return;
  const steps = Math.max(8, Math.round(48 * clamped));
  const points: number[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = rotation + (Math.PI * 2 * clamped * i) / steps;
    points.push(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
  }
  g.poly(points, false).stroke({ color, width, alpha, cap: 'round', join: 'round' });
}

export function strokeCornerBrackets(
  g: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  arm: number,
  color: number,
  alpha: number,
): void {
  const pairs: Array<readonly [number, number, number, number]> = [
    [x, y, x + arm, y],
    [x, y, x, y + arm],
    [x + w, y, x + w - arm, y],
    [x + w, y, x + w, y + arm],
    [x, y + h, x + arm, y + h],
    [x, y + h, x, y + h - arm],
    [x + w, y + h, x + w - arm, y + h],
    [x + w, y + h, x + w, y + h - arm],
  ];
  for (const [x0, y0, x1, y1] of pairs) {
    g.moveTo(x0, y0).lineTo(x1, y1);
  }
  g.stroke({ color, width: 1.5, alpha, cap: 'square' });
}

/**
 * Diamond / triangular iris cover. `cover` 1 paints the full canvas; 0 paints nothing.
 * Drawn from primitives (no gradients) so pooled Graphics never allocate FillGradient textures.
 */
export function fillSceneCover(g: Graphics, cover: number, nowMs: number, w = DESIGN_WIDTH, h = DESIGN_HEIGHT): void {
  const amount = Math.max(0, Math.min(1, cover));
  if (amount <= 0.001) return;
  if (amount >= 0.97) {
    g.rect(0, 0, w, h).fill(DEFAULT_THEME.void);
    return;
  }
  const cx = w / 2;
  const cy = h / 2;
  const blind = amount * (h / 2 + 24);
  g.rect(0, 0, w, blind).fill({ color: DEFAULT_THEME.void, alpha: 0.96 });
  g.rect(0, h - blind, w, blind).fill({ color: DEFAULT_THEME.void, alpha: 0.96 });
  const spin = clockAngle(nowMs, 2400);
  const size = 40 + amount * 280;
  fillTriangle(g, cx, cy, size, DEFAULT_THEME.void, 0.94);
  fillTriangle(g, cx, cy, size * 0.72, DEFAULT_THEME.void, 0.94, true);
  const ringR = 18 + amount * 90;
  strokeClockRing(g, cx, cy, ringR, 1, DEFAULT_THEME.cyan, 0.35 + 0.4 * amount, 2, spin);
  fillTriangle(g, cx + Math.cos(spin) * ringR, cy + Math.sin(spin) * ringR, 10, DEFAULT_THEME.gold, 0.85);
}

/**
 * Paints the iris as the last child of `layer` so HUD text / list rows cannot draw on top of a wipe.
 * `eventMode = 'none'` keeps the cover visual-only — select hit targets under it still receive clicks.
 *
 * When a ChildPool supplies the Graphics, it is re-parented off the pool's graphics host (which sits behind
 * pooled Text) onto `layer` itself so the cover stays in front for the rest of the pass.
 */
export function paintSceneCover(
  layer: Container,
  cover: number,
  nowMs: number,
  options: { width?: number; height?: number; pool?: ChildPool } = {},
): void {
  if (cover <= 0.001) return;
  const g = options.pool?.acquireGraphics() ?? new Graphics();
  g.label = 'default/scene-cover';
  g.eventMode = 'none';
  fillSceneCover(g, cover, nowMs, options.width ?? DESIGN_WIDTH, options.height ?? DESIGN_HEIGHT);
  layer.addChild(g);
}

export function fillBgBands(g: Graphics, bands: ReadonlyArray<readonly [number, number]> = DEFAULT_BG_BANDS): void {
  let top = 0;
  for (const [color, bottom] of bands) {
    g.rect(0, top, DESIGN_WIDTH, bottom - top).fill(color);
    top = bottom;
  }
}
