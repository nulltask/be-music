import {
  clamp,
  STAGE_WIDTH as DESIGN_WIDTH,
  type BeMusicGameplayRuntime,
  type BeMusicRect,
} from '@be-music/player-skin-sdk';
import type { Container, Graphics } from 'pixi.js';
import { addHUDNumber, addHUDText, type ChildPool } from '../pixi-kit/index.ts';
import { drawFrame } from './draw.ts';
import { GROOVE } from './layout.ts';
import { emberColor, hsvToHex } from './space.ts';
import { SYN_AMBER, SYN_CYAN, SYN_DIM, SYN_EMBER, SYN_MIST, SYN_WHITE, displayStyle, labelStyle } from './style.ts';

type Runtime = BeMusicGameplayRuntime;
/** What a gauge draws from: the 1P runtime, or the 2P player's figures of a two-player play. */
type GaugeState = Pick<Runtime, 'gauge' | 'clearThreshold' | 'gaugeSurvival' | 'gaugeLabel' | 'nowMs'>;

/** The landscape gauge frame (design px): the top of the HUD's left column (16..272), around {@link GROOVE}. */
export const GAUGE_FRAME = { x: 16, y: GROOVE.y - 26, w: 256, h: 48 } as const;
/**
 * A two-player play's gauge frames: the 1P and 2P ones share the room left of the score panel (which starts 340 px off
 * the right margin), split by the 12 px gutter.
 */
const TWO_PLAYER_FRAME_W = (DESIGN_WIDTH - 16 - 340 - 12 - GAUGE_FRAME.x - 12) / 2;
const GAUGE_FRAMES_2P = [
  { ...GAUGE_FRAME, w: TWO_PLAYER_FRAME_W },
  { ...GAUGE_FRAME, x: GAUGE_FRAME.x + TWO_PLAYER_FRAME_W + 12, w: TWO_PLAYER_FRAME_W },
] as const;
/** The groove's inset in its frame: left of it, and right of it. */
const GROOVE_INSET = GROOVE.x - GAUGE_FRAME.x;
/** The width the 2P player's figures take at the song plate's right end. */
export const SECOND_PLAYER_FIGURES_WIDTH = 200;

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return clamp(value, 0, 100);
}

/** The landscape gauges: the player's, or each player's under its own label in a two-player play. */
export function drawGauges(
  graphics: Graphics,
  layer: Container,
  runtime: Runtime,
  accent: number,
  pool: ChildPool,
): void {
  const second = runtime.secondPlayer;
  if (second === undefined) {
    drawGauge(graphics, layer, runtime, GAUGE_FRAME, '', accent, pool);
    return;
  }
  const state: GaugeState = { ...second, ...(runtime.nowMs !== undefined ? { nowMs: runtime.nowMs } : {}) };
  drawGauge(graphics, layer, runtime, GAUGE_FRAMES_2P[0], '1P ', accent, pool);
  drawGauge(graphics, layer, state, GAUGE_FRAMES_2P[1], '2P ', accent, pool);
}

function drawGauge(
  graphics: Graphics,
  layer: Container,
  state: GaugeState,
  frame: BeMusicRect,
  prefix: string,
  accent: number,
  pool: ChildPool,
): void {
  const gauge = clampPercent(state.gauge ?? 0);
  const clear = clampPercent(state.clearThreshold ?? 80);
  const survival = state.gaugeSurvival === true || clear <= 0;
  const cleared = survival ? gauge > 0 : gauge >= clear;
  const groove = { ...GROOVE, x: frame.x + GROOVE_INSET, w: frame.w - GROOVE_INSET * 2 };
  drawFrame(graphics, frame.x, frame.y, frame.w, frame.h, accent);
  addHUDText(
    layer,
    `${prefix}${(state.gaugeLabel ?? 'GROOVE').toUpperCase()} GAUGE`,
    groove.x - 2,
    groove.y - 19,
    // The label runs from the groove's left edge up to a gap before the percentage readout (right-aligned at the
    // frame's inner edge, up to `100%` wide), so a course gauge's long name (`COURSE-EASY GAUGE`) fits.
    { ...labelStyle(), maxWidth: frame.w - 14 - 56 - (GROOVE_INSET - 2) },
    pool,
  );
  addHUDNumber(
    layer,
    `${Math.round(gauge)}%`,
    frame.x + frame.w - 14,
    groove.y - 22,
    { ...displayStyle(12, cleared ? SYN_AMBER : SYN_WHITE), anchorX: 1 },
    pool,
  );
  drawGaugeCells(graphics, state, groove, groove.h - 4);
}

