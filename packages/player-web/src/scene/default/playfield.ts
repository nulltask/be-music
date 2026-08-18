import type { Graphics } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { isScratchLaneForVariant } from '../gameplay-lanes.ts';
import { beatPulse, shardFlight } from './motion.ts';
import { DEFAULT_THEME, fillTriangle } from './theme.ts';

export const DEFAULT_NOTE_HEIGHT = 12;

export interface DefaultLaneTone {
  top: number;
  body: number;
  bottom: number;
  cap: number;
  capLit: number;
}

const TONE_WHITE: DefaultLaneTone = {
  top: 0xffffff,
  body: 0xe8f4fb,
  bottom: 0x8fb0c4,
  cap: 0xc5d6e4,
  capLit: 0xffffff,
};
const TONE_CYAN: DefaultLaneTone = {
  top: 0xc8fbff,
  body: 0x2fd4f0,
  bottom: 0x0c6f8c,
  cap: 0x0c3344,
  capLit: 0x6aeeff,
};
const TONE_GOLD: DefaultLaneTone = {
  top: 0xfff4c8,
  body: 0xffd056,
  bottom: 0xb07a18,
  cap: 0x4a3810,
  capLit: 0xffe07a,
};

export function defaultNoteTone(
  channel: string,
  laneIndex: number,
  playVariant: ChartPlayVariant | undefined,
): DefaultLaneTone {
  if (isScratchLaneForVariant(channel, playVariant)) return TONE_GOLD;
  const keyIndex = laneIndex % 10;
  if (keyIndex % 2 === 0) return TONE_CYAN;
  return TONE_WHITE;
}

/**
 * Geometric note: a shallow parallelogram (ice / cyan / gold) instead of a plastic round-rect.
 * `y` is the just-timing line; the body's bottom edge sits on it.
 */
export function drawDefaultNoteBody(graphic: Graphics, x: number, y: number, w: number, tone: DefaultLaneTone): void {
  const h = DEFAULT_NOTE_HEIGHT;
  const skew = 3;
  graphic
    .poly([x + skew, y - h, x + w, y - h, x + w - skew, y, x, y])
    .fill(tone.body)
    .stroke({ color: 0x031018, width: 1, alignment: 1 });
  graphic.poly([x + skew + 1, y - h + 1, x + w - 1, y - h + 1, x + w - 2, y - h + 3, x + skew + 2, y - h + 3]).fill({
    color: tone.top,
    alpha: 0.9,
  });
  graphic.rect(x + 1, y - 2, w - 2, 2).fill({ color: tone.bottom, alpha: 0.85 });
}

export function drawDefaultLnBody(
  graphic: Graphics,
  x: number,
  top: number,
  bottom: number,
  w: number,
  tone: DefaultLaneTone,
): void {
  const bodyTop = top - DEFAULT_NOTE_HEIGHT;
  const bodyH = Math.max(1, bottom - top);
  graphic.rect(x + 2, bodyTop, w - 4, bodyH).fill({ color: tone.body, alpha: 0.26 });
  graphic.rect(x, bodyTop, 2, bodyH).fill({ color: tone.body, alpha: 0.9 });
  graphic.rect(x + w - 2, bodyTop, 2, bodyH).fill({ color: tone.body, alpha: 0.9 });
  graphic.rect(x + w / 2 - 0.5, bodyTop, 1, bodyH).fill({ color: tone.top, alpha: 0.35 });
  drawDefaultNoteBody(graphic, x, bottom, w, tone);
  drawDefaultNoteBody(graphic, x, top, w, tone);
}

export function drawDefaultMine(graphic: Graphics, x: number, y: number, w: number): void {
  graphic
    .poly([x + w / 2, y - 13, x + w, y - 6, x + w / 2, y, x, y - 6])
    .fill(0x5a1018)
    .stroke({ color: DEFAULT_THEME.gold, width: 1, alignment: 1 });
  graphic.poly([x + w / 2, y - 9, x + w - 4, y - 6, x + w / 2, y - 3, x + 4, y - 6]).fill({
    color: DEFAULT_THEME.gold,
    alpha: 0.7,
  });
}

