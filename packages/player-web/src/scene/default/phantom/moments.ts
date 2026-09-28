import { Graphics, type Container } from 'pixi.js';
import { DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE } from '../../gameplay-constants.ts';
import type { SkinlessGameplayChromeRuntime } from '../../gameplay-chrome.ts';
import type { ChildPool } from '../../pixi-utils.ts';
import { DEFAULT_DISPLAY_FONT } from '../fonts.ts';
import { addHudText } from '../hud-text.ts';
import { momentProgress, trackMoments } from '../moments.ts';
import {
  PHANTOM_GOLD,
  PHANTOM_INK,
  PHANTOM_PAPER,
  PHANTOM_RED,
  PHANTOM_RED_HOT,
  PHANTOM_WHITE,
  easeOutBack,
  easeOutCubic,
  hash01,
  parallelogramPoints,
  stageProgress,
  starburstPoints,
} from '../phantom-style.ts';

const MILESTONE_MS = 1100;
const CLEAR_MS = 1000;
const FULL_COMBO_MS = 3000;
const SKEW = -0.18;

/**
 * Phantom showpieces, painted on the front layer above the HUD:
 *
 * - the count-in: an ink slab slashes across the screen with "READY?", flips red and slams "GO!!", then tears away
 *   to the right as the first beat lands;
 * - every 100 combo: a red banner with a gold burst cuts in over the BGA side (never over the lanes);
 * - the gauge crossing the clear line: a gold CLEAR! tag pops off the gauge with a flash;
 * - a full combo: a white flash, a giant turning burst, confetti, and FULL COMBO stamped across the screen (the chart
 *   is over, so it may cover the playfield).
 */
export function drawPhantomMoments(
  key: object,
  layer: Container,
  runtime: SkinlessGameplayChromeRuntime,
  pool: ChildPool | undefined,
): void {
  const nowMs = runtime.nowMs ?? 0;
  const moments = trackMoments(key, {
    nowMs,
    combo: runtime.combo ?? 0,
    gauge: runtime.gauge ?? 0,
    clearThreshold: runtime.clearThreshold ?? 80,
    survival: runtime.gaugeSurvival === true,
    judged:
      (runtime.perfect ?? 0) + (runtime.great ?? 0) + (runtime.good ?? 0) + (runtime.bad ?? 0) + (runtime.poor ?? 0),
    totalNotes: runtime.totalNotes ?? 0,
    bad: runtime.bad ?? 0,
    poor: runtime.poor ?? 0,
  });
  const graphics = pool?.acquireGraphics() ?? new Graphics();
  graphics.label = 'phantom/moments';
  if (!pool) layer.addChild(graphics);

  if (runtime.chartMs !== undefined) {
    drawCountIn(graphics, layer, runtime.chartMs, pool);
  }
  const milestone = momentProgress(moments.milestone?.atMs, nowMs, MILESTONE_MS);
  if (milestone !== undefined && moments.milestone) {
    drawMilestone(graphics, layer, moments.milestone.value, milestone, pool);
  }
  const clear = momentProgress(moments.clearAtMs, nowMs, CLEAR_MS);
  if (clear !== undefined) {
    drawClear(graphics, layer, clear, pool);
  }
  const fullCombo = momentProgress(moments.fullComboAtMs, nowMs, FULL_COMBO_MS);
  if (fullCombo !== undefined) {
    drawFullCombo(graphics, layer, fullCombo, nowMs, pool);
  }
}

