import type { Graphics } from 'pixi.js';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import { isScratchLaneForVariant } from '../gameplay-lanes.ts';
import { DEFAULT_THEME, fillParallelogram, fillSlash } from './theme.ts';

export interface DefaultLaneTone {
  top: number;
  body: number;
  bottom: number;
  cap: number;
  capLit: number;
  outline: number;
}

const TONE_CREAM: DefaultLaneTone = {
  top: 0xfff7ea,
  body: DEFAULT_THEME.paper,
  bottom: 0xb9a888,
  cap: 0xc4b496,
  capLit: 0xfff7ea,
  outline: 0x090605,
};

const TONE_CRIMSON: DefaultLaneTone = {
  top: 0xff6a5a,
  body: DEFAULT_THEME.crimson,
  bottom: DEFAULT_THEME.blood,
  cap: 0x4a0a0c,
  capLit: 0xff3a32,
  outline: 0x090605,
};

const TONE_HAZARD: DefaultLaneTone = {
  top: 0xfff3a8,
  body: DEFAULT_THEME.gold,
  bottom: 0xc9a010,
  cap: 0x3a2a08,
  capLit: 0xffe14a,
  outline: 0x090605,
};

/** Height of a skinless note body in design pixels. Bottom edge sits on the just-timing line. */
export const DEFAULT_NOTE_HEIGHT = 12;
const NOTE_SKEW = 4;

export function resolveDefaultLaneTone(
  channel: string,
  laneIndex: number,
  playVariant: ChartPlayVariant | undefined,
): DefaultLaneTone {
  if (isScratchLaneForVariant(channel, playVariant)) return TONE_HAZARD;
  const keyIndex = laneIndex % 10;
  if (keyIndex % 2 === 0) return TONE_CRIMSON;
  return TONE_CREAM;
}

/**
 * One skinless note: a parallelogram cut with a cream/crimson/gold fill. `y` is the just-timing line.
 */
export function drawDefaultNoteBody(graphic: Graphics, x: number, y: number, w: number, tone: DefaultLaneTone): void {
  const h = DEFAULT_NOTE_HEIGHT;
  const top = y - h;
  graphic
    .poly(notePoints(x, top, w, h, NOTE_SKEW))
    .fill(tone.body)
    .stroke({
      color: tone.outline,
      width: 1,
      alignment: 1,
    });
  graphic
    .poly(notePoints(x + 1, top + 1, Math.max(1, w - 2), 2, NOTE_SKEW - 0.4))
    .fill({ color: tone.top, alpha: 0.95 });
  graphic.poly(notePoints(x + 1, y - 3, Math.max(1, w - 2), 2, 0.6)).fill({ color: tone.bottom, alpha: 0.9 });
}

export function drawDefaultLongNoteBody(
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
  drawDefaultNoteBody(graphic, x, bottom, w, tone);
  drawDefaultNoteBody(graphic, x, top, w, tone);
}

export function drawDefaultMine(graphic: Graphics, laneX: number, y: number, laneW: number): void {
  const x = laneX + 2;
  const w = Math.max(4, laneW - 4);
  const h = DEFAULT_NOTE_HEIGHT;
  graphic
    .poly(notePoints(x, y - h, w, h, NOTE_SKEW))
    .fill(DEFAULT_THEME.blood)
    .stroke({
      color: DEFAULT_THEME.gold,
      width: 1,
      alignment: 1,
    });
  const stripeStep = 7;
  for (let sx = x - 10; sx < x + w; sx += stripeStep) {
    graphic
      .poly([sx, y - 1, sx + 3, y - 1, sx + 3 + 7, y - h + 1, sx + 7, y - h + 1])
      .fill({ color: DEFAULT_THEME.gold, alpha: 0.7 });
  }
}

