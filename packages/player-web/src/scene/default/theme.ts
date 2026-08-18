import type { Graphics } from 'pixi.js';

/**
 * Built-in default-skin palette. The shapes are original (no third-party assets) — black / crimson / cream / gold
 * plus diagonal cuts so the chrome can slam like a cut-in comic, not a calm HUD.
 */
export const DEFAULT_THEME = {
  ink: 0x080403,
  inkDeep: 0x040201,
  panel: 0x140a08,
  panelLift: 0x1c100c,
  paper: 0xf3e6c8,
  paperDim: 0xc4b496,
  mute: 0x8a7a68,
  line: 0x3a241c,
  crimson: 0xe10600,
  blood: 0x7a0508,
  gold: 0xffe14a,
  white: 0xfff7ea,
  cyanGhost: 0x3fe0ff,
  lane: 0x060303,
  rail: 0x1a0c0a,
  railEdge: 0x5a2a22,
  measure: 0xf3e6c8,
  judgePerfect: 0xffe14a,
  judgeGreat: 0xf3e6c8,
  judgeGood: 0xc4b496,
  judgeBad: 0xff8a3d,
  judgePoor: 0xe10600,
} as const;

export const DEFAULT_BG_BANDS: ReadonlyArray<readonly [number, number]> = [
  [0x1a0806, 70],
  [0x120604, 150],
  [0x0c0403, 260],
  [0x080302, 360],
  [0x040201, 480],
];

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

/**
 * A thick diagonal slash. `lean` > 0 leans down-right (the usual cut-in).
 */
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