/** READY? → GO!! count-in over the last ~2.8 s before the first beat. */
function drawCountIn(graphics: Graphics, layer: Container, chartMs: number, pool: ChildPool | undefined): void {
  if (chartMs < -2800 || chartMs > 450) return;
  const cy = 236;
  const enter = easeOutCubic(stageProgress(chartMs, -2800, 320));
  const exit = easeOutCubic(stageProgress(chartMs, 0, 420));
  const go = chartMs >= -650;
  const shift = (1 - enter) * -DESIGN_WIDTH * 1.2 + exit * DESIGN_WIDTH * 1.3;
  const alpha = 1 - exit;
  // Shadow slab, main slab, and paper cut lines.
  graphics
    .poly(parallelogramPoints(shift - 60, cy - 62, DESIGN_WIDTH + 120, 124, 40))
    .fill({ color: go ? PHANTOM_INK : PHANTOM_RED, alpha: 0.9 * alpha });
  graphics
    .poly(parallelogramPoints(shift - 60, cy - 52, DESIGN_WIDTH + 120, 104, 40))
    .fill({ color: go ? PHANTOM_RED : PHANTOM_INK, alpha: alpha });
  graphics
    .poly(parallelogramPoints(shift - 60, cy - 56, DESIGN_WIDTH + 120, 3, 40))
    .fill({ color: PHANTOM_WHITE, alpha });
  graphics
    .poly(parallelogramPoints(shift - 60, cy + 50, DESIGN_WIDTH + 120, 3, 40))
    .fill({ color: PHANTOM_WHITE, alpha });
  if (!go) {
    // A nervous little shake while waiting.
    const shake = Math.sin(chartMs / 28) * 1.6;
    addHudText(
      layer,
      'READY?',
      DESIGN_WIDTH / 2 + shift + shake,
      cy,
      {
        size: 64,
        fill: PHANTOM_WHITE,
        fontFamily: DEFAULT_DISPLAY_FONT,
        letterSpacing: 6,
        anchorX: 0.5,
        anchorY: 0.5,
        skewX: SKEW,
        dropShadow: { color: PHANTOM_RED, alpha: 1, blur: 0, distance: 6, angle: Math.PI / 4 },
      },
      pool,
    );
    return;
  }
  const slam = easeOutBack(stageProgress(chartMs, -650, 280));
  const scale = 2.2 - 1.2 * slam;
  graphics
    .poly(starburstPoints(DESIGN_WIDTH / 2 + shift, cy, 150 * scale, 96 * scale, 16, chartMs / 900, 0.18, 7))
    .fill({ color: PHANTOM_INK, alpha: 0.55 * alpha });
  const text = addHudText(
    layer,
    'GO!!',
    DESIGN_WIDTH / 2 + shift,
    cy,
    {
      size: 88,
      fill: PHANTOM_GOLD,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 4,
      anchorX: 0.5,
      anchorY: 0.5,
      skewX: SKEW,
      stroke: { color: PHANTOM_INK, width: 8, alignment: 0.5, join: 'miter' },
      dropShadow: { color: PHANTOM_WHITE, alpha: 1, blur: 0, distance: 6, angle: Math.PI / 4 },
    },
    pool,
  );
  text.scale.set(scale);
  text.alpha = alpha;
}

/** "100 COMBO!!" banner cutting in over the BGA side. */
function drawMilestone(
  graphics: Graphics,
  layer: Container,
  value: number,
  t: number,
  pool: ChildPool | undefined,
): void {
  const inT = easeOutCubic(Math.min(1, t / 0.14));
  const outT = easeOutCubic(Math.max(0, (t - 0.8) / 0.2));
  const x = 300 + (1 - inT) * 380 + outT * 380;
  const y = 196;
  graphics.poly(parallelogramPoints(x + 8, y + 8, 360, 58, 18)).fill(PHANTOM_INK);
  graphics
    .poly(parallelogramPoints(x, y, 360, 58, 18))
    .fill(PHANTOM_RED)
    .stroke({ color: PHANTOM_WHITE, width: 3 });
  const burstX = x + 58;
  graphics
    .poly(starburstPoints(burstX, y + 29, 50, 32, 12, t * 3, 0.22, value))
    .fill(PHANTOM_GOLD)
    .stroke({ color: PHANTOM_INK, width: 3 });
  addHudText(
    layer,
    String(value),
    burstX + 2,
    y + 29,
    {
      size: 34,
      fill: PHANTOM_INK,
      fontFamily: DEFAULT_DISPLAY_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      skewX: SKEW,
      maxWidth: 70,
    },
    pool,
  );
  addHudText(
    layer,
    'COMBO!!',
    x + 118,
    y + 29,
    {
      size: 40,
      fill: PHANTOM_WHITE,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 3,
      anchorY: 0.5,
      skewX: SKEW,
      dropShadow: { color: PHANTOM_INK, alpha: 1, blur: 0, distance: 4, angle: Math.PI / 4 },
    },
    pool,
  );
}

