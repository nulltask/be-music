import type { Container, Graphics } from 'pixi.js';
import { BGA, DESIGN_HEIGHT, DESIGN_WIDTH, GROOVE, PLAYFIELD } from '../../gameplay-constants.ts';
import type { SkinlessGameplayChromeRenderContext, SkinlessGameplayChromeRuntime } from '../../gameplay-chrome.ts';
import { resolveSkinlessLaneLayout } from '../../gameplay-lanes.ts';
import type { ChildPool } from '../../pixi-utils.ts';
import { addHudNumber, addHudText } from '../hud-text.ts';
import {
  comboTier,
  effectProfile,
  momentProgress,
  resolveMilestoneArea,
  trackMoments,
  type MomentState,
} from '../moments.ts';
import {
  addOdometer,
  addStaggeredHudText,
  drawNeedleField,
  drawPaperGrid,
  drawRulerTicks,
  displayStyle,
  monoStyle,
  type Rect,
} from './draw.ts';
import { scrambleText, scrambleTick, springEase, tileFlipPhase, type NeedleFieldInput } from './field.ts';
import { drawLatticeMoments, FULL_COMBO_MS, MILESTONE_MS } from './moments.ts';
import { flashingGreatColor, isFlashingGreat, judgeDisplayWord } from '../judge-word.ts';
import { createChain, kickChain, stepChain, type Chain } from './physics.ts';
import { audioDrive, bandLevel, type AudioDrive } from '../audio-drive.ts';
import {
  LAT_ACCENT,
  LAT_GRAPHITE,
  LAT_INK,
  LAT_PAPER,
  LAT_RULE,
  LAT_SIGNAL,
  LAT_TEXT_FONT,
  LAT_WHITE,
} from './style.ts';

type Runtime = SkinlessGameplayChromeRuntime;

/**
 * HUD text scramble: during the count-in every label and the song title decode in, staggered by `delayMs`; once the
 * chart runs (or with no count-in clock) text shows settled.
 */
function hudScramble(runtime: Runtime): (value: string, delayMs: number, seed: number) => string {
  const chartMs = runtime.chartMs;
  const tick = scrambleTick(runtime.nowMs ?? 0);
  if (chartMs === undefined || runtime.effects === 'off') return (value) => value;
  return (value, delayMs, seed) =>
    scrambleText(value, Math.max(0, Math.min(1, (chartMs + 2700 - delayMs) / 520)), tick, seed);
}

const SCORE_PANEL = { x: 384, y: 352, w: 234, h: 108 } as const;
const SONG_PLATE = { x: 16, y: 420, w: 344, h: 46 } as const;
const HEADER_H = 30;

/**
 * Lattice gameplay HUD — precise interaction design on paper: graph-paper rules, a field of needles that turn like
 * iron filings (a beat wave sweeping through, ripples from every key press, pulled toward a milestone, swirling on a
 * full combo), print crop marks and ruler ticks on the monitor, and every figure set as type on a strict grid. The
 * combo counter is an odometer; judgements drop in letter by letter on a spring.
 */
