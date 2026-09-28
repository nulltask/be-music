import { Graphics, type Container } from 'pixi.js';
import { BGA, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../../gameplay-constants.ts';
import type { SkinlessGameplayChromeRuntime } from '../../gameplay-chrome.ts';
import type { ChildPool } from '../../pixi-utils.ts';
import { addHudText } from '../hud-text.ts';
import { momentProgress, trackMoments } from '../moments.ts';
import { easeOutCubic, stageProgress } from '../phantom-style.ts';
import { burstParticlePosition, burstParticles, hsvToHex, projectPoint, rotateX, rotateY } from './space.ts';
import { SYN_DISPLAY_FONT, SYN_WHITE } from './style.ts';

const MILESTONE_MS = 1300;
const CLEAR_MS = 1100;
const FULL_COMBO_MS = 3400;
const FULL_COMBO_BURST = burstParticles(77, 180);
const JUDGE_Y = PLAYFIELD.judgementY;

/**
 * Synesthesia showpieces, painted on the front layer:
 *
 * - the count-in: READY condenses out of wide-tracked light over a widening filament, then the first beat detonates a
 *   ring of light from the judgement line;
 * - every 100 combo: a shockwave of light rolls out from the playfield and the count glows over the BGA monitor;
 * - the clear line: a light sweep runs the length of the gauge;
 * - a full combo: a bloom, a 3D sphere of sparks bursting from the centre of the screen, prism rings, and FULL COMBO
 *   cycling through the spectrum.
 */
export function drawSynesthesiaMoments(
  key: object,
  layer: Container,
  runtime: SkinlessGameplayChromeRuntime,
  playfieldCenterX: number,
  hue: number,
  pool: ChildPool,
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
  const graphics = pool.acquireGraphics();
  graphics.label = 'synesthesia/moments';
  graphics.blendMode = 'add';

  if (runtime.chartMs !== undefined) {
    drawCountIn(graphics, layer, runtime.chartMs, playfieldCenterX, hue, pool);
  }
  const milestone = momentProgress(moments.milestone?.atMs, nowMs, MILESTONE_MS);
  if (milestone !== undefined && moments.milestone) {
    drawMilestone(graphics, layer, moments.milestone.value, milestone, playfieldCenterX, hue, pool);
  }
  const clear = momentProgress(moments.clearAtMs, nowMs, CLEAR_MS);
  if (clear !== undefined) {
    drawClear(graphics, layer, clear, hue, pool);
  }
  const fullCombo = momentProgress(moments.fullComboAtMs, nowMs, FULL_COMBO_MS);
  if (fullCombo !== undefined) {
    drawFullCombo(graphics, layer, fullCombo, nowMs, hue, pool);
  }
}

function drawCountIn(
  graphics: Graphics,
  layer: Container,
  chartMs: number,
  playfieldCenterX: number,
  hue: number,
  pool: ChildPool,
): void {
  if (chartMs < -2600 || chartMs > 900) return;
  const color = hsvToHex(hue, 0.55, 1);
  const form = easeOutCubic(stageProgress(chartMs, -2600, 1400));
  const fade = 1 - stageProgress(chartMs, -300, 300);
  if (fade > 0) {
    const cy = 214;
    const half = 30 + 260 * form;
    graphics.rect(DESIGN_WIDTH / 2 - half, cy + 22, half * 2, 1).fill({ color: SYN_WHITE, alpha: 0.85 * fade });
    graphics.rect(DESIGN_WIDTH / 2 - half, cy + 19, half * 2, 7).fill({ color, alpha: 0.18 * fade });
    const text = addHudText(
      layer,
      'READY',
      DESIGN_WIDTH / 2,
      cy,
      {
        size: 26,
        fill: SYN_WHITE,
        fontFamily: SYN_DISPLAY_FONT,
        letterSpacing: 10 + 40 * (1 - form),
        anchorX: 0.5,
        anchorY: 0.5,
        dropShadow: { color, alpha: 1, blur: 14, distance: 0 },
      },
      pool,
    );
    text.alpha = form * fade;
  }
  // First beat: a ring of light detonates off the judgement line.
  const start = stageProgress(chartMs, 0, 900);
  if (start > 0 && start < 1) {
    const eased = easeOutCubic(start);
    for (const [delay, strength] of [
      [0, 1],
      [0.12, 0.55],
    ] as const) {
      const t = Math.max(0, (start - delay) / (1 - delay));
      if (t <= 0) continue;
      graphics
        .ellipse(playfieldCenterX, JUDGE_Y, 20 + 560 * easeOutCubic(t), (20 + 560 * easeOutCubic(t)) * 0.3)
        .stroke({ color, width: 1 + 5 * (1 - t), alpha: 0.8 * strength * (1 - t) });
    }
    const text = addHudText(
      layer,
      'START',
      DESIGN_WIDTH / 2,
      214,
      {
        size: 22,
        fill: SYN_WHITE,
        fontFamily: SYN_DISPLAY_FONT,
        letterSpacing: 12 + 20 * eased,
        anchorX: 0.5,
        anchorY: 0.5,
        dropShadow: { color, alpha: 1, blur: 14, distance: 0 },
      },
      pool,
    );
    text.alpha = 1 - start;
  }
}

function drawMilestone(
  graphics: Graphics,
  layer: Container,
  value: number,
  t: number,
  playfieldCenterX: number,
  hue: number,
  pool: ChildPool,
): void {
  const color = hsvToHex(hue + value / 1000, 0.6, 1);
  const wave = easeOutCubic(Math.min(1, t / 0.7));
  const radius = 30 + 700 * wave;
  graphics
    .ellipse(playfieldCenterX, JUDGE_Y, radius, radius * 0.42)
    .stroke({ color, width: 2 + 8 * (1 - wave), alpha: 0.7 * (1 - wave) });
  graphics
    .ellipse(playfieldCenterX, JUDGE_Y, radius * 0.8, radius * 0.34)
    .stroke({ color: SYN_WHITE, width: 1.5, alpha: 0.5 * (1 - wave) });
  const alpha = Math.min(1, t / 0.12) * (1 - Math.max(0, (t - 0.7) / 0.3));
  const cx = BGA.x + BGA.w / 2;
  const cy = BGA.y + BGA.h / 2 - 10;
  const count = addHudText(
    layer,
    String(value),
    cx,
    cy,
    {
      size: 52,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 4,
      anchorX: 0.5,
      anchorY: 0.5,
      dropShadow: { color, alpha: 1, blur: 18, distance: 0 },
    },
    pool,
  );
  count.alpha = alpha;
  count.scale.set(1.25 - 0.25 * easeOutCubic(Math.min(1, t / 0.25)));
  const label = addHudText(
    layer,
    'COMBO',
    cx,
    cy + 44,
    {
      size: 11,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 10,
      anchorX: 0.5,
      anchorY: 0.5,
      dropShadow: { color, alpha: 1, blur: 8, distance: 0 },
    },
    pool,
  );
  label.alpha = alpha;
}

function drawClear(graphics: Graphics, layer: Container, t: number, hue: number, pool: ChildPool): void {
  const color = hsvToHex(hue + 0.35, 0.6, 1);
  const head = GROOVE.x + GROOVE.w * easeOutCubic(Math.min(1, t / 0.5));
  const fade = 1 - Math.max(0, (t - 0.55) / 0.45);
  graphics.rect(GROOVE.x, GROOVE.y - 2, head - GROOVE.x, GROOVE.h + 4).fill({ color, alpha: 0.22 * fade });
  graphics.rect(head - 3, GROOVE.y - 8, 6, GROOVE.h + 16).fill({ color: SYN_WHITE, alpha: 0.9 * fade });
  graphics.circle(head, GROOVE.y + GROOVE.h / 2, 14).fill({ color, alpha: 0.3 * fade });
  const text = addHudText(
    layer,
    'CLEAR',
    GROOVE.x + GROOVE.w - 8,
    GROOVE.y - 38,
    {
      size: 12,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 6,
      anchorX: 1,
      anchorY: 0.5,
      dropShadow: { color, alpha: 1, blur: 10, distance: 0 },
    },
    pool,
  );
  text.alpha = Math.min(1, t / 0.15) * fade;
}

function drawFullCombo(
  graphics: Graphics,
  layer: Container,
  t: number,
  nowMs: number,
  hue: number,
  pool: ChildPool,
): void {
  const cx = DESIGN_WIDTH / 2;
  const cy = DESIGN_HEIGHT / 2 - 10;
  const fadeOut = 1 - Math.max(0, (t - 0.8) / 0.2);
  const bloom = Math.max(0, 1 - t * 5);
  if (bloom > 0) {
    graphics.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: SYN_WHITE, alpha: 0.55 * bloom });
  }
  // A sphere of sparks bursting out of the centre, turning slowly in 3D.
  const burstT = Math.min(1, t / 0.85);
  const spin = nowMs / 2200;
  for (const particle of FULL_COMBO_BURST) {
    const life = burstT / particle.life;
    if (life >= 1) continue;
    const position = burstParticlePosition(particle, life, 360, 60);
    const point = projectPoint(rotateX(rotateY(position, spin), 0.3), cx, cy, 380);
    if (!point.visible) continue;
    const color = hsvToHex(hue + particle.hueShift * 3 + life * 0.5, 0.35 + 0.5 * life, 1);
    const size = (1.5 + 3.5 * particle.size) * point.scale * (1 - life * 0.6);
    graphics.circle(point.x, point.y, size * 3).fill({ color, alpha: 0.12 * (1 - life) * fadeOut });
    graphics.circle(point.x, point.y, size).fill({ color: SYN_WHITE, alpha: (1 - life) * fadeOut });
  }
  // Prism rings expanding from the centre.
  for (let ring = 0; ring < 5; ring += 1) {
    const ringT = (t * 2.2 + ring * 0.18) % 1;
    const radius = 40 + ringT * 420;
    graphics.ellipse(cx, cy, radius, radius * 0.55).stroke({
      color: hsvToHex(hue + ring * 0.12 + t, 0.7, 1),
      width: 2 + 4 * (1 - ringT),
      alpha: 0.5 * (1 - ringT) * fadeOut,
    });
  }
  const form = easeOutCubic(Math.min(1, t / 0.3));
  const color = hsvToHex(hue + nowMs / 1800, 0.55, 1);
  const text = addHudText(
    layer,
    'FULL COMBO',
    cx,
    cy,
    {
      size: 38,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 8 + 30 * (1 - form),
      anchorX: 0.5,
      anchorY: 0.5,
      dropShadow: { color, alpha: 1, blur: 22, distance: 0 },
      maxWidth: DESIGN_WIDTH - 40,
    },
    pool,
  );
  text.alpha = form * fadeOut;
}