/** Gauge crossing the clear line: a flash over the gauge and a CLEAR! tag popping off it. */
function drawClear(graphics: Graphics, layer: Container, t: number, pool: ChildPool | undefined): void {
  const flash = Math.max(0, 1 - t * 3);
  graphics
    .rect(GROOVE.x - 6, GROOVE.y - 4, GROOVE.w + 12, GROOVE.h + 8)
    .fill({ color: PHANTOM_WHITE, alpha: 0.85 * flash });
  const pop = easeOutBack(Math.min(1, t / 0.2));
  const lift = easeOutCubic(t) * 10;
  const alpha = 1 - Math.max(0, (t - 0.75) / 0.25);
  // Beside the gauge housing's right end, clear of the playfield frame above it.
  const cx = GROOVE.x + GROOVE.w + 62;
  const cy = GROOVE.y - 6 - lift;
  graphics
    .poly(parallelogramPoints(cx - 44 * pop, cy - 14 * pop, 88 * pop, 28 * pop, 8 * pop))
    .fill({ color: PHANTOM_GOLD, alpha })
    .stroke({ color: PHANTOM_INK, width: 2, alpha });
  const text = addHudText(
    layer,
    'CLEAR!',
    cx + 3,
    cy,
    {
      size: 18,
      fill: PHANTOM_INK,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 2,
      anchorX: 0.5,
      anchorY: 0.5,
      skewX: SKEW,
    },
    pool,
  );
  text.scale.set(pop);
  text.alpha = alpha;
}

/** Full combo: flash, turning burst, confetti, and the stamp. */
function drawFullCombo(
  graphics: Graphics,
  layer: Container,
  t: number,
  nowMs: number,
  pool: ChildPool | undefined,
): void {
  const cx = DESIGN_WIDTH / 2;
  const cy = DESIGN_HEIGHT / 2;
  const fadeOut = 1 - Math.max(0, (t - 0.82) / 0.18);
  const flash = Math.max(0, 1 - t * 7);
  if (flash > 0) {
    graphics.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: PHANTOM_WHITE, alpha: 0.9 * flash });
  }
  const grow = easeOutCubic(Math.min(1, t / 0.25));
  graphics
    .poly(starburstPoints(cx, cy, 330 * grow, 210 * grow, 20, nowMs / 1400, 0.16, 5))
    .fill({ color: PHANTOM_RED, alpha: 0.92 * fadeOut });
  graphics
    .poly(starburstPoints(cx, cy, 250 * grow, 170 * grow, 20, -nowMs / 1100, 0.2, 9))
    .fill({ color: PHANTOM_INK, alpha: 0.85 * fadeOut });
  // Confetti: paper, red, and gold slips thrown out of the centre, tumbling as they fall.
  const seconds = t * (FULL_COMBO_MS / 1000);
  for (let index = 0; index < 46; index += 1) {
    const angle = hash01(index + 3) * Math.PI * 2;
    const speed = 160 + hash01(index + 7) * 260;
    const x = cx + Math.cos(angle) * speed * seconds;
    const y = cy + Math.sin(angle) * speed * seconds * 0.8 + 120 * seconds * seconds;
    const spin = seconds * (4 + hash01(index + 11) * 6);
    const size = 5 + hash01(index + 13) * 7;
    const color = [PHANTOM_PAPER, PHANTOM_RED_HOT, PHANTOM_GOLD][index % 3]!;
    graphics.poly(rotatedRect(x, y, size, size * 0.55, spin)).fill({ color, alpha: fadeOut });
  }
  const slam = easeOutBack(stageProgress(t, 0.06, 0.12));
  graphics
    .poly(parallelogramPoints(-40, cy - 46, DESIGN_WIDTH + 80, 92, 30))
    .fill({ color: PHANTOM_INK, alpha: 0.8 * fadeOut * Math.min(1, slam) });
  const text = addHudText(
    layer,
    'FULL COMBO',
    cx,
    cy,
    {
      size: 72,
      fill: PHANTOM_GOLD,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 4,
      anchorX: 0.5,
      anchorY: 0.5,
      skewX: SKEW,
      stroke: { color: PHANTOM_INK, width: 8, alignment: 0.5, join: 'miter' },
      dropShadow: { color: PHANTOM_RED, alpha: 1, blur: 0, distance: 7, angle: Math.PI / 4 },
      maxWidth: DESIGN_WIDTH - 60,
    },
    pool,
  );
  text.scale.set(Math.max(0.01, 2.4 - 1.4 * slam));
  text.alpha = fadeOut * Math.min(1, slam * 1.5);
}

function rotatedRect(cx: number, cy: number, w: number, h: number, angle: number): number[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const points: number[] = [];
  for (const [dx, dy] of [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ] as const) {
    points.push(cx + dx * cos - dy * sin, cy + dx * sin + dy * cos);
  }
  return points;
}