/**
 * The gauge's cells along `groove` (bars `barH` tall, centred in it): electric blue below the clear line, catching fire
 * past it, the head cell flickering white, and a white notch on the clear line.
 */
export function drawGaugeCells(graphics: Graphics, state: GaugeState, groove: BeMusicRect, barH: number): void {
  const gauge = clampPercent(state.gauge ?? 0);
  const clear = clampPercent(state.clearThreshold ?? 80);
  const survival = state.gaugeSurvival === true || clear <= 0;
  const cleared = survival ? gauge > 0 : gauge >= clear;
  const cells = 50;
  const stride = groove.w / cells;
  const lit = Math.round((gauge / 100) * cells);
  const clearCell = Math.round((clear / 100) * cells);
  const flicker = state.nowMs !== undefined ? 0.65 + 0.35 * Math.abs(Math.sin(state.nowMs / 60)) : 1;
  const barY = groove.y + (groove.h - barH) / 2;
  if (lit > 0) {
    graphics
      .rect(groove.x, barY - 3, lit * stride, barH + 6)
      .fill({ color: cleared ? SYN_EMBER : SYN_CYAN, alpha: 0.14 });
  }
  for (let cell = 0; cell < cells; cell += 1) {
    const x = groove.x + cell * stride;
    if (cell >= lit) {
      graphics.rect(x, barY, stride - 1, barH).fill({ color: SYN_DIM, alpha: 0.18 });
      continue;
    }
    const hot = survival || cell >= clearCell;
    // Below the clear line the cells run electric blue; past it they catch fire, ember → gold.
    const color = hot
      ? emberColor(0.4 + (0.55 * (cell - clearCell)) / Math.max(1, cells - clearCell))
      : hsvToHex(0.58 - (cell / cells) * 0.04, 0.72, 1);
    graphics
      .rect(x, barY, stride - 1, barH)
      .fill({ color: cell === lit - 1 ? SYN_WHITE : color, alpha: cell === lit - 1 ? flicker : 0.95 });
  }
  if (!survival) {
    const x = groove.x + clearCell * stride - 1;
    graphics.rect(x, barY - 5, 1.5, barH + 10).fill({ color: SYN_WHITE, alpha: 1 });
  }
}

/**
 * A two-player play's 2P figures at the right end of the song plate `plate`: its EX score and combo, label over value
 * like the score panel's.
 */
export function drawSecondPlayerFigures(layer: Container, runtime: Runtime, plate: BeMusicRect, pool: ChildPool): void {
  const second = runtime.secondPlayer;
  if (second === undefined) return;
  const right = plate.x + plate.w - 14;
  const figures: ReadonlyArray<readonly [label: string, value: string, x: number]> = [
    ['2P EX SCORE', `${Math.max(0, second.exScore)}/${Math.max(0, second.exScoreMax)}`, right - 96],
    ['2P COMBO', String(Math.max(0, second.combo)), right],
  ];
  for (const [label, value, x] of figures) {
    addHUDText(layer, label, x, plate.y + 8, { ...labelStyle(), anchorX: 1 }, pool);
    addHUDNumber(layer, value, x, plate.y + 22, { ...displayStyle(13, SYN_MIST), anchorX: 1, maxWidth: 80 }, pool);
  }
}
