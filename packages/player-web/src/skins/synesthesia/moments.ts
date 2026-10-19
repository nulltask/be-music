import { Graphics, type Container } from 'pixi.js';
import { resolveGrooveRect, resolveMilestoneSpot } from './layout.ts';
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
import { SYN_AMBER, SYN_CYAN, SYN_DISPLAY_FONT, SYN_FLARE, SYN_MAGENTA, SYN_WHITE } from './style.ts';
import {
  easeOutCubic,
  type BeMusicRect,
  effectProfile,
  type MilestoneArea,
  momentProgress,
  trackMoments,
  resolveMilestoneArea,
  type BeMusicGameplayLayout,
  type BeMusicGameplayRuntime,
  STAGE_WIDTH as DESIGN_WIDTH,
  stageProgress,
} from '@be-music/skin-sdk';
import { addHUDText, type ChildPool } from '../pixi-kit/index.ts';

/** Stand-in for a layout without a BGA (a page-wide keyboard field): milestones then play in their area. */
const NO_MONITOR: BeMusicRect = { x: 0, y: 0, w: 0, h: 0 };

const MILESTONE_MS = 1300;
const CLEAR_MS = 1100;
const FULL_COMBO_MS = 2600;
const FULL_COMBO_BURST = burstParticles(77, 640);
const MILESTONE_COLORS = [SYN_AMBER, SYN_CYAN, SYN_MAGENTA] as const;

/**
 * Synesthesia showpieces, painted on the front layer:
 *
 * - the count-in: READY condenses out of wide-tracked light over a widening filament, then START flares out on the
 *   first beat;
 * - every 100 combo: the count glows in the middle of the BGA monitor, caught in a lock-on reticle that snaps shut on it;
 * - the clear line: a light sweep runs the length of the gauge;
 * - a full combo: a warm bloom, a 3D sphere of voxel sparks bursting from the centre of the screen, and FULL COMBO
 *   glowing gold.
 */
export function drawSynesthesiaMoments(
  chromeLayer: Container,
  layer: Container,
  runtime: BeMusicGameplayRuntime,
  playfieldCenterX: number,
  hue: number,
  pool: ChildPool,
  layout: BeMusicGameplayLayout,
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

  // Misses get no effect at all: the playfield stays still and clear so the next notes read.

  const { width, height } = layout.stage;
  const portrait = layout.orientation === 'portrait';
  if (runtime.chartMs !== undefined) {
    // Over the middle of the stage on the landscape stage; over the upper lanes, under the HUD, on a portrait one.
    const { top, judgementY } = layout.playfield;
    const countIn = portrait
      ? { x: playfieldCenterX, y: Math.round(top + (judgementY - top) * 0.35), half: (width - 40) / 2 }
      : { x: DESIGN_WIDTH / 2, y: 214, half: 290 };
    drawCountIn(graphics, layer, runtime.chartMs, countIn, hue, pool);
  }
  const milestone = momentProgress(moments.milestone?.atMs, nowMs, MILESTONE_MS);
  if (milestone !== undefined && moments.milestone) {
    drawMilestone(
      graphics,
      layer,
      moments.milestone.value,
      milestone,
      resolveMilestoneArea(layout.playfield.right, 346, layout.stage.width),
      layout.bga ?? NO_MONITOR,
      resolveMilestoneSpot(layout),
      portrait,
      pool,
    );
  }
  const clear = momentProgress(moments.clearAtMs, nowMs, CLEAR_MS);
  if (clear !== undefined) {
    drawClear(graphics, layer, clear, resolveGrooveRect(layout), portrait, pool);
  }
  const fullCombo = momentProgress(moments.fullComboAtMs, nowMs, FULL_COMBO_MS);
  if (fullCombo !== undefined) {
    drawFullCombo(graphics, layer, fullCombo, nowMs, hue, effects.screenWide, effects.amount, width, height, pool);
  }
}

/**
 * The count-in, centred on `at` (`half` is how far the filament under READY reaches either side once formed): READY
 * condensing out of wide-tracked light, then START flaring out on the first beat.
 */
