import type { Graphics } from 'pixi.js';
import { springEase } from './field.ts';
import { LAT_ACCENT, LAT_INK, LAT_RULE, LAT_SIGNAL } from './style.ts';
import {
  easeOutCubic,
  type BeMusicBomb,
  type BeMusicLaneKind,
  comboTier,
  effectProfile,
  hash01,
  resolveLaneRuns,
} from '../../skin-sdk/index.ts';
import {
  type PixiBombsContext,
  type PixiLanesContext,
  type PixiLongNoteContext,
  type PixiNoteContext,
  keyBeamGradient,
} from '../pixi-kit/index.ts';

/** Lane-class colour: white keys print in ink, black keys in cobalt, the scratch in vermilion. */
const LANE_COLORS: Record<BeMusicLaneKind, number> = {
  white: LAT_INK,
  black: LAT_ACCENT,
  scratch: LAT_SIGNAL,
};

/** Beam inks: the note colours, with the white keys' ink lifted to graphite so its beam doesn't swallow the notes. */
const BEAM_INKS: Record<BeMusicLaneKind, number> = { white: 0x55544f, black: LAT_ACCENT, scratch: LAT_SIGNAL };

const NOTE_HEIGHT = 6;
const LANE_BED = 0xfbfaf7;
const LANE_BED_DEEP = 0xe6e3dc;
export const LATTICE_BOMB_DURATION_MS = 380;

/**
 * Lattice lanes: bright paper columns split by hairlines, a key beam that prints the lane's colour as a soft wash, an
 * ink judgement line with ruler ticks and a beat marker sliding along it, and square key caps that fill on press.
 */
export function renderLatticeLanes({ graphics, lanes, beatPhase, combo, effects }: PixiLanesContext): void {
  if (lanes.length === 0) return;
  const tier = effectProfile(effects).enabled ? comboTier(combo ?? 0) : 0;
  let left = Number.POSITIVE_INFINITY;
  let right = 0;
  let top = Number.POSITIVE_INFINITY;
  let bottom = 0;
  for (const lane of lanes) {
    left = Math.min(left, lane.x);
    right = Math.max(right, lane.x + lane.w);
    top = Math.min(top, lane.top);
    bottom = Math.max(bottom, lane.bottom);
  }
  for (const lane of lanes) {
    const { x, w } = lane;
    const height = Math.max(1, lane.bottom - lane.top);
    // White-key lanes are the bright paper; black keys and the scratch sit on the deeper stock.
    graphics
      .rect(x, lane.top, w, height)
      .fill({ color: lane.kind === 'white' ? LANE_BED : LANE_BED_DEEP, alpha: 0.94 });
    // Key beam: the lane colour printed up from the judgement line, dense at the line and thinning out up the paper, so
    // a press reads at a glance while the notes still on their way down stay crisp.
    if (lane.beam > 0) {
      const beamHeight = Math.min(height, 240);
      const strength = lane.beam * lane.beam * (3 - 2 * lane.beam);
      graphics
        .rect(x, lane.bottom - beamHeight, w, beamHeight)
        .fill({ fill: keyBeamGradient(BEAM_INKS[lane.kind]), alpha: strength * 0.7 });
    }
    // Key cap: an outlined square that fills with the lane colour while held.
    const cap = Math.min(10, w - 4);
    const capX = x + (w - cap) / 2;
    if (lane.beam > 0.6) {
      graphics.rect(capX, lane.bottom + 7, cap, cap).fill(LANE_COLORS[lane.kind]);
    } else {
      graphics.rect(capX + 0.5, lane.bottom + 7.5, cap - 1, cap - 1).stroke({ color: LAT_INK, width: 1, alpha: 0.55 });
    }
  }
  // Lane hairlines.
  for (const lane of lanes) {
    graphics.moveTo(lane.x + 0.5, lane.top).lineTo(lane.x + 0.5, lane.bottom);
  }
  // Close each play side's grid on its right edge (each lane only rules its left hairline).
  for (const run of resolveLaneRuns(lanes)) graphics.moveTo(run.right - 0.5, top).lineTo(run.right - 0.5, bottom);
  graphics.stroke({ color: LAT_RULE, width: 1, alpha: 0.9 });

  // Judgement line: ink, with ruler ticks hanging under it; it thickens as the run builds. One per play side, so it
  // never crosses the gap between the double-play banks.
  const lineWidth = 2 + (tier >= 2 ? 1 : 0);
  for (const run of resolveLaneRuns(lanes)) {
    graphics.rect(run.left, bottom - lineWidth, run.right - run.left, lineWidth).fill(LAT_INK);
    for (let x = run.left; x <= run.right + 1e-6; x += 4) {
      const long = Math.round(x - run.left) % 20 === 0;
      graphics.moveTo(x, bottom).lineTo(x, bottom + (long ? 5 : 2));
    }
  }
  graphics.stroke({ color: LAT_INK, width: 1, alpha: 0.5 });
  // Beat marker: a cobalt block that springs from lane to lane along the line, one lane per beat.
  const ordered = [...lanes].sort((a, b) => a.x - b.x);
  const steps = Math.max(1, ordered.length);
  const beat = Math.min(steps - 1, Math.floor(beatPhase * steps));
  const within = beatPhase * steps - beat;
  const lane = ordered[beat];
  if (lane) {
    const markerX = lane.x + springEase(Math.min(1, within * 2), 2.4, 0.5) * Math.max(0, lane.w - 6);
    graphics.rect(markerX, bottom - lineWidth - 3, 6, 3).fill(LAT_ACCENT);
  }
}

