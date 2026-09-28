import { Graphics, type Container } from 'pixi.js';
import { BGA, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../../gameplay-constants.ts';
import type { SkinlessGameplayChromeRuntime } from '../../gameplay-chrome.ts';
import type { ChildPool } from '../../pixi-utils.ts';
import { DEFAULT_DISPLAY_FONT } from '../fonts.ts';
import { addHudText } from '../hud-text.ts';
import { effectProfile, impulse, momentProgress, trackMoments } from '../moments.ts';
import { addRansomText, drawTearStrip, stripPoint, type GlyphFactory, type TearStrip } from './tear.ts';
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
 * - the count-in: a torn-paper strip rips across the screen with READY? in ransom-note letters, then a second rip
 *   tears the other way and slams GO!! as the first beat lands;
 * - every 100 combo: a torn strip rips in over the BGA side (never over the lanes) with the count in a gold burst and
 *   COMBO!! cut from magazines;
 * - the gauge crossing the clear line: a gold CLEAR! tag pops off the gauge with a flash;
 * - a full combo: a white flash, a giant turning burst, confetti, and a screen-wide rip carrying FULL COMBO in
 *   ransom-note letters (the chart is over, so it may cover the playfield).
 */
/** Returns true while a moment covers the playfield (the full combo), so the caller can hold back judgement type. */
export function drawPhantomMoments(
  chromeLayer: Container,
  layer: Container,
  runtime: SkinlessGameplayChromeRuntime,
  pool: ChildPool | undefined,
): boolean {
  const nowMs = runtime.nowMs ?? 0;
  const moments = trackMoments(chromeLayer, {
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
  const effects = effectProfile(runtime.effects);
  if (!effects.enabled) return false;
  const graphics = pool?.acquireGraphics() ?? new Graphics();
  graphics.label = 'phantom/moments';
  if (!pool) layer.addChild(graphics);

  // Misses hit back: a red vignette, and (full effects) a short sideways shake of the whole HUD.
  const miss = runtime.lastJudge === 'POOR' || runtime.lastJudge === 'BAD' ? impulse(runtime.judgeAtMs, nowMs, 260) : 0;
  if (miss > 0) {
    drawMissVignette(graphics, miss);
    if (effects.screenWide) {
      const shake = Math.sin(nowMs / 11) * 5 * miss;
      chromeLayer.position.set(shake, 0);
      layer.position.set(shake, 0);
    }
  }
  const comboBreak = momentProgress(moments.comboBreak?.atMs, nowMs, BREAK_MS);
  if (comboBreak !== undefined && moments.comboBreak) {
    drawComboBreak(graphics, layer, moments.comboBreak.combo, comboBreak, pool);
  }

  if (runtime.chartMs !== undefined) {
    drawCountIn(graphics, layer, runtime.chartMs, pool);
  }
  const milestone = momentProgress(moments.milestone?.atMs, nowMs, MILESTONE_MS);
  if (milestone !== undefined && moments.milestone) {
    drawMilestone(graphics, layer, moments.milestone.value, milestone, runtime.hasBga === true, pool, nowMs);
  }
  const clear = momentProgress(moments.clearAtMs, nowMs, CLEAR_MS);
  if (clear !== undefined) {
    drawClear(graphics, layer, clear, pool);
  }
  const fullCombo = momentProgress(moments.fullComboAtMs, nowMs, FULL_COMBO_MS);
  if (fullCombo !== undefined) {
    drawFullCombo(graphics, layer, fullCombo, nowMs, effects.screenWide, pool);
  }
  return fullCombo !== undefined && fullCombo > 0.04 && fullCombo < 0.9;
}

const BREAK_MS = 700;

/** Red edges bleeding in from the screen border on a BAD / POOR. */
function drawMissVignette(graphics: Graphics, strength: number): void {
  const depth = 34;
  for (let band = 0; band < 3; band += 1) {
    const inset = band * (depth / 3);
    const alpha = 0.22 * strength * (1 - band / 3);
    const w = depth / 3;
    graphics.rect(inset, 0, w, DESIGN_HEIGHT).fill({ color: PHANTOM_RED, alpha });
    graphics.rect(DESIGN_WIDTH - inset - w, 0, w, DESIGN_HEIGHT).fill({ color: PHANTOM_RED, alpha });
    graphics.rect(0, inset, DESIGN_WIDTH, w).fill({ color: PHANTOM_RED, alpha });
    graphics.rect(0, DESIGN_HEIGHT - inset - w, DESIGN_WIDTH, w).fill({ color: PHANTOM_RED, alpha });
  }
}

/** A broken combo shatters: the old count drops and fades in red while ink / red shards fly off it. */
function drawComboBreak(
  graphics: Graphics,
  layer: Container,
  combo: number,
  t: number,
  pool: ChildPool | undefined,
): void {
  const cx = PLAYFIELD.x + PLAYFIELD.w / 2;
  const cy = 270;
  const fall = easeOutCubic(t);
  for (let shard = 0; shard < 10; shard += 1) {
    const angle = -Math.PI / 2 + (hash01(shard + combo) - 0.5) * 2.6;
    const speed = 40 + hash01(shard * 3 + 1) * 70;
    const x = cx + Math.cos(angle) * speed * fall;
    const y = cy + Math.sin(angle) * speed * fall + 90 * t * t;
    const size = 5 + hash01(shard + 9) * 7;
    graphics
      .poly(rotatedRect(x, y, size, size * 0.6, t * 8 + shard))
      .fill({ color: shard % 2 === 0 ? PHANTOM_RED_HOT : PHANTOM_INK, alpha: 1 - t });
  }
  const text = addHudText(
    layer,
    String(combo),
    cx,
    cy + 30 * t * t,
    {
      size: 24,
      fill: PHANTOM_RED_HOT,
      fontFamily: DEFAULT_DISPLAY_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      skewX: SKEW,
      stroke: { color: PHANTOM_INK, width: 4, alignment: 0.5, join: 'miter' },
    },
    pool,
  );
  text.rotation = 0.35 * t;
  text.alpha = 1 - t;
}

/** READY? → GO!! count-in over the last ~2.8 s before the first beat. */
function drawCountIn(graphics: Graphics, layer: Container, chartMs: number, pool: ChildPool | undefined): void {
  if (chartMs < -2800 || chartMs > 450) return;
  const cy = 236;
  const glyph = hudGlyphs(layer, pool);
  // READY?: the rip opens and holds until GO, then snaps shut.
  const readyT =
    chartMs < -650 ? ((chartMs + 2800) / 2150) * 0.8 : 0.85 + Math.min(0.15, ((chartMs + 650) / 150) * 0.15);
  const ready: TearStrip = { cx: DESIGN_WIDTH / 2, cy, angle: -0.12, length: 900, thickness: 112, seed: 5 };
  const readyOpen = drawTearStrip(graphics, ready, readyT, chartMs);
  if (readyOpen > 0.05 && chartMs < -650) {
    // A nervous little shake while waiting.
    const shake = Math.sin(chartMs / 28) * 1.4;
    const at = stripPoint(ready, shake, 0);
    addRansomText(graphics, glyph, 'READY?', at.x, at.y, {
      size: 54 * Math.min(1, readyOpen),
      seed: 11,
      angle: ready.angle,
      appear: (index) => stageProgress(chartMs, -2700 + index * 70, 180),
    });
  }
  if (chartMs < -650) return;
  // GO!!: a second rip tears the other way with a gold slam on a turning burst.
  const go: TearStrip = { cx: DESIGN_WIDTH / 2, cy, angle: 0.1, length: 900, thickness: 128, seed: 9 };
  const goT = (chartMs + 650) / 1100;
  const goOpen = drawTearStrip(graphics, go, goT, chartMs);
  if (goOpen <= 0.02) return;
  const slam = easeOutBack(stageProgress(chartMs, -650, 280));
  const scale = (2.2 - 1.2 * slam) * Math.min(1, goOpen);
  graphics
    .poly(starburstPoints(DESIGN_WIDTH / 2, cy, 150 * scale, 96 * scale, 16, chartMs / 900, 0.18, 7))
    .fill({ color: PHANTOM_RED, alpha: 0.9 });
  const text = addHudText(
    layer,
    'GO!!',
    DESIGN_WIDTH / 2,
    cy,
    {
      size: 88,
      fill: PHANTOM_GOLD,
      fontFamily: DEFAULT_DISPLAY_FONT,
      letterSpacing: 4,
      anchorX: 0.5,
      anchorY: 0.5,
      skewX: SKEW,
      rotation: go.angle,
      stroke: { color: PHANTOM_INK, width: 8, alignment: 0.5, join: 'miter' },
      dropShadow: { color: PHANTOM_WHITE, alpha: 1, blur: 0, distance: 6, angle: Math.PI / 4 },
    },
    pool,
  );
  text.scale.set(scale);
}

/** Pooled (or fresh) HUD glyphs for ransom-note lettering. */
function hudGlyphs(layer: Container, pool: ChildPool | undefined): GlyphFactory {
  return (char, options) =>
    addHudText(
      layer,
      char,
      0,
      0,
      { size: options.size, weight: options.weight, fill: options.fill, fontFamily: options.fontFamily },
      pool,
    );
}

/** 100 COMBO!! — a torn strip rips in over the BGA side with the count in a gold burst. */
function drawMilestone(
  graphics: Graphics,
  layer: Container,
  value: number,
  t: number,
  hasBga: boolean,
  pool: ChildPool | undefined,
  nowMs: number,
): void {
  // Over a live BGA the strip rides the monitor's bottom edge instead of covering the middle of the video.
  const strip: TearStrip = hasBga
    ? { cx: BGA.x + BGA.w / 2 + 40, cy: BGA.y + BGA.h - 14, angle: -0.07, length: 440, thickness: 54, seed: value }
    : { cx: 462, cy: 200, angle: -0.12, length: 440, thickness: 86, seed: value };
  const open = drawTearStrip(graphics, strip, t, nowMs);
  if (open <= 0.05) return;
  const size = Math.min(1, open);
  const burst = stripPoint(strip, -128, 0);
  graphics
    .poly(
      starburstPoints(
        burst.x,
        burst.y,
        50 * size * (hasBga ? 0.8 : 1),
        32 * size * (hasBga ? 0.8 : 1),
        12,
        t * 3,
        0.22,
        value,
      ),
    )
    .fill(PHANTOM_GOLD)
    .stroke({ color: PHANTOM_INK, width: 3 });
  addHudText(
    layer,
    String(value),
    burst.x + 2,
    burst.y,
    {
      size: hasBga ? 28 : 34,
      fill: PHANTOM_INK,
      fontFamily: DEFAULT_DISPLAY_FONT,
      anchorX: 0.5,
      anchorY: 0.5,
      skewX: SKEW,
      rotation: strip.angle,
      maxWidth: 70,
    },
    pool,
  ).scale.y *= size;
  const word = stripPoint(strip, 48, 0);
  addRansomText(graphics, hudGlyphs(layer, pool), 'COMBO!!', word.x, word.y, {
    size: (hasBga ? 30 : 40) * size,
    seed: value + 3,
    angle: strip.angle,
    appear: (index) => Math.max(0, (t - 0.04 - index * 0.025) / 0.08),
  });
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
  screenWide: boolean,
  pool: ChildPool | undefined,
): void {
  const cx = DESIGN_WIDTH / 2;
  const cy = DESIGN_HEIGHT / 2;
  const fadeOut = 1 - Math.max(0, (t - 0.82) / 0.18);
  const flash = screenWide ? Math.max(0, 1 - t * 7) : 0;
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
  // The rip: a screen-wide torn strip carrying FULL COMBO cut from magazines.
  const strip: TearStrip = { cx, cy, angle: -0.1, length: 980, thickness: 132, seed: 21 };
  const open = drawTearStrip(graphics, strip, Math.max(0, (t - 0.05) / 0.95), nowMs);
  if (open > 0.05) {
    addRansomText(graphics, hudGlyphs(layer, pool), 'FULL COMBO', cx, cy, {
      size: 60 * Math.min(1, open),
      seed: 31,
      angle: strip.angle,
      appear: (index) => Math.max(0, (t - 0.1 - index * 0.022) / 0.06),
    });
  }
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
