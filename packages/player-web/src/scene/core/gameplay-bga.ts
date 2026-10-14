import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import { normalizeObjectKey, resolveBmsBase, type BeMusicJson } from '@be-music/json';
import { parseBmsBga, type BgaTimelines } from '@be-music/chart';
import { buildBgaTimelines, pickActiveBgaCue as pickActiveCoreBgaCue } from '@be-music/player/core/bga-timeline';

export interface BgaCue {
  seconds: number;
  bmpKey: string | undefined;
}

export interface BgaTextureLoadKeys {
  base: Set<string>;
  layer: Set<string>;
}

export function buildBgaTimeline(
  chart: BeMusicJson,
  resolver: TimingResolver,
): { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] } {
  return toBrowserBgaTimeline(buildBgaTimelines(chart, resolver));
}

/**
 * The browser scenes' BGA cue lists from a chart's BGA timelines (`ResolvedChart.bga`): the base and POOR cues as is,
 * and the two layer channels (`07` / `0A`) merged into one time-ordered layer.
 */
export function toBrowserBgaTimeline(timelines: BgaTimelines): { base: BgaCue[]; layer: BgaCue[]; poor: BgaCue[] } {
  const layer = [...timelines.layer, ...timelines.layer2]
    .sort((left, right) => left.seconds - right.seconds)
    .map(toBrowserBgaCue);
  return {
    base: timelines.base.map(toBrowserBgaCue),
    layer,
    poor: timelines.poor.map(toBrowserBgaCue),
  };
}

export function collectBgaTextureLoadKeys(
  chart: BeMusicJson,
  timeline: { base: readonly BgaCue[]; layer: readonly BgaCue[]; poor: readonly BgaCue[] },
  poorBgaFallbackKey: string | undefined,
): BgaTextureLoadKeys {
  const base = new Set<string>();
  const layer = new Set<string>();
  for (const cue of [...timeline.base, ...timeline.poor]) {
    if (cue.bmpKey) base.add(cue.bmpKey);
  }
  for (const cue of timeline.layer) {
    if (cue.bmpKey) layer.add(cue.bmpKey);
  }
  if (poorBgaFallbackKey) {
    base.add(poorBgaFallbackKey);
  }
  addReferencedSubRegionSources(chart, base);
  addReferencedSubRegionSources(chart, layer);
  return { base, layer };
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

function addReferencedSubRegionSources(chart: BeMusicJson, keys: Set<string>): void {
  const base = resolveBmsBase(chart);
  for (const [rawSlot, raw] of Object.entries(chart.bms.bga)) {
    const slot = normalizeObjectKey(rawSlot, base);
    if (!keys.has(slot)) continue;
    const parsed = parseBmsBga(raw, base);
    if (parsed) keys.add(parsed.sourceBmp);
  }
}

export function isVideoExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return /\.(mpg|mpeg|mp4|m4v|avi|mov|wmv|webm|mkv)$/u.test(lower);
}

/** Edge length of the BMS BGA canvas: every BGA rect on screen stands for this 256x256 image space. */
export const BMS_BGA_CANVAS_SIZE = 256;

export interface BgaRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Where a still BGA image of `imageWidth` x `imageHeight` px lands inside the BGA `rect`, which stands for the 256x256
 * BMS canvas. An image whose long edge fits the canvas keeps its own pixel size on it, centered horizontally and
 * against the top edge — the BM98 convention LR2 and beatoraja (`BGImageProcessor`) follow — so a 256x161 frame leaves
 * an empty band at the bottom rather than being stretched. A larger image fills the whole rect, as in LR2 and
 * beatoraja. `origin` places a `#BGAxx` sub-region at its authored `dx dy` on the canvas instead of centering it.
 */
export function resolveBgaImageRect(
  imageWidth: number,
  imageHeight: number,
  rect: BgaRect,
  origin?: { x: number; y: number },
): BgaRect {
  if (!(imageWidth > 0) || !(imageHeight > 0) || Math.max(imageWidth, imageHeight) > BMS_BGA_CANVAS_SIZE) {
    return { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
  }
  const scaleX = rect.w / BMS_BGA_CANVAS_SIZE;
  const scaleY = rect.h / BMS_BGA_CANVAS_SIZE;
  const canvasX = origin ? origin.x : Math.floor((BMS_BGA_CANVAS_SIZE - imageWidth) / 2);
  const canvasY = origin ? origin.y : 0;
  return {
    x: rect.x + canvasX * scaleX,
    y: rect.y + canvasY * scaleY,
    w: imageWidth * scaleX,
    h: imageHeight * scaleY,
  };
}

/** The BGA keys showing this frame, as `renderBga` resolved them (`#SWBGA` frames already picked). */
export interface ActiveBgaKeys {
  base: string | undefined;
  layer: string | undefined;
  /** Set only while a POOR is being shown. */
  poor: string | undefined;
}

/**
 * The `frame.bga` a skin that sets `drawsBga` receives: the image behind each active key (`resolve` reads the base or
 * layer texture map), with `poorActive` set when a POOR image is there to show in place of the base and layer.
 */
export function buildSkinBgaFrame<Image>(
  keys: ActiveBgaKeys,
  resolve: (key: string, track: 'base' | 'layer') => Image | undefined,
): { base?: Image; layer?: Image; poor?: Image; poorActive: boolean } {
  const base = keys.base !== undefined ? resolve(keys.base, 'base') : undefined;
  const layer = keys.layer !== undefined ? resolve(keys.layer, 'layer') : undefined;
  // POOR images decode like the base (no chroma key), so they live in the base map.
  const poor = keys.poor !== undefined ? resolve(keys.poor, 'base') : undefined;
  return {
    ...(base !== undefined ? { base } : {}),
    ...(layer !== undefined ? { layer } : {}),
    ...(poor !== undefined ? { poor } : {}),
    poorActive: poor !== undefined,
  };
}
