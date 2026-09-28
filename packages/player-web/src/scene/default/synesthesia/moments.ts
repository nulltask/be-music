import { Graphics, type Container } from 'pixi.js';
import { BGA, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../../gameplay-constants.ts';
import type { SkinlessGameplayChromeRuntime } from '../../gameplay-chrome.ts';
import type { ChildPool } from '../../pixi-utils.ts';
import { addHudText } from '../hud-text.ts';
import { effectProfile, impulse, momentProgress, trackMoments } from '../moments.ts';
import { easeOutCubic, hash01, stageProgress } from '../phantom-style.ts';
import { drawReticle } from './draw.ts';
import {
  burstParticlePosition,
  burstParticles,
  emberColor,
  hsvToHex,
  projectPoint,
  rotateX,
  rotateY,
} from './space.ts';
import { SYN_AMBER, SYN_CYAN, SYN_DISPLAY_FONT, SYN_EMBER, SYN_FLARE, SYN_MAGENTA, SYN_WHITE } from './style.ts';

const MILESTONE_MS = 1300;
const CLEAR_MS = 1100;
const FULL_COMBO_MS = 3400;
const FULL_COMBO_BURST = burstParticles(77, 640);
const JUDGE_Y = PLAYFIELD.judgementY;
const MILESTONE_COLORS = [SYN_AMBER, SYN_CYAN, SYN_MAGENTA] as const;
const RING_COLORS = [SYN_AMBER, SYN_EMBER, SYN_CYAN, SYN_FLARE, SYN_MAGENTA] as const;

/**
 * Synesthesia showpieces, painted on the front layer:
 *
 * - the count-in: READY condenses out of wide-tracked light over a widening filament, then the first beat detonates a
 *   ring of light from the judgement line;
 * - every 100 combo: a shockwave of light rolls out from the playfield and the count glows over the BGA monitor,
 *   caught in a lock-on reticle that snaps shut on it;
 * - the clear line: a light sweep runs the length of the gauge;
 * - a full combo: a warm bloom, a 3D sphere of voxel sparks bursting from the centre of the screen, rings of ember /
 *   blue / magenta light, and FULL COMBO glowing gold.
 */
export function drawSynesthesiaMoments(
  chromeLayer: Container,
  layer: Container,
  runtime: SkinlessGameplayChromeRuntime,
  playfieldCenterX: number,
  hue: number,
  pool: ChildPool,
): void {
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
  if (!effects.enabled) return;
  const graphics = pool.acquireGraphics();
  graphics.label = 'synesthesia/moments';
  graphics.blendMode = 'add';

  // Misses glitch the signal: red scanline tears and edge bleed, plus (full effects) a jolt of the whole HUD.
  const miss = runtime.lastJudge === 'POOR' || runtime.lastJudge === 'BAD' ? impulse(runtime.judgeAtMs, nowMs, 240) : 0;
  if (miss > 0) {
    drawGlitch(graphics, miss, nowMs, runtime.hasBga === true);
    if (effects.screenWide) {
      const jolt = Math.sin(nowMs / 9) * 4 * miss;
      chromeLayer.position.set(jolt, 0);
      layer.position.set(jolt, 0);
    }
  }
  const comboBreak = momentProgress(moments.comboBreak?.atMs, nowMs, BREAK_MS);
  if (comboBreak !== undefined && moments.comboBreak) {
    drawComboBreak(graphics, moments.comboBreak.combo, comboBreak, playfieldCenterX);
  }

  if (runtime.chartMs !== undefined) {
    drawCountIn(graphics, layer, runtime.chartMs, playfieldCenterX, hue, pool);
  }
  const milestone = momentProgress(moments.milestone?.atMs, nowMs, MILESTONE_MS);
  if (milestone !== undefined && moments.milestone) {
    drawMilestone(
      graphics,
      layer,
      moments.milestone.value,
      milestone,
      playfieldCenterX,
      hue,
      runtime.hasBga === true,
      pool,
    );
  }
  const clear = momentProgress(moments.clearAtMs, nowMs, CLEAR_MS);
  if (clear !== undefined) {
    drawClear(graphics, layer, clear, pool);
  }
  const fullCombo = momentProgress(moments.fullComboAtMs, nowMs, FULL_COMBO_MS);
  if (fullCombo !== undefined) {
    drawFullCombo(graphics, layer, fullCombo, nowMs, hue, effects.screenWide, effects.amount, pool);
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
  hasBga: boolean,
  pool: ChildPool,
): void {
  // Each hundred takes the next Rez light in turn: gold, electric blue, magenta.
  const color = MILESTONE_COLORS[Math.max(0, Math.floor(value / 100) - 1) % MILESTONE_COLORS.length]!;
  const wave = easeOutCubic(Math.min(1, t / 0.7));
  const radius = 30 + 700 * wave;
  graphics
    .ellipse(playfieldCenterX, JUDGE_Y, radius, radius * 0.42)
    .stroke({ color, width: 2 + 8 * (1 - wave), alpha: 0.7 * (1 - wave) });
  graphics
    .ellipse(playfieldCenterX, JUDGE_Y, radius * 0.8, radius * 0.34)
    .stroke({ color: SYN_WHITE, width: 1.5, alpha: 0.5 * (1 - wave) });
  const alpha = Math.min(1, t / 0.12) * (1 - Math.max(0, (t - 0.7) / 0.3));
  // Over a live BGA the count sits small on the monitor's top edge instead of the middle of the video.
  const cx = BGA.x + BGA.w / 2;
  const cy = hasBga ? BGA.y + 30 : BGA.y + BGA.h / 2 - 10;
  const count = addHudText(
    layer,
    String(value),
    cx,
    cy,
    {
      size: hasBga ? 30 : 52,
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
  const snap = easeOutCubic(Math.min(1, t / 0.2));
  const lockW = (hasBga ? 120 : 190) * (1.6 - 0.6 * snap);
  const lockH = (hasBga ? 74 : 110) * (1.6 - 0.6 * snap);
  drawReticle(graphics, cx - lockW / 2, cy + (hasBga ? 14 : 22) - lockH / 2, lockW, lockH, color, 0.9 * alpha, {
    arm: 14,
    width: 2,
  });
  const label = addHudText(
    layer,
    'COMBO',
    cx,
    cy + (hasBga ? 28 : 44),
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

function drawClear(graphics: Graphics, layer: Container, t: number, pool: ChildPool): void {
  const color = SYN_AMBER;
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
  screenWide: boolean,
  amount: number,
  pool: ChildPool,
): void {
  const cx = DESIGN_WIDTH / 2;
  const cy = DESIGN_HEIGHT / 2 - 10;
  const fadeOut = 1 - Math.max(0, (t - 0.8) / 0.2);
  const bloom = screenWide ? Math.max(0, 1 - t * 5) : 0;
  if (bloom > 0) {
    graphics.rect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT).fill({ color: SYN_FLARE, alpha: 0.55 * bloom });
  }
  // A sphere of sparks bursting out of the centre, turning slowly in 3D.
  const burstT = Math.min(1, t / 0.85);
  const spin = nowMs / 2200;
  const sparkCount = Math.round(FULL_COMBO_BURST.length * amount);
  for (const particle of FULL_COMBO_BURST.slice(0, sparkCount)) {
    const life = burstT / particle.life;
    if (life >= 1) continue;
    const position = burstParticlePosition(particle, life, 360, 60);
    const point = projectPoint(rotateX(rotateY(position, spin), 0.3), cx, cy, 380);
    if (!point.visible) continue;
    // Mostly ember cooling from white-hot, with a scatter of blue and magenta voxels.
    const color =
      particle.hueShift > 0.055 ? SYN_CYAN : particle.hueShift < -0.065 ? SYN_MAGENTA : emberColor(1 - life * 0.7);
    const size = (0.5 + 1.1 * particle.size) * point.scale * (1 - life * 0.5);
    graphics.circle(point.x, point.y, size * 3).fill({ color, alpha: 0.06 * (1 - life) * fadeOut });
    graphics
      .rect(point.x - size, point.y - size, size * 2, size * 2)
      .fill({ color: life < 0.2 ? SYN_WHITE : color, alpha: (1 - life) * fadeOut });
  }
  // Prism rings expanding from the centre.
  for (let ring = 0; ring < 5; ring += 1) {
    const ringT = (t * 2.2 + ring * 0.18) % 1;
    const radius = 40 + ringT * 420;
    graphics.ellipse(cx, cy, radius, radius * 0.55).stroke({
      color: RING_COLORS[ring % RING_COLORS.length]!,
      width: 2 + 4 * (1 - ringT),
      alpha: 0.5 * (1 - ringT) * fadeOut,
    });
  }
  const form = easeOutCubic(Math.min(1, t / 0.3));
  const color = emberColor(0.6 + 0.3 * Math.sin(nowMs / 260));
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

const BREAK_MS = 800;

/** Red scanline tears across the screen and a bleed at the edges; tears skip a live BGA rect. */
function drawGlitch(graphics: Graphics, strength: number, nowMs: number, hasBga: boolean): void {
  const frame = Math.floor(nowMs / 40);
  for (let tear = 0; tear < 7; tear += 1) {
    const y = hash01(frame * 7 + tear) * DESIGN_HEIGHT;
    const h = 2 + hash01(frame * 13 + tear) * 6;
    const offset = (hash01(frame * 3 + tear) - 0.5) * 60;
    if (hasBga && y > BGA.y - 4 && y < BGA.y + BGA.h + 4) {
      graphics.rect(offset, y, BGA.x - 8, h).fill({ color: 0xff3a6a, alpha: 0.35 * strength });
      graphics.rect(BGA.x + BGA.w + 8, y, DESIGN_WIDTH, h).fill({ color: 0xff3a6a, alpha: 0.35 * strength });
    } else {
      graphics.rect(offset, y, DESIGN_WIDTH, h).fill({ color: 0xff3a6a, alpha: 0.35 * strength });
    }
  }
  for (let band = 0; band < 3; band += 1) {
    const w = 10;
    const alpha = 0.18 * strength * (1 - band / 3);
    graphics.rect(band * w, 0, w, DESIGN_HEIGHT).fill({ color: 0xff3a6a, alpha });
    graphics.rect(DESIGN_WIDTH - (band + 1) * w, 0, w, DESIGN_HEIGHT).fill({ color: 0xff3a6a, alpha });
  }
}

/** A broken combo disperses into red sparks that drift up and fade from the combo readout. */
function drawComboBreak(graphics: Graphics, combo: number, t: number, cx: number): void {
  const cy = 264;
  for (let spark = 0; spark < 36; spark += 1) {
    const angle = hash01(spark + combo * 3) * Math.PI * 2;
    const speed = 30 + hash01(spark * 5 + 1) * 90;
    const eased = easeOutCubic(t);
    const x = cx + Math.cos(angle) * speed * eased;
    const y = cy + Math.sin(angle) * speed * eased * 0.6 - 40 * eased;
    const size = 1 + hash01(spark + 11) * 2;
    graphics.circle(x, y, size * 3).fill({ color: 0xff3a6a, alpha: 0.12 * (1 - t) });
    graphics.circle(x, y, size).fill({ color: 0xffd0dc, alpha: 1 - t });
  }
}
