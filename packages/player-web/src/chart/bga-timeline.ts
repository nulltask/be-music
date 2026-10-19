import { normalizeObjectKey, resolveBmsBase, type BeMusicJson } from '@be-music/json';
import { parseBmsBga, type BgaTimelines, type TimingResolver, buildBgaTimelines } from '@be-music/chart';
import { pickActiveBgaCue as pickActiveCoreBgaCue } from '@be-music/player/display';

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

/** One stage of a stitched NONSTOP chart as its BGA needs it (`NonstopStitchStage` from `@be-music/player/course`). */
export interface NonstopBgaStage {
  windowStart: number;
  windowEnd: number;
  bmpKeys: readonly string[];
  bgaFadeIn?: { start: number; end: number };
  bgaFadeOut?: { start: number; end: number };
}

/**
 * A stage's own base, layer and POOR BGA cues, the stitched timeline's cues split by the stage that owns each BMP key.
 */
export interface NonstopStageBgaTimeline {
  base: BgaCue[];
  layer: BgaCue[];
  poor: BgaCue[];
}

/**
 * Splits a stitched NONSTOP chart's base, layer and POOR BGA cues by stage (its stitched BMP keys are per stage), as
 * LR2 keeps a base, layer and POOR image per stage (OpenLR2 `LR2f.cpp` L12726-L12780). A cue that clears a layer (no
 * key) goes to the stage whose window it falls in.
 *
 * LR2 draws one stage's three images each frame: `LR2body.exe` 0x4350df picks the stage by the crossfade weights
 * (`bgaMixer`) and copies its base, layer and POOR image into the ones it draws, so a miss shows the POOR image of the
 * stage on screen, never a `#BMP00` fallback. The scenes draw each stage's stack at its crossfade opacity instead of
 * picking one at random, and a stage's POOR image replaces that stage's base and layer.
 */
export function splitNonstopBgaTimeline(
  timeline: { base: readonly BgaCue[]; layer: readonly BgaCue[]; poor?: readonly BgaCue[] },
  stages: readonly NonstopBgaStage[],
): NonstopStageBgaTimeline[] {
  const stageOfKey = new Map<string, number>();
  stages.forEach((stage, index) => stage.bmpKeys.forEach((key) => stageOfKey.set(key, index)));
  const stageAt = (seconds: number): number => {
    const index = stages.findIndex((stage) => seconds < stage.windowEnd);
    return index < 0 ? stages.length - 1 : index;
  };
  const split = stages.map((): NonstopStageBgaTimeline => ({ base: [], layer: [], poor: [] }));
  for (const track of ['base', 'layer', 'poor'] as const) {
    for (const cue of timeline[track] ?? []) {
      const stage = (cue.bmpKey !== undefined ? stageOfKey.get(cue.bmpKey) : undefined) ?? stageAt(cue.seconds);
      split[stage]?.[track].push(cue);
    }
  }
  return split;
}

/**
 * How opaque a NONSTOP stage's BGA is at `seconds`: fully inside its window, fading in over the 3 s before it and out
 * over the 3 s after it, linearly as LR2 mixes its stage BGA layers (OpenLR2 L27047-L27052).
 */
export function resolveNonstopBgaAlpha(stage: NonstopBgaStage, seconds: number): number {
  const ramp = (window: { start: number; end: number }): number =>
    window.end > window.start ? Math.min(1, Math.max(0, (seconds - window.start) / (window.end - window.start))) : 1;
  if (seconds < stage.windowStart) return stage.bgaFadeIn !== undefined ? ramp(stage.bgaFadeIn) : 0;
  if (seconds >= stage.windowEnd) return stage.bgaFadeOut !== undefined ? 1 - ramp(stage.bgaFadeOut) : 0;
  return 1;
}

/**
 * Whether beatoraja's miss layer shows at `seconds`: from the last miss (`missSeconds`, chart seconds) for
 * `durationSeconds`, whatever is judged in between, as `BGAProcessor.drawBGA` draws it for `misslayerDuration` ms from
 * `misslayertime`. A later miss restarts the window.
 */
export function isMissLayerShown(missSeconds: number | undefined, seconds: number, durationSeconds: number): boolean {
  return missSeconds !== undefined && seconds >= missSeconds && seconds - missSeconds < durationSeconds;
}

/** One BGA stack to draw: its base and layer cues (and a POOR image in place of them) at `alpha`. */
export interface BgaStack {
  alpha: number;
  baseCue: BgaCue | undefined;
  layerCue: BgaCue | undefined;
  /** Set only while a POOR is being shown and the stack has a POOR cue. */
  poorKey?: string | undefined;
}

/** What {@link resolveBgaStacks} reads: the chart's cues, a stitched NONSTOP chart's stages and the BGA rect's flags. */
export interface BgaStacksInput {
  /** The chart's cues; its POOR cues, when given, are picked during a POOR. */
  timeline: { base: readonly BgaCue[]; layer: readonly BgaCue[]; poor?: readonly BgaCue[] };
  /** A stitched NONSTOP chart's stages and their own cues (`splitNonstopBgaTimeline`), in stage order. */
  nonstop?: { stages: readonly NonstopBgaStage[]; timelines: readonly NonstopStageBgaTimeline[] } | undefined;
  /** The cue clock in chart seconds. */
  seconds: number;
  noBase?: boolean;
  noLayer?: boolean;
  /** A POOR is being shown. */
  inPoorWindow: boolean;
}

/**
 * The BGA stacks to draw at `seconds`: the chart's base and layer cues at full opacity, or for a stitched NONSTOP chart
 * each stage's own cues (and, during a POOR, its own POOR image) at the opacity of its crossfade
 * ({@link resolveNonstopBgaAlpha}), earlier stages first. Every skin family draws a NONSTOP chart's BGA from these.
 */
export function resolveBgaStacks(input: BgaStacksInput): BgaStack[] {
  const { seconds } = input;
  const pick = (
    timeline: { base: readonly BgaCue[]; layer: readonly BgaCue[]; poor?: readonly BgaCue[] },
    alpha: number,
  ): BgaStack => ({
    alpha,
    baseCue: input.noBase ? undefined : pickActiveBgaCue(timeline.base, seconds),
    layerCue: input.noLayer ? undefined : pickActiveBgaCue(timeline.layer, seconds),
    ...(input.inPoorWindow && timeline.poor !== undefined ? { poorKey: pickActiveBgaKey(timeline.poor, seconds) } : {}),
  });
  const nonstop = input.nonstop;
  if (nonstop === undefined) return [pick(input.timeline, 1)];
  return nonstop.stages.flatMap((stage, index) => {
    const timeline = nonstop.timelines[index];
    const alpha = resolveNonstopBgaAlpha(stage, seconds);
    return timeline !== undefined && alpha > 0 ? [pick(timeline, alpha)] : [];
  });
}
