import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import type { BeMusicJson } from '@be-music/json';
import { buildBgaTimelines, pickActiveBgaCue as pickActiveCoreBgaCue } from '@be-music/player/core/bga-timeline';
import { SPEC_BGA_CANVAS_SIZE } from './pixi-gameplay-constants.ts';

export interface BgaCue {
  seconds: number;
  bmpKey: string | undefined;
}

export function buildBgaTimeline(
  chart: BeMusicJson,
  resolver: TimingResolver,
): { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] } {
  const timelines = buildBgaTimelines(chart, resolver);
  const layer = [...timelines.layer, ...timelines.layer2]
    .sort((left, right) => left.seconds - right.seconds)
    .map(toBrowserBgaCue);
  return {
    base: timelines.base.map(toBrowserBgaCue),
    layer,
    poor: timelines.poor.map(toBrowserBgaCue),
  };
}

export function pickActiveBgaKey(cues: ReadonlyArray<BgaCue>, seconds: number): string | undefined {
  return pickActiveBgaCue(cues, seconds)?.bmpKey;
}

export function pickActiveBgaCue(cues: ReadonlyArray<BgaCue>, seconds: number): BgaCue | undefined {
  return pickActiveCoreBgaCue(cues, seconds);
}

function toBrowserBgaCue(cue: { seconds: number; key?: string }): BgaCue {
  return { seconds: cue.seconds, bmpKey: cue.key };
}

export function fitTextureWithinSpecCanvas(
  sourceWidth: number,
  sourceHeight: number,
): { offsetX: number; offsetY: number; width: number; height: number } {
  const safeW = Number.isFinite(sourceWidth) ? Math.max(1, Math.floor(sourceWidth)) : 1;
  const safeH = Number.isFinite(sourceHeight) ? Math.max(1, Math.floor(sourceHeight)) : 1;
  const widthScale = SPEC_BGA_CANVAS_SIZE / safeW;
  const heightScale = SPEC_BGA_CANVAS_SIZE / safeH;
  const scale = Math.min(1, widthScale, heightScale);
  const fittedWidth = Math.max(1, Math.floor(safeW * scale));
  const fittedHeight = Math.max(1, Math.floor(safeH * scale));
  const offsetX = Math.floor((SPEC_BGA_CANVAS_SIZE - fittedWidth) / 2);
  const offsetY = 0;
  return { offsetX, offsetY, width: fittedWidth, height: fittedHeight };
}

export function isVideoExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return /\.(mpg|mpeg|mp4|m4v|avi|mov|wmv|webm|mkv)$/u.test(lower);
}