export function paintDefaultLane(
  layer: Graphics,
  lane: { x: number; w: number; top: number; bottom: number },
  options: {
    tone: DefaultLaneTone;
    scratch: boolean;
    laserAlpha: number;
    beatImpulse: number;
  },
): void {
  const { x, w, top, bottom } = lane;
  const laneHeight = Math.max(1, bottom - top);
  const pulse = options.beatImpulse;

  layer.rect(x, top, w, laneHeight).fill({
    color: options.tone.body,
    alpha: options.scratch ? 0.07 : 0.035,
  });
  layer.rect(x, top, 1, laneHeight).fill({ color: DEFAULT_THEME.railEdge, alpha: 0.55 });

  const laserAlpha = options.laserAlpha;
  if (laserAlpha > 0) {
    const beamHeight = Math.min(laneHeight, 190);
    const slices = 5;
    for (let slice = 0; slice < slices; slice += 1) {
      const sliceRatio = slice / slices;
      const sliceH = beamHeight / slices;
      const sliceY = bottom - beamHeight + sliceRatio * beamHeight;
      fillParallelogram(
        layer,
        x + 1,
        sliceY,
        w - 2,
        sliceH + 1,
        3 * (1 - sliceRatio),
        options.tone.body,
        (0.06 + 0.48 * sliceRatio * sliceRatio) * laserAlpha,
      );
    }
    fillSlash(layer, x - 2, bottom - 28, w + 8, 10, 4, DEFAULT_THEME.white, 0.28 * laserAlpha);
  }

  layer.rect(x, bottom - 16, w, 12).fill({ color: DEFAULT_THEME.crimson, alpha: 0.1 + 0.16 * pulse });
  fillSlash(layer, x - 4, bottom - 6, w + 10, 5, 2, DEFAULT_THEME.crimson, 0.45 + 0.4 * pulse);
  layer.rect(x, bottom - 2, w, 2).fill({ color: DEFAULT_THEME.paper, alpha: 0.7 + 0.3 * pulse });
  layer.rect(x, bottom, w, 1).fill({ color: DEFAULT_THEME.white, alpha: 0.85 + 0.15 * pulse });

  const pressed = laserAlpha > 0.6;
  const capTop = bottom + 3;
  const capHeight = 14;
  fillParallelogram(
    layer,
    x + 1,
    capTop,
    Math.max(2, w - 2),
    capHeight,
    pressed ? 3 : 1,
    pressed ? options.tone.capLit : options.tone.cap,
    pressed ? 1 : 0.92,
  );
  layer.rect(x + 1, capTop, Math.max(2, w - 2), 2).fill({ color: DEFAULT_THEME.white, alpha: pressed ? 0.8 : 0.12 });
  if (pressed) {
    fillSlash(layer, x, capTop - 4, w, 4, 1, options.tone.top, 0.95);
  }
}

export function paintDefaultLaneGridRight(layer: Graphics, grid: { top: number; bottom: number; right: number }): void {
  layer.rect(grid.right - 1, grid.top, 1, Math.max(1, grid.bottom - grid.top)).fill({
    color: DEFAULT_THEME.railEdge,
    alpha: 0.55,
  });
}

/**
 * Skinless bomb: an expanding X-slash with a white-hot diamond core. `progress` is 0 at trigger, 1 at cleanup.
 */
export function drawDefaultBomb(
  graphic: Graphics,
  lane: { x: number; w: number; bottom: number },
  progress: number,
): void {
  const fade = 1 - progress;
  const eased = 1 - (1 - progress) * (1 - progress);
  const centerX = lane.x + lane.w / 2;
  const centerY = lane.bottom - Math.max(5, lane.w * 0.18);
  const span = Math.max(10, lane.w * (0.9 + 1.8 * eased));
  const thick = Math.max(2, lane.w * (0.22 - progress * 0.08));

  graphic
    .rect(lane.x + lane.w * 0.12, centerY - span, lane.w * 0.76, span)
    .fill({ color: DEFAULT_THEME.crimson, alpha: 0.12 * fade });

  const slash = (angleSign: number, color: number, extra = 0): void => {
    const dx = (span + extra) * 0.72;
    const dy = (span + extra) * 0.42 * angleSign;
    graphic
      .moveTo(centerX - dx, centerY - dy)
      .lineTo(centerX + dx, centerY + dy)
      .stroke({ color, width: thick, alpha: 0.9 * fade, cap: 'square', alignment: 0.5 });
  };
  slash(1, DEFAULT_THEME.crimson, 2);
  slash(-1, DEFAULT_THEME.crimson, 2);
  slash(1, DEFAULT_THEME.paper, -span * 0.12);
  slash(-1, DEFAULT_THEME.gold, -span * 0.18);

  const diamond = Math.max(3, lane.w * (0.22 + 0.1 * eased));
  graphic
    .poly([
      centerX,
      centerY - diamond,
      centerX + diamond * 0.7,
      centerY,
      centerX,
      centerY + diamond,
      centerX - diamond * 0.7,
      centerY,
    ])
    .fill({ color: DEFAULT_THEME.white, alpha: 0.85 * fade });
}

function notePoints(x: number, y: number, w: number, h: number, skew: number): number[] {
  return [x + skew, y, x + w + skew, y, x + w, y + h, x, y + h];
}