export function drawDefaultLaneColumn(
  graphic: Graphics,
  lane: { x: number; w: number; top: number; bottom: number },
  tone: DefaultLaneTone,
  options: { scratch: boolean; laserAlpha: number; beatPhase?: number },
): void {
  const { x, w, top, bottom } = lane;
  const laneHeight = Math.max(1, bottom - top);
  graphic.rect(x, top, w, laneHeight).fill({ color: tone.body, alpha: options.scratch ? 0.05 : 0.028 });
  graphic.rect(x, top, 1, laneHeight).fill({ color: DEFAULT_THEME.line, alpha: 0.7 });
  const laserAlpha = options.laserAlpha;
  if (laserAlpha > 0) {
    const beamHeight = Math.min(laneHeight, 170);
    const slices = 6;
    for (let slice = 0; slice < slices; slice += 1) {
      const sliceRatio = slice / slices;
      const sliceH = beamHeight / slices;
      const sliceY = bottom - beamHeight + sliceRatio * beamHeight;
      graphic
        .rect(x + 1, sliceY, w - 2, sliceH + 1)
        .fill({ color: tone.body, alpha: (0.04 + 0.38 * sliceRatio * sliceRatio) * laserAlpha });
    }
    graphic.rect(x + 1, bottom - 16, w - 2, 16).fill({ color: 0xffffff, alpha: 0.28 * laserAlpha });
  }
  const pulse = beatPulse(options.beatPhase, 0.45);
  graphic.rect(x, bottom - 12, w, 10).fill({ color: DEFAULT_THEME.cyan, alpha: (0.06 + 0.1 * pulse) * 0.9 });
  graphic.rect(x, bottom - 3, w, 2).fill({ color: DEFAULT_THEME.cyan, alpha: 0.45 + 0.5 * pulse });
  graphic.rect(x, bottom, w, 1).fill({ color: DEFAULT_THEME.ice, alpha: 0.95 });
  const pressed = laserAlpha > 0.6;
  const capTop = bottom + 3;
  const capHeight = 14;
  graphic
    .poly([x + 2, capTop, x + w - 2, capTop, x + w - 4, capTop + capHeight, x + 4, capTop + capHeight])
    .fill({ color: pressed ? tone.capLit : tone.cap, alpha: pressed ? 1 : 0.92 });
  graphic.rect(x + 2, capTop, Math.max(2, w - 4), 2).fill({ color: 0xffffff, alpha: pressed ? 0.7 : 0.12 });
  if (pressed) {
    graphic.rect(x + 2, capTop - 2, Math.max(2, w - 4), 2).fill({ color: tone.top, alpha: 0.95 });
  }
}

export function drawDefaultLaneGridRight(
  graphic: Graphics,
  gridRight: number,
  gridTop: number,
  gridBottom: number,
): void {
  graphic.rect(gridRight - 1, gridTop, 1, Math.max(1, gridBottom - gridTop)).fill({
    color: DEFAULT_THEME.line,
    alpha: 0.7,
  });
}

export function drawDefaultBomb(
  graphic: Graphics,
  lane: { x: number; w: number; bottom: number },
  elapsed: number,
  duration = 150,
): void {
  const progress = Math.max(0, Math.min(1, elapsed / duration));
  const fade = 1 - progress;
  const centerX = lane.x + lane.w / 2;
  const centerY = lane.bottom - Math.max(5, lane.w * 0.18);
  graphic.blendMode = 'add';
  graphic
    .rect(lane.x + lane.w * 0.18, centerY - 48 * (0.4 + progress), lane.w * 0.64, 48 * (0.4 + progress))
    .fill({ color: DEFAULT_THEME.cyan, alpha: 0.12 * fade });
  const core = Math.max(3, lane.w * (0.22 + 0.18 * progress));
  fillTriangle(graphic, centerX, centerY, core * 2.4, DEFAULT_THEME.cyan, 0.35 * fade);
  fillTriangle(graphic, centerX, centerY, core * 1.6, 0xffffff, 0.7 * fade, true);
  const count = 6;
  for (let index = 0; index < count; index += 1) {
    const shard = shardFlight(elapsed, duration, index, count);
    fillTriangle(
      graphic,
      centerX + shard.x,
      centerY + shard.y,
      5 * shard.scale,
      index % 2 === 0 ? DEFAULT_THEME.ice : DEFAULT_THEME.gold,
      shard.alpha * 0.85,
      index % 2 === 1,
    );
  }
}

export function drawDefaultMeasureLine(graphic: Graphics, x0: number, x1: number, y: number): void {
  graphic.rect(x0, Math.round(y), x1 - x0, 1).fill({ color: DEFAULT_THEME.measure, alpha: 0.22 });
}
