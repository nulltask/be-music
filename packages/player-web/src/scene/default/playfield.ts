import type { Graphics } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { isScratchLaneForVariant } from '../gameplay-lanes.ts';
import { beatImpulse, shardFlight } from './motion.ts';
import { DEFAULT_THEME, fillParallelogram, fillSlash, fillTriangle } from './theme.ts';

export const DEFAULT_NOTE_HEIGHT = 12;
const NOTE_SKEW = 4;

export interface DefaultLaneTone {
  top: number;
  body: number;
  bottom: number;
  cap: number;
  capLit: number;
  outline: number;
}

const TONE_ICE: DefaultLaneTone = {
  top: 0xffffff,
  body: 0xe8f4fb,
  bottom: 0x8fb0c4,
  cap: 0xc5d6e4,
  capLit: 0xffffff,
  outline: 0x031018,
};
const TONE_CYAN: DefaultLaneTone = {
  top: 0xc8fbff,
  body: 0x2fd4f0,
  bottom: 0x0c6f8c,
  cap: 0x0c3344,
  capLit: 0x6aeeff,
  outline: 0x031018,
};
const TONE_GOLD: DefaultLaneTone = {
  top: 0xfff4c8,
  body: 0xffd056,
  bottom: 0xb07a18,
  cap: 0x4a3810,
  capLit: 0xffe07a,
  outline: 0x031018,
};

export function defaultNoteTone(
  channel: string,
  laneIndex: number,
  playVariant: ChartPlayVariant | undefined,
): DefaultLaneTone {
  if (isScratchLaneForVariant(channel, playVariant)) return TONE_GOLD;
  const keyIndex = laneIndex % 10;
  if (keyIndex % 2 === 0) return TONE_CYAN;
  return TONE_ICE;
}

function notePoints(x: number, y: number, w: number, h: number, skew: number): number[] {
  return [x + skew, y, x + w, y, x + w - skew, y + h, x, y + h];
}

/**
 * Geometric note: a shallow parallelogram (ice / cyan / gold). `y` is the just-timing line; the body's bottom edge sits on it.
 */
export function drawDefaultNoteBody(graphic: Graphics, x: number, y: number, w: number, tone: DefaultLaneTone): void {
  const h = DEFAULT_NOTE_HEIGHT;
  const top = y - h;
  graphic
    .poly(notePoints(x, top, w, h, NOTE_SKEW))
    .fill(tone.body)
    .stroke({ color: tone.outline, width: 1, alignment: 1 });
  graphic.poly(notePoints(x + 1, top + 1, Math.max(1, w - 2), 2, NOTE_SKEW - 0.4)).fill({ color: tone.top, alpha: 0.95 });
  graphic.poly(notePoints(x + 1, y - 3, Math.max(1, w - 2), 2, 0.6)).fill({ color: tone.bottom, alpha: 0.9 });
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
  graphic.rect(x + 1, bodyTop, Math.max(1, w - 2), bodyH).fill({ color: tone.body, alpha: 0.28 });
  graphic.rect(x, bodyTop, 2, bodyH).fill({ color: tone.body, alpha: 0.9 });
  graphic.rect(x + w - 2, bodyTop, 2, bodyH).fill({ color: tone.body, alpha: 0.9 });
  graphic.rect(x + w / 2 - 0.5, bodyTop, 1, bodyH).fill({ color: tone.top, alpha: 0.35 });
  drawDefaultNoteBody(graphic, x, bottom, w, tone);
  drawDefaultNoteBody(graphic, x, top, w, tone);
}

export function drawDefaultMine(graphic: Graphics, x: number, y: number, w: number): void {
  const h = DEFAULT_NOTE_HEIGHT;
  graphic
    .poly(notePoints(x, y - h, w, h, NOTE_SKEW))
    .fill(DEFAULT_THEME.accentDeep)
    .stroke({ color: DEFAULT_THEME.gold, width: 1, alignment: 1 });
  const stripeStep = 7;
  for (let sx = x - 10; sx < x + w; sx += stripeStep) {
    graphic.poly([sx, y - 1, sx + 3, y - 1, sx + 3 + 7, y - h + 1, sx + 7, y - h + 1]).fill({
      color: DEFAULT_THEME.gold,
      alpha: 0.7,
    });
  }
}