export function renderLatticeNote({ graphics, kind, x, w, y }: PixiNoteContext): void {
  graphics.rect(x, y - NOTE_HEIGHT, Math.max(3, w), NOTE_HEIGHT).fill(LANE_COLORS[kind]);
}

/**
 * Long note: the shared long-note shape — a translucent beam with a centre filament between the head and tail bars —
 * printed in ink: a faint wash of the lane colour and a solid ink filament (white would vanish on the paper).
 */
export function renderLatticeLongNote({ graphics, kind, x, w, top, bottom }: PixiLongNoteContext): void {
  const color = LANE_COLORS[kind];
  const bodyX = x;
  const bodyW = Math.max(3, w);
  const bodyTop = top - NOTE_HEIGHT;
  const bodyBottom = bottom - NOTE_HEIGHT;
  if (bodyBottom > bodyTop) {
    graphics.rect(bodyX + 1, bodyTop, bodyW - 2, bodyBottom - bodyTop).fill({ color, alpha: 0.16 });
    graphics.rect(bodyX + bodyW / 2 - 1, bodyTop, 2, bodyBottom - bodyTop).fill({ color, alpha: 0.9 });
  }
  renderLatticeNote({ graphics, kind, x, w, y: bottom, nowMs: 0 });
  renderLatticeNote({ graphics, kind, x, w, y: top, nowMs: 0 });
}

/**
 * The Lattice hit — a precise, mechanical flourish rather than light: a hairline ring snaps open, a cross springs a
 * quarter turn, small squares shoot out along the diagonals (more sets as the combo tier rises), and a hairline
 * retracts down the lane. At tier 3+ a dashed orbit spins around the hit.
 */
export function renderLatticeBombs({ pool, bombs, combo, effects }: PixiBombsContext): void {
  const profile = effectProfile(effects);
  const tier = profile.enabled ? Math.min(comboTier(combo ?? 0), profile.screenWide ? 4 : 2) : 0;
  if (bombs.length === 0) return;
  const graphics = pool.acquireGraphics();
  graphics.label = 'lattice-bombs';
  graphics.blendMode = 'normal';
  for (const bomb of bombs) {
    renderBomb(graphics, bomb, tier, profile.enabled, profile.amount);
  }
}

function renderBomb(graphics: Graphics, bomb: BeMusicBomb, tier: number, enabled: boolean, amount: number): void {
  const t = Math.max(0, Math.min(1, bomb.elapsedMs / LATTICE_BOMB_DURATION_MS));
  if (t >= 1) return;
  const color = LANE_COLORS[bomb.kind];
  const cx = bomb.x + bomb.w / 2;
  const cy = bomb.y - 3;
  const unit = Math.max(12, bomb.w);
  const open = easeOutCubic(t);
  const fade = 1 - t;
  // Ring.
  graphics.circle(cx, cy, unit * (0.3 + 0.75 * open)).stroke({ color, width: 0.6 + 1.4 * fade, alpha: fade });
  if (!enabled) return;
  // Cross springing a quarter turn.
  const turn = springEase(Math.min(1, t * 1.8), 2, 0.45) * (Math.PI / 2);
  const arm = unit * 0.42 * (1 - 0.5 * t);
  for (const base of [0, Math.PI / 2]) {
    const angle = base + turn + Math.PI / 4;
    const dx = Math.cos(angle) * arm;
    const dy = Math.sin(angle) * arm;
    graphics.moveTo(cx - dx, cy - dy).lineTo(cx + dx, cy + dy);
  }
  graphics.stroke({ color: LAT_INK, width: 1.25, alpha: fade });
  // Squares along the diagonals — one set of four, plus a set per combo tier at an offset angle.
  const sets = Math.max(1, Math.round((2 + tier) * amount));
  for (let set = 0; set < sets; set += 1) {
    const offset = (set * Math.PI) / (4 * sets) + (hash01(bomb.seed + set) - 0.5) * 0.2;
    const reach = unit * (0.4 + (1 + 0.2 * set) * open);
    const size = Math.max(1, (2.2 - 0.2 * set) * fade);
    for (let arm4 = 0; arm4 < 4; arm4 += 1) {
      const angle = Math.PI / 4 + (arm4 * Math.PI) / 2 + offset;
      // Snap to whole pixels: the motion reads as stepped, mechanical.
      // Snapped to whole pixels with a one-pixel twitch: the motion reads as stepped, mechanical, nervous.
      const twitch = (hash01(bomb.seed * 7 + set * 13 + arm4 + Math.floor(bomb.elapsedMs / 33)) - 0.5) * 2;
      const px = Math.round(cx + Math.cos(angle) * reach + twitch);
      const py = Math.round(cy + Math.sin(angle) * reach - twitch);
      graphics
        .rect(px - size / 2, py - size / 2, size, size)
        .fill({ color: set % 2 === 0 ? color : LAT_INK, alpha: fade });
    }
  }
  // Hairline retracting down the lane.
  const beam = unit * 7 * (1 - open);
  if (beam > 1) {
    graphics.rect(cx - 0.5, cy - beam, 1, beam).fill({ color, alpha: 0.8 * fade });
  }
  if (tier >= 3) {
    const radius = unit * 1.3;
    const spin = t * Math.PI * (bomb.seed % 2 === 0 ? 1 : -1);
    for (let dash = 0; dash < 12; dash += 1) {
      const a0 = spin + (dash * Math.PI * 2) / 12;
      const r = radius * (0.8 + 0.2 * open);
      graphics.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r).arc(cx, cy, r, a0, a0 + 0.22);
    }
    graphics.stroke({ color, width: 1, alpha: 0.7 * fade });
  }
}
