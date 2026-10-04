import { Color, FillGradient, type Graphics } from 'pixi.js';
import type {
  BeMusicBomb,
  BeMusicBombsContext,
  BeMusicLaneKind,
  BeMusicLanesContext,
  BeMusicLongNoteContext,
  BeMusicNoteContext,
} from '../../../skin/be-music/types.ts';
import { comboTier, effectProfile } from '../moments.ts';
import { easeOutCubic, hash01 } from '../phantom-style.ts';
import { springEase } from './field.ts';
import { LAT_ACCENT, LAT_INK, LAT_RULE, LAT_SIGNAL } from './style.ts';

/** Lane-class colour: white keys print in ink, black keys in cobalt, the scratch in vermilion. */
const LANE_COLORS: Record<BeMusicLaneKind, number> = {
  white: LAT_INK,
  black: LAT_ACCENT,
  scratch: LAT_SIGNAL,
};

const NOTE_HEIGHT = 6;
const LANE_BED = 0xfbfaf7;
const LANE_BED_DEEP = 0xe6e3dc;
export const LATTICE_BOMB_DURATION_MS = 380;

/**
 * Lattice lanes: bright paper columns split by hairlines, a key beam that prints the lane's colour as a soft wash, an
 * ink judgement line with ruler ticks and a beat marker sliding along it, and square key caps that fill on press.
 */
export function renderLatticeLanes({ graphics, lanes, beatPhase, combo, effects }: BeMusicLanesContext): void {
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
    if (lane.beam > 0) {
      const beamHeight = Math.min(height, 200);
      const strength = lane.beam * lane.beam * (3 - 2 * lane.beam);
      graphics
        .rect(x, lane.bottom - beamHeight, w, beamHeight)
        .fill({ fill: resolveWash(LANE_COLORS[lane.kind]), alpha: strength * 0.5 });
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
  graphics.moveTo(right - 0.5, top).lineTo(right - 0.5, bottom);
  graphics.stroke({ color: LAT_RULE, width: 1, alpha: 0.9 });

  // Judgement line: ink, with ruler ticks hanging under it; it thickens as the run builds.
  const lineWidth = 2 + (tier >= 2 ? 1 : 0);
  graphics.rect(left, bottom - lineWidth, right - left, lineWidth).fill(LAT_INK);
  for (let x = left; x <= right + 1e-6; x += 4) {
    const long = Math.round(x - left) % 20 === 0;
    graphics.moveTo(x, bottom).lineTo(x, bottom + (long ? 5 : 2));
  }
  graphics.stroke({ color: LAT_INK, width: 1, alpha: 0.5 });
  // Beat marker: a cobalt block that springs from tick to tick across the line, one lane per beat.
  const span = right - left;
  const steps = Math.max(1, lanes.length);
  const beat = Math.floor(beatPhase * steps);
  const within = beatPhase * steps - beat;
  const markerX = left + ((beat + springEase(Math.min(1, within * 2), 2.4, 0.5)) / steps) * span;
  graphics.rect(Math.min(right - 6, markerX), bottom - lineWidth - 3, 6, 3).fill(LAT_ACCENT);
}

export function renderLatticeNote({ graphics, kind, x, w, y }: BeMusicNoteContext): void {
  graphics.rect(x, y - NOTE_HEIGHT, Math.max(3, w), NOTE_HEIGHT).fill(LANE_COLORS[kind]);
}

/** Long note: an outlined column ruled with fine horizontal hatching, capped by solid heads. */
export function renderLatticeLongNote({ graphics, kind, x, w, top, bottom }: BeMusicLongNoteContext): void {
  const color = LANE_COLORS[kind];
  const bodyX = x;
  const bodyW = Math.max(3, w);
  const bodyTop = top - NOTE_HEIGHT;
  const bodyBottom = bottom - NOTE_HEIGHT;
  if (bodyBottom > bodyTop) {
    graphics.rect(bodyX, bodyTop, bodyW, bodyBottom - bodyTop).fill({ color, alpha: 0.08 });
    // Hatching on an absolute 3 px pitch, so it reads as a printed pattern rather than scrolling stripes.
    for (let y = Math.ceil(bodyTop / 3) * 3; y < bodyBottom; y += 3) {
      graphics.moveTo(bodyX, y + 0.5).lineTo(bodyX + bodyW, y + 0.5);
    }
    graphics.stroke({ color, width: 1, alpha: 0.35 });
    graphics.rect(bodyX + 0.5, bodyTop, bodyW - 1, bodyBottom - bodyTop).stroke({ color, width: 1, alpha: 0.9 });
  }
  renderLatticeNote({ graphics, kind, x, w, y: bottom, nowMs: 0 });
  renderLatticeNote({ graphics, kind, x, w, y: top, nowMs: 0 });
}

/**
 * The Lattice hit — a precise, mechanical flourish rather than light: a hairline ring snaps open, a cross springs a
 * quarter turn, small squares shoot out along the diagonals (more sets as the combo tier rises), and a hairline
 * retracts down the lane. At tier 3+ a dashed orbit spins around the hit.
 */
export function renderLatticeBombs({ pool, bombs, combo, effects }: BeMusicBombsContext): void {
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

const WASHES = new Map<number, FillGradient>();

/** Vertical wash for a key beam: transparent at the top, the lane colour toward the judgement line. */
function resolveWash(color: number): FillGradient {
  let gradient = WASHES.get(color);
  if (!gradient) {
    const rgb = new Color(color);
    gradient = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      textureSpace: 'local',
      colorStops: [
        { offset: 0, color: rgb.setAlpha(0).toRgbaString() },
        { offset: 0.7, color: rgb.setAlpha(0.12).toRgbaString() },
        { offset: 1, color: rgb.setAlpha(0.4).toRgbaString() },
      ],
    });
    WASHES.set(color, gradient);
  }
  return gradient;
}