export function renderLatticeChrome({
  layer,
  overlayLayer,
  layerPool,
  overlayLayerPool,
  runtime,
}: SkinlessGameplayChromeRenderContext): void {
  const nowMs = runtime.nowMs ?? 0;
  const seconds = nowMs / 1000;
  const beatPhase = runtime.beatPhase ?? 0;
  const hasBga = runtime.hasBga === true;
  const { left: playfieldLeft, right: playfieldRight } = resolveSkinlessLaneLayout(
    runtime.laneChannels,
    runtime.laneCount,
    runtime.playVariant,
  );
  const effects = effectProfile(runtime.effects);
  const tier = effects.enabled ? Math.min(comboTier(runtime.combo ?? 0), effects.screenWide ? 4 : 2) : 0;
  // The paper listens: needles flow harder with loudness and ripple out of the monitor on every onset, the pendulums
  // are struck by transients, the idle monitor becomes a tile equalizer, and the tally carries a live spectrum + dB.
  const drive = audioDrive(runtime.audio, runtime.effects);
  const moments = trackMoments(layer, {
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

  const paper = layerPool.acquireGraphics();
  paper.label = 'lattice-gameplay/paper';
  paper.blendMode = 'normal';
  fillAroundBga(paper, 0, 0, DESIGN_WIDTH, DESIGN_HEIGHT, LAT_PAPER, hasBga);
  drawPaperGrid(paper, { x: 0, y: 0, w: DESIGN_WIDTH, h: DESIGN_HEIGHT }, 0.45, hasBga ? BGA : undefined);

  const field = layerPool.acquireGraphics();
  field.label = 'lattice-gameplay/field';
  field.blendMode = 'normal';
  // The field fills the paper around the type: the playfield and every HUD block stay clean.
  const clean: Rect[] = [
    { x: playfieldLeft - 20, y: 0, w: playfieldRight - playfieldLeft + 26, h: 346 },
    { x: BGA.x - 13, y: BGA.y - 13, w: BGA.w + 26, h: BGA.h + 26 },
    { x: GROOVE.x - 18, y: GROOVE.y - 30, w: GROOVE.w + 36, h: 58 },
    { x: SONG_PLATE.x - 4, y: SONG_PLATE.y - 6, w: SONG_PLATE.w + 8, h: SONG_PLATE.h + 12 },
    { x: SCORE_PANEL.x - 8, y: SCORE_PANEL.y - 6, w: SCORE_PANEL.w + 16, h: SCORE_PANEL.h + 14 },
    { x: BGA.x + BGA.w + 8, y: BGA.y - 12, w: DESIGN_WIDTH, h: 252 },
  ];
  const pendulums = playfieldRight + 40 <= BGA.x;
  if (pendulums) clean.push({ x: playfieldRight + 6, y: HEADER_H, w: BGA.x - playfieldRight - 18, h: 290 });
  drawNeedleField(
    field,
    { x: 0, y: HEADER_H, w: DESIGN_WIDTH, h: DESIGN_HEIGHT - HEADER_H },
    resolveFieldInput(layer, runtime, moments, tier, effects.amount, playfieldLeft, playfieldRight, drive),
    {
      alpha: 0.55,
      skip: (x, y) => clean.some((rect) => inside(rect, x, y, 0)),
    },
  );

  const panels = layerPool.acquireGraphics();
  panels.label = 'lattice-gameplay/panels';
  panels.blendMode = 'normal';
  drawPlayfieldFrame(panels, playfieldLeft, playfieldRight, runtime.progressRatio);
  if (pendulums) {
    drawPendulums(panels, layer, runtime, (playfieldRight + BGA.x - 5) / 2, effects.amount, drive, layerPool);
  }
  if (playfieldRight + 14 <= BGA.x) {
    drawBgaFrame(panels, layer, hasBga, seconds, beatPhase, effects.amount, drive, layerPool);
  }
  drawGauge(panels, layer, runtime, moments, layerPool);
  drawSongPlate(panels, layer, runtime, layerPool);
  drawScorePanel(panels, layer, runtime, layerPool);
  const tallyX = BGA.x + BGA.w + 14;
  if (playfieldRight + 14 <= tallyX) {
    drawJudgeTally(panels, layer, runtime, tallyX, drive, layerPool);
  }

  const front = overlayLayerPool.acquireGraphics();
  front.label = 'lattice-gameplay/header';
  front.blendMode = 'normal';
  // During a screen-wide full combo the tiles cover the page; the header and judgement type would print through them.
  const fullCombo = momentProgress(moments.fullComboAtMs, nowMs, FULL_COMBO_MS);
  const covered = effects.screenWide && fullCombo !== undefined && fullCombo > 0.25 && fullCombo < 0.8;
  if (!covered) {
    drawHeader(front, overlayLayer, runtime, beatPhase, overlayLayerPool);
    drawJudgements(overlayLayer, runtime, playfieldRight, effects.amount, overlayLayerPool);
  }
  drawLatticeMoments(
    overlayLayer,
    runtime,
    moments,
    (playfieldLeft + playfieldRight) / 2,
    overlayLayerPool,
    playfieldRight,
  );
}

const IMPULSE_HISTORY = new WeakMap<object, number[]>();
const ONSET_HISTORY = new WeakMap<object, number[]>();

interface PendulumState {
  chains: Chain[];
  lastMs: number;
  lastImpulseAt: number | undefined;
  lastBeat: number;
  beats: number;
  lastOnsetAt: number | undefined;
}
const PENDULUMS = new WeakMap<object, PendulumState>();
/** Two fine bead chains of different lengths (so they drift out of phase), hanging from the header rule. */
const PENDULUM_SPECS = [
  { dx: -7, beads: 17, spacing: 8 },
  { dx: 7, beads: 23, spacing: 8 },
] as const;

/**
 * Physics: two Verlet bead chains hang in the gap between the playfield and the monitor. Every key press strikes their
 * bobs (white keys right, black keys and scratch left), the beat nudges them alternately, and they swing, whip and
 * settle under gravity — with a live angle readout ticking above each.
 */
function drawPendulums(
  graphics: Graphics,
  layer: Container,
  runtime: Runtime,
  centerX: number,
  amount: number,
  drive: AudioDrive,
  pool: ChildPool,
): void {
  const nowMs = runtime.nowMs ?? 0;
  const anchorY = HEADER_H + 14;
  let state = PENDULUMS.get(layer);
  if (!state || nowMs < state.lastMs) {
    state = {
      chains: PENDULUM_SPECS.map((spec) => createChain(centerX + spec.dx, anchorY, spec.beads, spec.spacing)),
      lastMs: nowMs,
      lastImpulseAt: runtime.impulseAtMs,
      lastBeat: runtime.beatPhase ?? 0,
      beats: 0,
      lastOnsetAt: drive.onsetAtMs,
    };
    PENDULUMS.set(layer, state);
  }
  if (amount > 0) {
    if (runtime.impulseAtMs !== undefined && runtime.impulseAtMs !== state.lastImpulseAt) {
      state.lastImpulseAt = runtime.impulseAtMs;
      const direction = runtime.impulseKind === 'white' ? 1 : -1;
      state.chains.forEach((chain, index) => {
        kickChain(chain, chain.count - 1, direction * (80 + 30 * index) * amount, -30 * amount);
      });
    }
    const beatPhase = runtime.beatPhase ?? 0;
    if (beatPhase < state.lastBeat) {
      state.beats += 1;
      const direction = state.beats % 2 === 0 ? 1 : -1;
      state.chains.forEach((chain) => kickChain(chain, Math.floor(chain.count / 2), direction * 40 * amount, 0));
    }
    state.lastBeat = beatPhase;
    // Transients in the mix strike the strings too, harder on the bass.
    if (drive.onsetAtMs !== undefined && drive.onsetAtMs !== state.lastOnsetAt) {
      state.lastOnsetAt = drive.onsetAtMs;
      const direction = state.beats % 2 === 0 ? -1 : 1;
      state.chains.forEach((chain, index) => {
        kickChain(chain, chain.count - 1 - index * 3, direction * (40 + 60 * drive.bass) * amount, 0);
      });
    }
    const dt = (nowMs - state.lastMs) / 1000;
    state.chains.forEach((chain, index) => {
      stepChain(chain, dt, { anchorX: centerX + PENDULUM_SPECS[index]!.dx, anchorY, gravity: 1400, damping: 0.992 });
    });
  }
  state.lastMs = nowMs;
  // The pivot bar.
  graphics.rect(centerX - 14, anchorY - 1, 28, 1).fill(LAT_INK);
  graphics.moveTo(centerX - 14, anchorY - 1).lineTo(centerX - 14, anchorY - 5);
  graphics.moveTo(centerX + 14, anchorY - 1).lineTo(centerX + 14, anchorY - 5);
  graphics.stroke({ color: LAT_INK, width: 1 });
  state.chains.forEach((chain, index) => {
    for (let bead = 1; bead < chain.count; bead += 1) {
      graphics.moveTo(chain.x[bead - 1]!, chain.y[bead - 1]!).lineTo(chain.x[bead]!, chain.y[bead]!);
    }
    graphics.stroke({ color: LAT_INK, width: 0.75, alpha: 0.7 });
    for (let bead = 1; bead < chain.count - 1; bead += 1) {
      graphics.rect(chain.x[bead]! - 0.75, chain.y[bead]! - 0.75, 1.5, 1.5).fill(LAT_INK);
    }
    const end = chain.count - 1;
    const bobX = chain.x[end]!;
    const bobY = chain.y[end]!;
    graphics.rect(bobX - 3, bobY - 3, 6, 6).fill(index === 0 ? LAT_ACCENT : LAT_INK);
    // Live angle readout of the whole string, from pivot to bob.
    const angle = (Math.atan2(bobX - chain.x[0]!, bobY - chain.y[0]!) * 180) / Math.PI;
    addHudNumber(
      layer,
      `${angle >= 0 ? '+' : '-'}${Math.abs(angle).toFixed(1)}`,
      bobX,
      bobY + 6,
      { ...monoStyle(index === 0 ? LAT_ACCENT : LAT_GRAPHITE), size: 9, anchorX: 0.5 },
      pool,
    );
  });
}

/**
 * Field forces for this frame: ambient flow and the beat sweep (stronger in the zone), ripples from the last few key
 * presses rolling out of the judgement line, a pull toward the monitor during a milestone, and a swirl on a full combo.
 * A miss adds nothing, so the field stays calm around the notes.
 */
function resolveFieldInput(
  key: object,
  runtime: Runtime,
  moments: MomentState,
  tier: number,
  amount: number,
  playfieldLeft: number,
  playfieldRight: number,
  drive: AudioDrive,
): NeedleFieldInput {
  const nowMs = runtime.nowMs ?? 0;
  let onsets = ONSET_HISTORY.get(key);
  if (!onsets) {
    onsets = [];
    ONSET_HISTORY.set(key, onsets);
  }
  if (drive.onsetAtMs !== undefined && onsets[onsets.length - 1] !== drive.onsetAtMs) {
    onsets.push(drive.onsetAtMs);
    if (onsets.length > 4) onsets.shift();
  }
  let history = IMPULSE_HISTORY.get(key);
  if (!history) {
    history = [];
    IMPULSE_HISTORY.set(key, history);
  }
  if (runtime.impulseAtMs !== undefined && history[history.length - 1] !== runtime.impulseAtMs) {
    history.push(runtime.impulseAtMs);
    if (history.length > 6) history.shift();
  }
  const originX = (playfieldLeft + playfieldRight) / 2;
  const ripples =
    amount > 0
      ? [
          ...history.map((atMs) => ({ x: originX, y: PLAYFIELD.judgementY, ageMs: nowMs - atMs, strength: amount })),
          // Onsets ring out of the monitor.
          ...onsets.map((atMs) => ({
            x: BGA.x + BGA.w / 2,
            y: BGA.y + BGA.h / 2,
            ageMs: nowMs - atMs,
            strength: 0.8 * amount,
          })),
        ]
      : [];
  const milestone = momentProgress(moments.milestone?.atMs, nowMs, MILESTONE_MS);
  const fullCombo = momentProgress(moments.fullComboAtMs, nowMs, FULL_COMBO_MS);
  const envelope = (t: number | undefined) => (t === undefined ? 0 : Math.sin(Math.min(1, t) * Math.PI));
  return {
    seconds: (nowMs / 1000) * (amount > 0 ? 1 : 0),
    beatPhase: runtime.beatPhase ?? 0,
    flow: (0.35 + 0.12 * tier) * amount + 0.35 * drive.level,
    beatWave: (0.45 + 0.12 * tier) * amount + 0.4 * drive.bass,
    ripples,
    attractor: (() => {
      // Needles swing toward wherever the milestone plays (beside or below the lanes).
      const area = resolveMilestoneArea(playfieldRight);
      const x = area.mode === 'below' ? area.x + area.w / 2 : BGA.x + BGA.w / 2;
      const y = area.mode === 'below' ? area.y + area.h / 2 : BGA.y + BGA.h / 2;
      return { x, y, strength: envelope(milestone) * amount };
    })(),
    swirl: { x: DESIGN_WIDTH / 2, y: DESIGN_HEIGHT / 2, strength: envelope(fullCombo) * amount },
    jitter: 0,
    tremble: 0.07 * amount,
  };
}

function inside(rect: Rect, x: number, y: number, margin: number): boolean {
  return x > rect.x - margin && x < rect.x + rect.w + margin && y > rect.y - margin && y < rect.y + rect.h + margin;
}

function fillAroundBga(
  graphics: Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  hasBga: boolean,
): void {
  const right = x + w;
  const bottom = y + h;
  if (!hasBga) {
    graphics.rect(x, y, w, h).fill(color);
    return;
  }
  const holeRight = BGA.x + BGA.w;
  const holeBottom = BGA.y + BGA.h;
  graphics.rect(x, y, w, BGA.y - y).fill(color);
  graphics.rect(x, BGA.y, BGA.x - x, BGA.h).fill(color);
  graphics.rect(holeRight, BGA.y, right - holeRight, BGA.h).fill(color);
  graphics.rect(x, holeBottom, w, bottom - holeBottom).fill(color);
}

/** Print crop mark: an L of hairlines just outside a corner. */
function cropMark(graphics: Graphics, x: number, y: number, dx: 1 | -1, dy: 1 | -1): void {
  graphics
    .moveTo(x - dx * 4, y)
    .lineTo(x - dx * 14, y)
    .moveTo(x, y - dy * 4)
    .lineTo(x, y - dy * 14);
}

function drawPlayfieldFrame(graphics: Graphics, left: number, right: number, progressRatio: number | undefined): void {
  graphics.rect(left - 1, HEADER_H, right - left + 2, 340 - HEADER_H).stroke({ color: LAT_INK, width: 1, alpha: 0.9 });
  cropMark(graphics, left - 1, 340, 1, -1);
  cropMark(graphics, right + 1, 340, -1, -1);
  graphics.stroke({ color: LAT_INK, width: 1 });
  // Progress: a ruler down the left edge with an accent cursor.
  const ratio =
    progressRatio !== undefined && Number.isFinite(progressRatio) ? Math.max(0, Math.min(1, progressRatio)) : 0;
  const trackTop = HEADER_H + 6;
  const trackH = 340 - trackTop - 6;
  for (let step = 0; step <= 20; step += 1) {
    const y = trackTop + (trackH * step) / 20;
    graphics.moveTo(left - 10, y).lineTo(left - (step % 5 === 0 ? 16 : 13), y);
  }
  graphics.stroke({ color: LAT_INK, width: 1, alpha: 0.45 });
  const cursorY = trackTop + trackH * (1 - ratio);
  graphics.rect(left - 17, cursorY - 1, 9, 2).fill(LAT_ACCENT);
}

/**
 * Monitor: a hairline frame with ruler ticks along its top and bottom edges and crop marks at the corners. With no BGA
 * the screen idles on an 8 × 8 grid of tiles flipping in a diagonal wave on every beat, plus a running clock.
 */
function drawBgaFrame(
  graphics: Graphics,
  layer: Container,
  hasBga: boolean,
  seconds: number,
  beatPhase: number,
  amount: number,
  drive: AudioDrive,
  pool: ChildPool,
): void {
  const margin = 5;
  const x = BGA.x - margin;
  const y = BGA.y - margin;
  const w = BGA.w + margin * 2;
  const h = BGA.h + margin * 2;
  graphics.rect(x, y, w, h).stroke({ color: LAT_INK, width: 1 });
  cropMark(graphics, x, y, 1, 1);
  cropMark(graphics, x + w, y, -1, 1);
  cropMark(graphics, x, y + h, 1, -1);
  cropMark(graphics, x + w, y + h, -1, -1);
  graphics.stroke({ color: LAT_INK, width: 1 });
  drawRulerTicks(graphics, x, y, w, 1, LAT_INK, 0.55);
  drawRulerTicks(graphics, x, y + h, w, -1, LAT_INK, 0.55);
  if (hasBga) return;

  graphics.rect(BGA.x, BGA.y, BGA.w, BGA.h).fill(LAT_WHITE);
  const columns = 16;
  const rows = 14;
  const pitch = BGA.w / columns;
  const tile = pitch - 4;
  const top = BGA.y + (BGA.h - 22 - rows * pitch) / 2;
  const wave = amount > 0 ? beatPhase * 1.6 : 1;
  // While music plays the tiles become an equalizer: each column fills from the bottom to its band's level, the top
  // tile squashed by the fraction and printed in cobalt. In silence they fall back to the beat's flip wave.
  if (drive.level > 0.02) {
    for (let column = 0; column < columns; column += 1) {
      const filled = bandLevel(drive.bands, column, columns) * rows;
      for (let row = 0; row < rows; row += 1) {
        const fromBottom = rows - 1 - row;
        const fill = Math.max(0, Math.min(1, filled - fromBottom));
        const cx = BGA.x + pitch * (column + 0.5);
        const cy = top + pitch * (row + 0.5);
        if (fill <= 0) {
          graphics.rect(cx - 1, cy - 1, 2, 2).fill({ color: LAT_RULE, alpha: 1 });
          continue;
        }
        const th = Math.max(1, tile * fill);
        const peak = fill < 1 || fromBottom === Math.ceil(filled) - 1;
        graphics.rect(cx - tile / 2, cy + tile / 2 - th, tile, th).fill(peak ? LAT_ACCENT : LAT_INK);
      }
    }
  }
  for (let row = 0; row < rows && drive.level <= 0.02; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const phase = tileFlipPhase(column, row, columns, rows, wave, 0.6);
      // Each tile flips about its horizontal axis: its height follows |cos|, its face changes at the halfway point.
      const flip = springEase(phase, 1.6, 0.55);
      const squash = Math.abs(Math.cos(flip * Math.PI));
      const face = flip < 0.5 ? LAT_INK : (column + row) % 5 === 0 ? LAT_ACCENT : LAT_INK;
      const hollow = flip >= 0.5 && (column * 3 + row) % 4 === 0;
      const cx = BGA.x + pitch * (column + 0.5);
      const cy = top + pitch * (row + 0.5);
      const th = Math.max(0.8, tile * squash);
      if (hollow) {
        graphics.rect(cx - tile / 2 + 0.5, cy - th / 2, tile - 1, th).stroke({ color: LAT_INK, width: 1 });
      } else {
        graphics.rect(cx - tile / 2, cy - th / 2, tile, th).fill({ color: face, alpha: 0.9 });
      }
    }
  }
  graphics.rect(BGA.x, BGA.y + BGA.h - 22, BGA.w, 1).fill({ color: LAT_RULE, alpha: 1 });
  // STANDBY re-decodes every few seconds while the monitor idles.
  const idle = amount > 0 ? (seconds % 5) / 0.7 : 1;
  addHudText(
    layer,
    scrambleText('STANDBY', idle, scrambleTick(seconds * 1000), 60),
    BGA.x + 8,
    BGA.y + BGA.h - 16,
    monoStyle(LAT_INK),
    pool,
  );
  const minutes = Math.floor(seconds / 60);
  const secs = seconds - minutes * 60;
  addHudNumber(
    layer,
    `${String(minutes).padStart(2, '0')}:${secs.toFixed(2).padStart(5, '0')}`,
    BGA.x + BGA.w - 8,
    BGA.y + BGA.h - 17,
    { ...monoStyle(LAT_INK), anchorX: 1 },
    pool,
  );
}

/** Header: mode and tempo set as type, a beat clock whose hand ticks round once per beat, and the ruleset chip. */
function drawHeader(graphics: Graphics, layer: Container, runtime: Runtime, beatPhase: number, pool: ChildPool): void {
  graphics.rect(0, 0, DESIGN_WIDTH, HEADER_H).fill({ color: LAT_PAPER, alpha: 0.96 });
  graphics.rect(0, HEADER_H - 1, DESIGN_WIDTH, 1).fill(LAT_INK);
  const autoplay = runtime.autoplay === true;
  // Beat clock.
  const cx = 20;
  const cy = 15;
  graphics.circle(cx, cy, 8).stroke({ color: LAT_INK, width: 1 });
  for (let tick = 0; tick < 12; tick += 1) {
    const angle = (tick / 12) * Math.PI * 2;
    const inner = tick % 3 === 0 ? 5 : 6.5;
    graphics.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    graphics.lineTo(cx + Math.cos(angle) * 8, cy + Math.sin(angle) * 8);
  }
  graphics.stroke({ color: LAT_INK, width: 1, alpha: 0.6 });
  const hand = -Math.PI / 2 + springEase(Math.min(1, beatPhase * 3), 2.4, 0.5) * Math.PI * 2;
  graphics
    .moveTo(cx, cy)
    .lineTo(cx + Math.cos(hand) * 7, cy + Math.sin(hand) * 7)
    .stroke({ color: autoplay ? LAT_ACCENT : LAT_SIGNAL, width: 1.5 });
  graphics.circle(cx, cy, 1.5).fill(LAT_INK);

  const sc = hudScramble(runtime);
  addHudText(
    layer,
    sc(autoplay ? 'AUTO PLAY' : 'PLAY', 0, 1),
    36,
    10,
    { ...monoStyle(LAT_INK), letterSpacing: 1.5 },
    pool,
  );
  addHudText(layer, sc('BPM', 60, 2), 128, 11, monoStyle(), pool);
  addHudNumber(layer, formatBpm(runtime.bpm), 152, 7, displayStyle(15, LAT_INK, '300'), pool);
  addHudText(layer, sc('SPEED', 120, 3), 214, 11, monoStyle(), pool);
  addHudNumber(layer, `×${formatHiSpeed(runtime.hiSpeed)}`, 250, 7, displayStyle(15, LAT_INK, '300'), pool);
  // Nervous readouts: chart time to the millisecond, the beat fraction, and a 16-step beat meter.
  const chartMs = runtime.chartMs;
  addHudText(layer, sc('T', 200, 9), 326, 11, monoStyle(), pool);
  addHudNumber(
    layer,
    chartMs !== undefined && Number.isFinite(chartMs) ? formatChartTime(chartMs) : '+000.000',
    338,
    11,
    { ...monoStyle(LAT_INK) },
    pool,
  );
  addHudText(layer, sc('BEAT', 240, 10), 416, 11, monoStyle(), pool);
  addHudNumber(layer, beatPhase.toFixed(3).slice(1), 444, 11, { ...monoStyle(LAT_INK) }, pool);
  const lit = Math.floor(beatPhase * 16);
  for (let step = 0; step < 16; step += 1) {
    const x = 486 + step * 4;
    if (step <= lit) graphics.rect(x, 11, 2, 8).fill(step === lit ? LAT_ACCENT : LAT_INK);
    else graphics.rect(x, 17, 2, 2).fill({ color: LAT_RULE, alpha: 1 });
  }
  addHudText(
    layer,
    sc(formatRuleset(runtime.rulesetLabel), 180, 4),
    DESIGN_WIDTH - 12,
    11,
    { ...monoStyle(LAT_INK), letterSpacing: 1.5, anchorX: 1 },
    pool,
  );
}

/** Gauge as a ruler: 50 ticks, ink below the clear line and cobalt past it, a triangle marking the line. */
function drawGauge(
  graphics: Graphics,
  layer: Container,
  runtime: Runtime,
  moments: MomentState,
  pool: ChildPool,
): void {
  const gauge = clampPercent(runtime.gauge ?? 0);
  const clear = clampPercent(runtime.clearThreshold ?? 80);
  const survival = runtime.gaugeSurvival === true || clear <= 0;
  const nowMs = runtime.nowMs ?? 0;
  const sc = hudScramble(runtime);
  graphics.rect(GROOVE.x - 12, GROOVE.y - 24, GROOVE.w + 24, 1).fill(LAT_INK);
  addHudText(
    layer,
    sc(`${(runtime.gaugeLabel ?? 'GROOVE').toUpperCase()} GAUGE`, 240, 5),
    GROOVE.x - 12,
    GROOVE.y - 18,
    { ...monoStyle(), maxWidth: 130 },
    pool,
  );
  addHudNumber(
    layer,
    `${Math.round(gauge)}%`,
    GROOVE.x + GROOVE.w + 12,
    GROOVE.y - 22,
    { ...displayStyle(14, LAT_INK, '300'), anchorX: 1 },
    pool,
  );
  const cells = 50;
  const stride = GROOVE.w / cells;
  const lit = Math.round((gauge / 100) * cells);
  const clearCell = Math.round((clear / 100) * cells);
  // Crossing the clear line flips every tick in a wave.
  const clearT = momentProgress(moments.clearAtMs, nowMs, 900);
  for (let cell = 0; cell < cells; cell += 1) {
    const x = GROOVE.x + cell * stride;
    const flip = clearT === undefined ? 1 : Math.abs(Math.cos(tileFlipPhase(cell, 0, cells, 1, clearT, 0.6) * Math.PI));
    if (cell >= lit) {
      graphics.rect(x, GROOVE.y + GROOVE.h - 4, Math.max(1, stride - 1.5), 4).fill({ color: LAT_RULE, alpha: 1 });
      continue;
    }
    const color = survival ? LAT_SIGNAL : cell >= clearCell ? LAT_ACCENT : LAT_INK;
    const h = GROOVE.h * Math.max(0.1, flip);
    graphics.rect(x, GROOVE.y + (GROOVE.h - h) / 2, Math.max(1, stride - 1.5), h).fill(color);
  }
  if (!survival) {
    const x = GROOVE.x + clearCell * stride;
    graphics
      .poly([x - 3.5, GROOVE.y + GROOVE.h + 7, x + 3.5, GROOVE.y + GROOVE.h + 7, x, GROOVE.y + GROOVE.h + 2])
      .fill(LAT_INK);
  }
  drawRulerTicks(graphics, GROOVE.x, GROOVE.y + GROOVE.h + 10, GROOVE.w, 1, LAT_INK, 0.35);
}

function drawSongPlate(graphics: Graphics, layer: Container, runtime: Runtime, pool: ChildPool): void {
  const { x, y, w } = SONG_PLATE;
  const sc = hudScramble(runtime);
  graphics.rect(x, y, w, 1).fill(LAT_INK);
  addHudText(layer, sc('TRACK', 300, 6), x, y + 6, monoStyle(), pool);
  addHudText(
    layer,
    sc(runtime.songTitle?.trim() || 'Untitled chart', 360, 7),
    x + 48,
    y + 4,
    { size: 15, weight: '500', fill: LAT_INK, fontFamily: LAT_TEXT_FONT, maxWidth: w - 48 },
    pool,
  );
  const artist = runtime.songArtist?.trim();
  if (artist) {
    addHudText(
      layer,
      sc(artist, 460, 8),
      x + 48,
      y + 26,
      { size: 10, weight: '300', fill: LAT_GRAPHITE, fontFamily: LAT_TEXT_FONT, maxWidth: w - 48 },
      pool,
    );
  }
}

/** Score block: labelled figures on a two-column grid split by hairlines; the EX rate meter is a ruler. */
function drawScorePanel(graphics: Graphics, layer: Container, runtime: Runtime, pool: ChildPool): void {
  const { x, y, w, h } = SCORE_PANEL;
  const sc = hudScramble(runtime);
  graphics.rect(x, y, w, 1).fill(LAT_INK);
  graphics.rect(x + 146, y + 10, 1, h - 16).fill({ color: LAT_RULE, alpha: 1 });
  graphics.rect(x, y + h, w, 1).fill({ color: LAT_RULE, alpha: 1 });
  addHudText(layer, sc('01 SCORE', 520, 20), x, y + 8, monoStyle(), pool);
  addHudNumber(
    layer,
    formatCount(runtime.score),
    x + 136,
    y + 18,
    { ...displayStyle(24, LAT_INK, '200'), anchorX: 1, maxWidth: 130 },
    pool,
  );
  addHudText(layer, sc('02 EX', 580, 21), x, y + 56, monoStyle(), pool);
  addHudNumber(
    layer,
    `${formatCount(runtime.exScore)}/${formatCount(runtime.exScoreMax)}`,
    x + 136,
    y + 54,
    { ...displayStyle(10, LAT_INK, '400'), anchorX: 1, maxWidth: 80 },
    pool,
  );
  addHudText(layer, sc('03 RATE', 640, 22), x, y + 74, monoStyle(), pool);
  addHudNumber(
    layer,
    formatExRate(runtime.exScore, runtime.exScoreMax),
    x + 136,
    y + 72,
    { ...displayStyle(10, LAT_INK, '400'), anchorX: 1, maxWidth: 80 },
    pool,
  );
  const rate =
    runtime.exScore !== undefined && runtime.exScoreMax !== undefined && runtime.exScoreMax > 0
      ? Math.max(0, Math.min(1, runtime.exScore / runtime.exScoreMax))
      : 0;
  const meterW = 136;
  graphics.rect(x, y + 94, meterW, 1).fill({ color: LAT_RULE, alpha: 1 });
  if (rate > 0) graphics.rect(x, y + 93, meterW * rate, 3).fill(rate >= 8 / 9 ? LAT_ACCENT : LAT_INK);
  for (let ninth = 0; ninth <= 9; ninth += 1) {
    graphics.moveTo(x + (meterW * ninth) / 9, y + 97).lineTo(x + (meterW * ninth) / 9, y + (ninth >= 6 ? 102 : 100));
  }
  graphics.stroke({ color: LAT_INK, width: 1, alpha: 0.5 });
  addHudText(layer, sc('04 COMBO', 700, 23), x + 156, y + 8, monoStyle(), pool);
  addHudNumber(
    layer,
    formatCount(runtime.combo),
    x + w,
    y + 20,
    { ...displayStyle(16, LAT_INK, '300'), anchorX: 1, maxWidth: 70 },
    pool,
  );
  addHudText(layer, sc('05 MAX', 760, 24), x + 156, y + 56, monoStyle(), pool);
  addHudNumber(
    layer,
    formatCount(runtime.maxCombo),
    x + w,
    y + 54,
    { ...displayStyle(10, LAT_INK, '400'), anchorX: 1, maxWidth: 60 },
    pool,
  );
  const rank = runtime.rank && runtime.rank !== '-' ? runtime.rank : 'F';
  addHudText(layer, sc('06 RANK', 820, 25), x + 156, y + 74, monoStyle(), pool);
  addHudText(
    layer,
    rank,
    x + w,
    y + 70,
    { ...displayStyle(rank.length >= 3 ? 16 : 20, rank.startsWith('AA') ? LAT_ACCENT : LAT_INK, '300'), anchorX: 1 },
    pool,
  );
}

const TALLY: ReadonlyArray<readonly [label: string, key: 'perfect' | 'great' | 'good' | 'bad' | 'poor']> = [
  ['PG', 'perfect'],
  ['GR', 'great'],
  ['GD', 'good'],
  ['BD', 'bad'],
  ['PR', 'poor'],
];

/** Judge tally as a column of type with a proportional hairline bar under each count. */
function drawJudgeTally(
  graphics: Graphics,
  layer: Container,
  runtime: Runtime,
  x: number,
  drive: AudioDrive,
  pool: ChildPool,
): void {
  const y = BGA.y - 5;
  const w = DESIGN_WIDTH - x - 8;
  const sc = hudScramble(runtime);
  graphics.rect(x, y, w, 1).fill(LAT_INK);
  const total = Math.max(1, runtime.totalNotes ?? 0);
  for (let row = 0; row < TALLY.length; row += 1) {
    const [label, key] = TALLY[row]!;
    const rowY = y + 10 + row * 28;
    const count = runtime[key] ?? 0;
    const color = JUDGE_COLORS[TALLY_NAMES[key]] ?? LAT_INK;
    addHudText(layer, sc(label, 300 + row * 60, 40 + row), x, rowY, { ...monoStyle(color) }, pool);
    addHudNumber(
      layer,
      formatCount(count),
      x + w,
      rowY - 2,
      { ...displayStyle(11, LAT_INK, '400'), anchorX: 1, maxWidth: w - 22 },
      pool,
    );
    graphics.rect(x, rowY + 15, w, 1).fill({ color: LAT_RULE, alpha: 1 });
    const bar = (w * Math.min(count, total)) / total;
    if (bar > 0) graphics.rect(x, rowY + 14, Math.max(1, bar), 2).fill(color);
  }
  const footerY = y + 10 + TALLY.length * 28 + 4;
  for (const [row, label, color, count] of [
    [0, 'FAST', LAT_ACCENT, runtime.fast],
    [1, 'SLOW', LAT_SIGNAL, runtime.slow],
  ] as const) {
    const rowY = footerY + row * 18;
    addHudText(layer, sc(label, 620 + row * 60, 50 + row), x, rowY, monoStyle(color), pool);
    addHudNumber(
      layer,
      formatCount(count),
      x + w,
      rowY - 2,
      { ...displayStyle(11, LAT_INK, '400'), anchorX: 1, maxWidth: w - 34 },
      pool,
    );
  }
  // Live spectrum and level readout under the tally.
  const specY = footerY + 64;
  const bars = 16;
  const barPitch = w / bars;
  graphics.rect(x, specY, w, 1).fill(LAT_INK);
  for (let bar = 0; bar < bars; bar += 1) {
    const value = bandLevel(drive.bands, bar, bars);
    const h = Math.round(26 * value);
    if (h < 1) continue;
    graphics
      .rect(x + bar * barPitch, specY - h, Math.max(1, barPitch - 1.5), h)
      .fill(value > 0.8 ? LAT_ACCENT : LAT_INK);
  }
  addHudText(layer, sc('dB', 700, 60), x, specY + 5, monoStyle(), pool);
  addHudNumber(
    layer,
    drive.db <= -95 ? '-inf' : drive.db.toFixed(1),
    x + w,
    specY + 5,
    { ...monoStyle(LAT_INK), anchorX: 1 },
    pool,
  );
}

const TALLY_NAMES = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', bad: 'BAD', poor: 'POOR' } as const;
const JUDGE_COLORS: Record<string, number> = {
  PERFECT: LAT_ACCENT,
  GREAT: LAT_INK,
  GOOD: LAT_GRAPHITE,
  BAD: 0xd9730d,
  POOR: LAT_SIGNAL,
};

/** Colours the PERFECT judgement's flashing GREAT cycles through — inks that hold up on the paper. */
const FLASHING_GREAT = [LAT_ACCENT, LAT_SIGNAL, 0x00a37a, 0xb02cff, 0xe0a100] as const;

/**
 * Judgement word dropping in letter by letter on a spring, with the combo as an odometer whose changed wheels roll up.
 * PERFECT prints as a GREAT flashing through the inks; a miss lands still.
 */
function drawJudgements(
  layer: Container,
  runtime: Runtime,
  playfieldRight: number,
  amount: number,
  pool: ChildPool,
): void {
  const nowMs = runtime.nowMs ?? 0;
  const age = runtime.judgeAtMs !== undefined ? nowMs - runtime.judgeAtMs : Number.POSITIVE_INFINITY;
  for (const display of resolveJudgeDisplays(runtime, playfieldRight)) {
    const word = judgeDisplayWord(display.judge);
    const color = isFlashingGreat(display.judge)
      ? flashingGreatColor(nowMs, FLASHING_GREAT)
      : (JUDGE_COLORS[display.judge] ?? LAT_INK);
    addStaggeredHudText(
      layer,
      amount > 0 ? scrambleText(word, age / 90, scrambleTick(nowMs, 25), word.length) : word,
      display.x,
      228,
      { ...displayStyle(14, color, '600'), letterSpacing: 4, anchorX: 0.5, anchorY: 0.5 },
      pool,
      (index) => {
        const t = amount > 0 ? Math.max(0, (age - index * 9) / 130) : 1;
        // A hair of nervous vertical tremor while the letter settles.
        const tremor = t < 1 ? (Math.floor(age / 16 + index) % 2 === 0 ? 0.5 : -0.5) : 0;
        return { dy: -8 * (1 - springEase(Math.min(1, t), 3, 0.4)) + tremor, alpha: Math.min(1, t * 5) };
      },
    );
    const combo = resolveVisibleCombo(display.judge, display.combo);
    if (combo > 0) {
      addOdometer(
        layer,
        combo,
        combo - 1,
        amount > 0 ? age / 240 : 1,
        display.x,
        256,
        {
          ...displayStyle(30, combo >= 100 ? LAT_ACCENT : LAT_INK, '200'),
          anchorX: 0.5,
          anchorY: 0.5,
          cell: 18,
          travel: 14,
        },
        pool,
      );
    }
  }
}

function resolveJudgeDisplays(
  runtime: Runtime,
  playfieldRight: number,
): Array<{ judge: string; combo: number | undefined; x: number }> {
  const { lanes, left: playfieldLeft } = resolveSkinlessLaneLayout(
    runtime.laneChannels,
    runtime.laneCount,
    runtime.playVariant,
  );
  const centerOf = (side: '1P' | '2P'): number | undefined => {
    const own = lanes.filter((lane) => lane.side === side);
    if (own.length === 0) return undefined;
    return (Math.min(...own.map((lane) => lane.x)) + Math.max(...own.map((lane) => lane.x + lane.w))) / 2;
  };
  const fallbackX = (playfieldLeft + playfieldRight) / 2;
  const sides = runtime.judgeSides?.filter((state) => typeof state.judge === 'string' && state.judge.length > 0);
  if (sides?.length) {
    return sides.map((state) => ({ judge: state.judge!, combo: state.combo, x: centerOf(state.side) ?? fallbackX }));
  }
  if (!runtime.lastJudge) return [];
  return [{ judge: runtime.lastJudge, combo: runtime.combo, x: centerOf('1P') ?? fallbackX }];
}

function resolveVisibleCombo(judge: string, combo: number | undefined): number {
  if (judge !== 'PERFECT' && judge !== 'GREAT' && judge !== 'GOOD') return 0;
  return combo !== undefined && Number.isFinite(combo) ? Math.max(0, Math.floor(combo)) : 0;
}

/** `+012.345` / `-001.200` seconds with millisecond digits. */
function formatChartTime(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const seconds = Math.min(999.999, Math.abs(ms) / 1000);
  return `${sign}${seconds.toFixed(3).padStart(7, '0')}`;
}

function formatCount(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0';
  return String(Math.max(0, Math.floor(value)));
}

function formatBpm(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '---';
  return String(Math.round(value));
}

function formatHiSpeed(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '0.0';
  return value.toFixed(1);
}

function formatRuleset(value: string | undefined): string {
  switch (value) {
    case 'beatoraja':
      return 'BEATORAJA';
    case 'iidx':
      return 'IIDX';
    default:
      return 'LR2';
  }
}

function formatExRate(exScore: number | undefined, max: number | undefined): string {
  if (exScore === undefined || max === undefined || !Number.isFinite(exScore) || !Number.isFinite(max) || max <= 0) {
    return '0.0%';
  }
  return `${((exScore / max) * 100).toFixed(1)}%`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
