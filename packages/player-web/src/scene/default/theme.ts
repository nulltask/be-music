import { Container, Graphics } from 'pixi.js';
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '../gameplay-constants.ts';
import type { ChildPool } from '../pixi-utils.ts';
import { diamondPoints, type DiamondPose } from './motion.ts';

/**
 * Built-in default-family palette. Layout and slam language follow a cut-in comic (skewed plates, diagonal
 * slashes, rotated stamps). Colouring is navy / ice / cyan / gold — original artwork, no third-party UI assets.
 */
export const DEFAULT_THEME = {
  ink: 0x040812,
  inkDeep: 0x02050c,
  panel: 0x0c1830,
  panelLift: 0x143056,
  paper: 0xf4fbff,
  paperDim: 0xa8d4f0,
  mute: 0x6a88a8,
  line: 0x1c3d62,
  /** Cut-in accent — cyan fills the role a crimson slash would play. */
  accent: 0x2fd4f0,
  accentDeep: 0x0a3a78,
  gold: 0xffd056,
  ice: 0xe8f4fb,
  cyan: 0x2fd4f0,
  cyanGhost: 0x7ee8ff,
  white: 0xf4fbff,
  danger: 0xff4d6d,
  great: 0x7ee8ff,
  good: 0x8eb4ff,
  bad: 0xff9b54,
  measure: 0x2fd4f0,
  lane: 0x040a14,
  rail: 0x0a1628,
  railEdge: 0x2a5a88,
  judgePerfect: 0xffd056,
  judgeGreat: 0x7ee8ff,
  judgeGood: 0x8eb4ff,
  judgeBad: 0xff9b54,
  judgePoor: 0xff4d6d,
} as const;

export const DEFAULT_BG_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0x0a1830, 70],
  [0x071428, 150],
  [0x050e1c, 260],
  [0x040a16, 360],
  [0x02050c, 480],
];

/** Playfield combo fill — never cyan, which vanishes on even-key notes. */
export function playfieldComboFill(combo: number): number {
  return combo >= 200 ? DEFAULT_THEME.gold : DEFAULT_THEME.paper;
}

export function defaultJudgeColor(judge: string): number {
  switch (judge) {
    case 'PERFECT':
      return DEFAULT_THEME.judgePerfect;
    case 'GREAT':
      return DEFAULT_THEME.judgeGreat;
    case 'GOOD':
      return DEFAULT_THEME.judgeGood;
    case 'BAD':
      return DEFAULT_THEME.judgeBad;
    case 'POOR':
      return DEFAULT_THEME.judgePoor;
    default:
      return DEFAULT_THEME.paper;
  }
}

/** Axis-aligned parallelogram: top edge shifted by `skew` px. */
export function parallelogramPoints(x: number, y: number, w: number, h: number, skew: number): number[] {
  return [x + skew, y, x + w + skew, y, x + w, y + h, x, y + h];
}

export function fillParallelogram(
  graphic: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  skew: number,
  color: number,
  alpha = 1,
): void {
  graphic.poly(parallelogramPoints(x, y, w, h, skew)).fill({ color, alpha });
}

export function strokeParallelogram(
  graphic: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  skew: number,
  color: number,
  width = 1,
  alpha = 1,
): void {
  graphic.poly(parallelogramPoints(x, y, w, h, skew)).stroke({ color, width, alpha, alignment: 0.5 });
}

/** A thick diagonal slash. `lean` > 0 leans down-right (the usual cut-in). */
export function fillSlash(
  graphic: Graphics,
  x: number,
  y: number,
  length: number,
  thickness: number,
  lean: number,
  color: number,
  alpha = 1,
): void {
  graphic
    .poly([
      x,
      y,
      x + length,
      y + lean,
      x + length - thickness * 0.35,
      y + lean + thickness,
      x - thickness * 0.35,
      y + thickness,
    ])
    .fill({ color, alpha });
}

export function fillDiamond(
  graphic: Graphics,
  pose: DiamondPose,
  color: number,
  alpha = 1,
): void {
  graphic.poly(diamondPoints(pose)).fill({ color, alpha });
}