export function drawDefaultLaneColumn(
  graphic: Graphics,
  lane: { x: number; w: number; top: number; bottom: number },
  tone: DefaultLaneTone,
  options: { scratch: boolean; laserAlpha: number; beatPhase?: number },
): void {
  const { x, w, top, bottom } = lane;
  const laneHeight = Math.max(1, bottom - top);
  const pulse = beatImpulse(options.beatPhase);
  graphic.rect(x, top, w, laneHeight).fill({ color: tone.body, alpha: options.scratch ? 0.07 : 0.032 });
  graphic.rect(x, top, 1, laneHeight).fill({ color: DEFAULT_THEME.railEdge, alpha: 0.55 });
  const laserAlpha = options.laserAlpha;
  if (laserAlpha > 0) {
    const beamHeight = Math.min(laneHeight, 190);
    const slices = 5;
    for (let slice = 0; slice < slices; slice += 1) {
      const sliceRatio = slice / slices;
      const sliceH = beamHeight / slices;
      const sliceY = bottom - beamHeight + sliceRatio * beamHeight;
      fillParallelogram(
        graphic,
        x + 1,
        sliceY,
        w - 2,
        sliceH + 1,
        3 * (1 - sliceRatio),
        tone.body,
        (0.06 + 0.48 * sliceRatio * sliceRatio) * laserAlpha,
      );
    }
    fillSlash(graphic, x - 2, bottom - 28, w + 8, 10, 4, DEFAULT_THEME.white, 0.28 * laserAlpha);
  }
  graphic.rect(x, bottom - 16, w, 12).fill({ color: DEFAULT_THEME.accent, alpha: 0.08 + 0.16 * pulse });
  fillSlash(graphic, x - 4, bottom - 6, w + 10, 5, 2, DEFAULT_THEME.accent, 0.45 + 0.4 * pulse);
  graphic.rect(x, bottom - 2, w, 2).fill({ color: DEFAULT_THEME.paper, alpha: 0.7 + 0.3 * pulse });
  graphic.rect(x, bottom, w, 1).fill({ color: DEFAULT_THEME.ice, alpha: 0.85 + 0.15 * pulse });
  const pressed = laserAlpha > 0.6;
  const capTop = bottom + 3;
  const capHeight = 14;
  fillParallelogram(
    graphic,
    x + 1,
    capTop,
    Math.max(2, w - 2),
    capHeight,
    pressed ? 3 : 1,
    pressed ? tone.capLit : tone.cap,
    pressed ? 1 : 0.92,
  );
  graphic.rect(x + 1, capTop, Math.max(2, w - 2), 2).fill({ color: DEFAULT_THEME.white, alpha: pressed ? 0.8 : 0.12 });
  if (pressed) {
    fillSlash(graphic, x, capTop - 4, w, 4, 1, tone.top, 0.95);
  }
}

export function drawDefaultLaneGridRight(
  graphic: Graphics,
  gridRight: number,
  gridTop: number,
  gridBottom: number,
): void {
  graphic.rect(gridRight - 1, gridTop, 1, Math.max(1, gridBottom - gridTop)).fill({
    color: DEFAULT_THEME.railEdge,
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
  fillSlash(graphic, lane.x - 6, centerY - 36 * (0.4 + progress), lane.w + 12, 10, 8, DEFAULT_THEME.accent, 0.16 * fade);
  const core = Math.max(3, lane.w * (0.22 + 0.18 * progress));
  fillTriangle(graphic, centerX, centerY, core * 2.4, DEFAULT_THEME.accent, 0.35 * fade);
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