function drawCountIn(
  graphics: Graphics,
  layer: Container,
  chartMs: number,
  at: { x: number; y: number; half: number },
  hue: number,
  pool: ChildPool,
): void {
  if (chartMs < -2600 || chartMs > 900) return;
  const color = hsvToHex(hue, 0.55, 1);
  const form = easeOutCubic(stageProgress(chartMs, -2600, 1400));
  const fade = 1 - stageProgress(chartMs, -300, 300);
  // The landscape filament grows to 290 either side; narrower stages scale the letter tracking with it.
  const reach = at.half / 290;
  if (fade > 0) {
    const cy = at.y;
    const half = 30 + (at.half - 30) * form;
    graphics.rect(at.x - half, cy + 22, half * 2, 1).fill({ color: SYN_WHITE, alpha: 0.85 * fade });
    graphics.rect(at.x - half, cy + 19, half * 2, 7).fill({ color, alpha: 0.18 * fade });
    const text = addHUDText(
      layer,
      'READY',
      at.x,
      cy,
      {
        size: 26,
        fill: SYN_WHITE,
        fontFamily: SYN_DISPLAY_FONT,
        letterSpacing: (10 + 40 * (1 - form)) * reach,
        anchorX: 0.5,
        anchorY: 0.5,
        dropShadow: { color, alpha: 1, blur: 14, distance: 0 },
      },
      pool,
    );
    text.alpha = form * fade;
  }
  // First beat: START flares out.
  const start = stageProgress(chartMs, 0, 900);
  if (start > 0 && start < 1) {
    const eased = easeOutCubic(start);
    const text = addHUDText(
      layer,
      'START',
      at.x,
      at.y,
      {
        size: 22,
        fill: SYN_WHITE,
        fontFamily: SYN_DISPLAY_FONT,
        letterSpacing: (12 + 20 * eased) * reach,
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
  area: MilestoneArea,
  bga: BeMusicRect,
  spot: { x: number; y: number; w: number } | undefined,
  portrait: boolean,
  pool: ChildPool,
): void {
  // Each hundred takes the next accent light in turn: gold, electric blue, magenta.
  const color = MILESTONE_COLORS[Math.max(0, Math.floor(value / 100) - 1) % MILESTONE_COLORS.length]!;
  // The count plays centred on the monitor (beside the lanes, or above them on a portrait stage, whatever the milestone
  // area — it is below the lanes there), BGA or not. Without a
  // monitor it plays compact in `spot` (see resolveMilestoneSpot), or else in the band below the lanes (double play) —
  // never over the notes.
  const onMonitor = bga.w > 0 && (area.mode !== 'below' || portrait);
  const compact = !onMonitor;
  const cx = onMonitor ? bga.x + bga.w / 2 : spot ? spot.x : area.x + area.w / 2;
  const cy = onMonitor ? bga.y + bga.h / 2 - 10 : spot ? spot.y : area.y + area.h / 2 - 10;
  // A spot narrower than the compact lock-on shrinks the whole cut-in to fit it.
  const fit = !onMonitor && spot ? Math.min(1, spot.w / 120) : 1;
  const alpha = Math.min(1, t / 0.12) * (1 - Math.max(0, (t - 0.7) / 0.3));
  const count = addHUDText(
    layer,
    String(value),
    cx,
    cy,
    {
      size: Math.round((compact ? 30 : 52) * fit),
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 4 * fit,
      maxWidth: compact ? 120 * fit - 8 : undefined,
      anchorX: 0.5,
      anchorY: 0.5,
      dropShadow: { color, alpha: 1, blur: 18, distance: 0 },
    },
    pool,
  );
  count.alpha = alpha;
  count.scale.set(1.25 - 0.25 * easeOutCubic(Math.min(1, t / 0.25)));
  const snap = easeOutCubic(Math.min(1, t / 0.2));
  const lockW = (compact ? 120 : 190) * fit * (1.6 - 0.6 * snap);
  const lockH = (compact ? 74 : 110) * fit * (1.6 - 0.6 * snap);
  drawReticle(graphics, cx - lockW / 2, cy + (compact ? 14 : 22) * fit - lockH / 2, lockW, lockH, color, 0.9 * alpha, {
    arm: 14,
    width: 2,
  });
  const label = addHUDText(
    layer,
    'COMBO',
    cx,
    cy + (compact ? 28 : 44) * fit,
    {
      size: Math.max(9, Math.round(11 * fit)),
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 10 * fit,
      anchorX: 0.5,
      anchorY: 0.5,
      dropShadow: { color, alpha: 1, blur: 8, distance: 0 },
    },
    pool,
  );
  label.alpha = alpha;
}

function drawClear(
  graphics: Graphics,
  layer: Container,
  t: number,
  groove: BeMusicRect,
  portrait: boolean,
  pool: ChildPool,
): void {
  const color = SYN_AMBER;
  const head = groove.x + groove.w * easeOutCubic(Math.min(1, t / 0.5));
  const fade = 1 - Math.max(0, (t - 0.55) / 0.45);
  graphics.rect(groove.x, groove.y - 2, head - groove.x, groove.h + 4).fill({ color, alpha: 0.22 * fade });
  graphics.rect(head - 3, groove.y - 8, 6, groove.h + 16).fill({ color: SYN_WHITE, alpha: 0.9 * fade });
  graphics.circle(head, groove.y + groove.h / 2, 14).fill({ color, alpha: 0.3 * fade });
  const text = addHUDText(
    layer,
    'CLEAR LINE',
    // Landscape: between the playfield frame's bottom edge and the gauge panel, touching neither. Portrait: centred on
    // the top of the lanes, just under the gauge strip.
    portrait ? groove.x + groove.w / 2 : groove.x + groove.w - 8,
    portrait ? groove.y + groove.h + 22 : groove.y - 34,
    {
      size: 12,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 6,
      anchorX: portrait ? 0.5 : 1,
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
  width: number,
  height: number,
  pool: ChildPool,
): void {
  const cx = width / 2;
  const cy = height / 2 - 10;
  const fadeOut = 1 - Math.max(0, (t - 0.8) / 0.2);
  const bloom = screenWide ? Math.max(0, 1 - t * 5) : 0;
  if (bloom > 0) {
    graphics.rect(0, 0, width, height).fill({ color: SYN_FLARE, alpha: 0.55 * bloom });
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
  const form = easeOutCubic(Math.min(1, t / 0.3));
  const color = emberColor(0.6 + 0.3 * Math.sin(nowMs / 260));
  const text = addHUDText(
    layer,
    'FULL COMBO',
    cx,
    cy,
    {
      size: width < height ? 28 : 38,
      fill: SYN_WHITE,
      fontFamily: SYN_DISPLAY_FONT,
      letterSpacing: 8 + 30 * (1 - form),
      anchorX: 0.5,
      anchorY: 0.5,
      dropShadow: { color, alpha: 1, blur: 22, distance: 0 },
      maxWidth: width - 40,
    },
    pool,
  );
  text.alpha = form * fadeOut;
}