export function strokeDiamond(
  graphic: Graphics,
  pose: DiamondPose,
  color: number,
  width = 1.5,
  alpha = 1,
): void {
  graphic.poly(diamondPoints(pose)).stroke({ color, width, alpha, alignment: 0.5, join: 'round' });
}

/** Nested wobbling diamonds — the usual cut-in lock-on. */
export function fillDiamondCluster(
  graphic: Graphics,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  nowMs: number,
  color: number,
  alpha: number,
  wobble = 4,
): void {
  fillDiamond(graphic, { cx, cy, rx, ry, nowMs, wobble }, color, alpha);
  strokeDiamond(graphic, { cx, cy, rx: rx * 0.62, ry: ry * 0.62, nowMs, phase: 0.35, wobble: wobble * 0.7 }, color, 1.5, alpha * 0.85);
  fillDiamond(graphic, { cx, cy, rx: rx * 0.28, ry: ry * 0.28, nowMs, phase: 0.7, wobble: wobble * 0.45 }, DEFAULT_THEME.paper, alpha * 0.55);
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

/**
 * Diagonal cut-in wipe. `cover` 1 paints the full canvas; 0 paints nothing.
 * Drawn from primitives (no gradients) so pooled Graphics never allocate FillGradient textures.
 */
export function fillSceneCover(g: Graphics, cover: number, nowMs: number, w = DESIGN_WIDTH, h = DESIGN_HEIGHT): void {
  const amount = Math.max(0, Math.min(1, cover));
  if (amount <= 0.001) return;
  if (amount >= 0.97) {
    g.rect(0, 0, w, h).fill(DEFAULT_THEME.ink);
    return;
  }
  fillParallelogram(g, -80, -20, w * amount + 140, h + 40, 70, DEFAULT_THEME.ink, 0.98);
  fillSlash(g, w * amount - 36, -12, 88, h + 24, 40, DEFAULT_THEME.accent, 0.92);
  fillSlash(g, w * amount + 18, 16, 36, h, 28, DEFAULT_THEME.paper, 0.5);
  const edgeX = w * amount + 28;
  fillDiamondCluster(g, edgeX, h * 0.28, 22, 30, nowMs, DEFAULT_THEME.accent, 0.9, 5);
  fillDiamond(g, { cx: edgeX + 12, cy: h * 0.52, rx: 16, ry: 22, nowMs, phase: 0.8, wobble: 4 }, DEFAULT_THEME.paper, 0.45);
  fillDiamondCluster(g, edgeX + 6, h * 0.76, 18, 24, nowMs + 180, DEFAULT_THEME.accent, 0.7, 4.5);
}

/**
 * Paints the wipe as the last child of `layer` so HUD text / list rows cannot draw on top of a cover.
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

export function fillBgBands(
  g: Graphics,
  nowMs = 0,
  bands: ReadonlyArray<readonly [number, number]> = DEFAULT_BG_BANDS,
): void {
  let top = 0;
  for (const [color, bottom] of bands) {
    g.rect(0, top, DESIGN_WIDTH, bottom - top).fill(color);
    top = bottom;
  }
  fillSlash(g, -60, 6, 280, 16, 18, DEFAULT_THEME.accent, 0.22);
  fillSlash(g, 360, 428, 320, 20, 14, DEFAULT_THEME.accent, 0.14);
  fillDiamond(g, { cx: 600, cy: 36, rx: 10, ry: 14, nowMs, phase: 0.2, wobble: 3 }, DEFAULT_THEME.accent, 0.35);
  fillDiamond(g, { cx: 52, cy: 454, rx: 12, ry: 16, nowMs, phase: 1.1, wobble: 3.5 }, DEFAULT_THEME.accent, 0.28);
  fillDiamond(g, { cx: 318, cy: 18, rx: 8, ry: 11, nowMs, phase: 0.7, wobble: 2.6 }, DEFAULT_THEME.paper, 0.18);
  fillDiamond(g, { cx: 168, cy: 468, rx: 9, ry: 12, nowMs, phase: 1.5, wobble: 3 }, DEFAULT_THEME.gold, 0.16);
}
