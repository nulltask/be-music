import type { Container, Graphics } from 'pixi.js';
import { BGA, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../../gameplay-constants.ts';
import type { SkinlessGameplayChromeRuntime } from '../../gameplay-chrome.ts';
import type { ChildPool } from '../../pixi-utils.ts';
import { addHudText } from '../hud-text.ts';
import { effectProfile, impulse, momentProgress, type MomentState } from '../moments.ts';
import { easeOutCubic, hash01 } from '../phantom-style.ts';
import { addStaggeredHudText, displayStyle, monoStyle } from './draw.ts';
import { countInStep, scrambleText, scrambleTick, springEase, tileFlipPhase } from './field.ts';
import { LAT_ACCENT, LAT_INK, LAT_PAPER, LAT_SIGNAL, LAT_WHITE } from './style.ts';

export const MILESTONE_MS = 1400;
export const FULL_COMBO_MS = 3200;
const CLEAR_MS = 1000;
const BREAK_MS = 900;

/**
 * Lattice showpieces, set as kinetic type on the front layer (the needle field reacts to the same moments in the
 * chrome):
 *
 * - the count-in: 3 / 2 / 1 roll through a thin ring that draws itself round each step, then GO;
 * - every 100 combo: the figures drop onto the monitor digit by digit on a spring while the field swings toward them;
 * - the clear line: CLEAR slides out of the gauge on a hairline;
 * - a full combo: ink tiles flip across the screen in a diagonal wave, FULL COMBO drops in letter by letter in white,
 *   and the tiles flip back — while the field swirls;
 * - a miss knocks the HUD sideways in hard 2 px steps; a broken combo's digits fall away under gravity.
 */
export function drawLatticeMoments(
  chromeLayer: Container,
  layer: Container,
  runtime: SkinlessGameplayChromeRuntime,
  moments: MomentState,
  playfieldCenterX: number,
  pool: ChildPool,
): void {
  const nowMs = runtime.nowMs ?? 0;
  const effects = effectProfile(runtime.effects);
  if (!effects.enabled) return;
  const graphics = pool.acquireGraphics();
  graphics.label = 'lattice/moments';
  graphics.blendMode = 'normal';

  const miss = runtime.lastJudge === 'POOR' || runtime.lastJudge === 'BAD' ? impulse(runtime.judgeAtMs, nowMs, 220) : 0;
  if (miss > 0 && effects.screenWide) {
    // Quantized knock: the HUD jumps in whole 2 px steps, like a mechanism slipping a tooth.
    const knock = Math.round((Math.sin(nowMs / 14) * 3 * miss) / 2) * 2;
    chromeLayer.position.set(knock, 0);
    layer.position.set(knock, 0);
  }
  const comboBreak = momentProgress(moments.comboBreak?.atMs, nowMs, BREAK_MS);
  if (comboBreak !== undefined && moments.comboBreak) {
    drawComboBreak(layer, moments.comboBreak.combo, comboBreak, playfieldCenterX, pool);
  }
  if (runtime.chartMs !== undefined) {
    drawCountIn(graphics, layer, runtime.chartMs, playfieldCenterX, pool);
  }
  const milestone = momentProgress(moments.milestone?.atMs, nowMs, MILESTONE_MS);
  if (milestone !== undefined && moments.milestone) {
    drawMilestone(graphics, layer, moments.milestone.value, milestone, runtime.hasBga === true, pool);
  }
  const clear = momentProgress(moments.clearAtMs, nowMs, CLEAR_MS);
  if (clear !== undefined) {
    drawClear(graphics, layer, clear, pool);
  }
  const fullCombo = momentProgress(moments.fullComboAtMs, nowMs, FULL_COMBO_MS);
  if (fullCombo !== undefined) {
    drawFullCombo(graphics, layer, fullCombo, effects.screenWide, pool);
  }
}

function drawCountIn(
  graphics: Graphics,
  layer: Container,
  chartMs: number,
  playfieldCenterX: number,
  pool: ChildPool,
): void {
  const step = countInStep(chartMs);
  if (!step) return;
  const cx = playfieldCenterX;
  const cy = 190;
  const radius = 34;
  if (step.label !== 'GO') {
    // The ring draws itself round once per step, starting at twelve o'clock.
    graphics.circle(cx, cy, radius).stroke({ color: LAT_INK, width: 1, alpha: 0.2 });
    const sweep = easeOutCubic(Math.min(1, step.progress * 1.15)) * Math.PI * 2;
    if (sweep > 0.01) {
      graphics
        .moveTo(cx, cy - radius)
        .arc(cx, cy, radius, -Math.PI / 2, -Math.PI / 2 + sweep)
        .stroke({ color: LAT_ACCENT, width: 2 });
    }
    const drop = springEase(Math.min(1, step.progress * 2.4), 2.2, 0.5);
    const digit = addHudText(
      layer,
      step.label,
      cx,
      cy - 14 * (1 - drop),
      { ...displayStyle(40, LAT_INK, '200'), anchorX: 0.5, anchorY: 0.5 },
      pool,
    );
    digit.alpha = Math.min(1, step.progress * 6) * (1 - Math.max(0, (step.progress - 0.85) / 0.15));
    addHudText(
      layer,
      scrambleText('READY', step.progress * 2.5, scrambleTick(chartMs), 1),
      cx,
      cy + radius + 12,
      { ...monoStyle(LAT_INK), letterSpacing: 3, anchorX: 0.5 },
      pool,
    );
    return;
  }
  // GO: the ring bursts into a square that expands and fades, the word springs up.
  const t = step.progress;
  const size = radius * 2 * (1 + 1.6 * easeOutCubic(t));
  graphics
    .rect(cx - size / 2, cy - size / 2, size, size)
    .stroke({ color: LAT_ACCENT, width: 2 * (1 - t), alpha: 1 - t });
  addStaggeredHudText(
    layer,
    'GO',
    cx,
    cy,
    { ...displayStyle(40, LAT_INK, '600'), letterSpacing: 6, anchorX: 0.5, anchorY: 0.5 },
    pool,
    (index) => {
      const local = Math.max(0, t * 3 - index * 0.25);
      return { dy: 12 * (1 - springEase(Math.min(1, local), 2.2, 0.45)), alpha: Math.min(1, local * 3) * (1 - t) };
    },
  );
}

function drawMilestone(
  graphics: Graphics,
  layer: Container,
  value: number,
  t: number,
  hasBga: boolean,
  pool: ChildPool,
): void {
  const cx = BGA.x + BGA.w / 2;
  const cy = hasBga ? BGA.y + 36 : BGA.y + BGA.h / 2 - 12;
  const out = Math.max(0, (t - 0.78) / 0.22);
  const size = hasBga ? 32 : 64;
  if (hasBga) {
    // A paper label over the live video.
    const w = 170 * easeOutCubic(Math.min(1, t / 0.2));
    graphics.rect(cx - w / 2, cy - 26, w, 62).fill({ color: LAT_PAPER, alpha: 0.95 * (1 - out) });
  }
  addStaggeredHudText(
    layer,
    String(value),
    cx,
    cy,
    { ...displayStyle(size, LAT_ACCENT, '200'), anchorX: 0.5, anchorY: 0.5 },
    pool,
    (index) => {
      const local = Math.max(0, (t - index * 0.06) / 0.3);
      return {
        dy: -size * 0.45 * (1 - springEase(Math.min(1, local), 2, 0.45)) - out * 18,
        alpha: Math.min(1, local * 3) * (1 - out),
      };
    },
  );
  const rule = 120 * easeOutCubic(Math.min(1, Math.max(0, (t - 0.15) / 0.3)));
  graphics.rect(cx - rule / 2, cy + size * 0.42, rule, 1).fill({ color: LAT_INK, alpha: 1 - out });
  const label = addHudText(
    layer,
    scrambleText('COMBO', (t - 0.18) / 0.3, scrambleTick(t * MILESTONE_MS), value),
    cx,
    cy + size * 0.42 + 6,
    { ...monoStyle(LAT_INK), letterSpacing: 4, anchorX: 0.5 },
    pool,
  );
  label.alpha = Math.min(1, Math.max(0, (t - 0.2) / 0.15)) * (1 - out);
}

function drawClear(graphics: Graphics, layer: Container, t: number, pool: ChildPool): void {
  const out = Math.max(0, (t - 0.75) / 0.25);
  const reach = 64 * easeOutCubic(Math.min(1, t / 0.3));
  const x = GROOVE.x + GROOVE.w + 12;
  const y = GROOVE.y - 38;
  graphics.rect(x - reach, y + 14, reach, 1).fill({ color: LAT_ACCENT, alpha: 1 - out });
  addStaggeredHudText(
    layer,
    scrambleText('CLEAR', t / 0.35, scrambleTick(t * CLEAR_MS, 35), 3),
    x,
    y,
    { ...monoStyle(LAT_ACCENT), size: 11, letterSpacing: 3, anchorX: 1 },
    pool,
    (index, count) => {
      const local = Math.max(0, (t - (count - 1 - index) * 0.04) / 0.25);
      return { dx: 10 * (1 - springEase(Math.min(1, local))), alpha: Math.min(1, local * 3) * (1 - out) };
    },
  );
}

const FC_COLUMNS = 16;
const FC_ROWS = 12;

function drawFullCombo(graphics: Graphics, layer: Container, t: number, screenWide: boolean, pool: ChildPool): void {
  const cx = DESIGN_WIDTH / 2;
  const cy = DESIGN_HEIGHT / 2 - 10;
  // Tiles flip in (0 → 0.35), hold, and flip back out (0.72 → 1).
  const flipIn = Math.min(1, t / 0.35);
  const flipOut = Math.max(0, (t - 0.72) / 0.28);
  if (screenWide) {
    const tileW = DESIGN_WIDTH / FC_COLUMNS;
    const tileH = DESIGN_HEIGHT / FC_ROWS;
    for (let row = 0; row < FC_ROWS; row += 1) {
      for (let column = 0; column < FC_COLUMNS; column += 1) {
        const inPhase = tileFlipPhase(column, row, FC_COLUMNS, FC_ROWS, flipIn, 0.55);
        const outPhase = tileFlipPhase(column, row, FC_COLUMNS, FC_ROWS, flipOut, 0.55);
        const cover = inPhase * (1 - outPhase);
        if (cover <= 0) continue;
        const h = tileH * springEase(cover, 1.8, 0.6);
        const color = hash01(column * 31 + row * 17) > 0.95 ? LAT_ACCENT : LAT_INK;
        graphics.rect(column * tileW, row * tileH + (tileH - h) / 2, tileW + 0.5, h).fill(color);
      }
    }
  } else {
    // Reduced: a single ink band behind the words.
    const band = 90 * easeOutCubic(flipIn) * (1 - flipOut);
    graphics.rect(0, cy - band / 2, DESIGN_WIDTH, band).fill(LAT_INK);
  }
  const textIn = Math.max(0, (t - 0.18) / 0.3);
  addStaggeredHudText(
    layer,
    scrambleText('FULL COMBO', textIn * 1.3, scrambleTick(t * FULL_COMBO_MS, 40), 7),
    cx,
    cy,
    { ...displayStyle(40, LAT_WHITE, '200'), letterSpacing: 10, anchorX: 0.5, anchorY: 0.5 },
    pool,
    (index) => {
      const local = Math.max(0, textIn - index * 0.07);
      return {
        dy: -26 * (1 - springEase(Math.min(1, local), 2, 0.42)),
        alpha: Math.min(1, local * 3) * (1 - flipOut),
      };
    },
  );
  const label = addHudText(
    layer,
    scrambleText('ALL NOTES CONNECTED', (t - 0.42) / 0.25, scrambleTick(t * FULL_COMBO_MS), 8),
    cx,
    cy + 34,
    { ...monoStyle(LAT_WHITE), letterSpacing: 3, anchorX: 0.5 },
    pool,
  );
  label.alpha = Math.min(1, Math.max(0, (t - 0.45) / 0.1)) * (1 - flipOut);
}

/** The broken combo's digits fall off under gravity, each with its own spin and drift. */
function drawComboBreak(layer: Container, combo: number, t: number, cx: number, pool: ChildPool): void {
  const digits = Array.from(String(combo));
  const cell = 18;
  const left = cx - (digits.length * cell) / 2;
  const seconds = t * (BREAK_MS / 1000);
  digits.forEach((char, index) => {
    const drift = (hash01(combo * 13 + index) - 0.5) * 70;
    const spin = (hash01(combo * 7 + index * 3) - 0.5) * 6;
    const x = left + cell * (index + 0.5) + drift * seconds;
    const y = 256 - 60 * seconds + 0.5 * 900 * seconds * seconds;
    if (y > PLAYFIELD.judgementY + 60) return;
    const node = addHudText(
      layer,
      char,
      x,
      y,
      { ...displayStyle(30, LAT_SIGNAL, '200'), anchorX: 0.5, anchorY: 0.5 },
      pool,
    );
    node.rotation = spin * seconds;
    node.alpha = 1 - t;
  });
}
