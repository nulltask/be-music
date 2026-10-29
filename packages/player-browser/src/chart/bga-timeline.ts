import { normalizeObjectKey, resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import {
  pickBGAOpacity,
  type BGAOpacityTimelines,
  parseBmsBGA,
  type BGATimelines,
  type TimingResolver,
  buildBGATimelines,
} from '@be-music/chart-model';
import { pickActiveBGACue as pickActiveCoreBGACue } from '@be-music/player-engine/display';

export interface BGACue {
  seconds: number;
  bmpKey: string | undefined;
}

export interface BGATextureLoadKeys {
  base: Set<string>;
  layer: Set<string>;
}

export function buildBGATimeline(
  chart: BeMusicJSON,
  resolver: TimingResolver,
): { base: BGACue[]; layer: BGACue[]; layer2: BGACue[]; poor: BGACue[] } {
  return toBrowserBGATimeline(buildBGATimelines(chart, resolver));
}

/**
 * The browser scenes' BGA cue lists from a chart's BGA timelines (`ResolvedChart.bga`): the base and POOR cues as is,
 * with independent layer channels (`07` / `0A`).
 */
export function toBrowserBGATimeline(timelines: BGATimelines): {
  base: BGACue[];
  layer: BGACue[];
  layer2: BGACue[];
  poor: BGACue[];
} {
  return {
    base: timelines.base.map(toBrowserBGACue),
    layer: timelines.layer.map(toBrowserBGACue),
    layer2: timelines.layer2.map(toBrowserBGACue),
    poor: timelines.poor.map(toBrowserBGACue),
  };
}

export function collectBGATextureLoadKeys(
  chart: BeMusicJSON,
  timeline: { base: readonly BGACue[]; layer: readonly BGACue[]; layer2?: readonly BGACue[]; poor: readonly BGACue[] },
  poorBGAFallbackKey: string | undefined,
): BGATextureLoadKeys {
  const base = new Set<string>();
  const layer = new Set<string>();
  for (const cue of [...timeline.base, ...timeline.poor]) {
    if (cue.bmpKey) base.add(cue.bmpKey);
  }
  for (const cue of [...timeline.layer, ...(timeline.layer2 ?? [])]) {
    if (cue.bmpKey) layer.add(cue.bmpKey);
  }
  if (poorBGAFallbackKey) {
    base.add(poorBGAFallbackKey);
  }
  addReferencedSubRegionSources(chart, base);
  addReferencedSubRegionSources(chart, layer);
  return { base, layer };
}

export function pickActiveBGAKey(cues: ReadonlyArray<BGACue>, seconds: number): string | undefined {
  return pickActiveBGACue(cues, seconds)?.bmpKey;
}

export function pickActiveBGACue(cues: ReadonlyArray<BGACue>, seconds: number): BGACue | undefined {
  return pickActiveCoreBGACue(cues, seconds);
}

function toBrowserBGACue(cue: { seconds: number; key?: string }): BGACue {
  return { seconds: cue.seconds, bmpKey: cue.key };
}

function addReferencedSubRegionSources(chart: BeMusicJSON, keys: Set<string>): void {
  const base = resolveBMSBase(chart);
  for (const [rawSlot, raw] of Object.entries(chart.bms.bga)) {
    const slot = normalizeObjectKey(rawSlot, base, chart.sourceFormat === 'bmson');
    if (!keys.has(slot)) continue;
    const parsed = parseBmsBGA(raw, base, chart.sourceFormat === 'bmson');
    if (parsed) keys.add(parsed.sourceBMP);
  }
}

export function isVideoExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return /\.(mpg|mpeg|mp4|m4v|avi|mov|wmv|webm|mkv)$/u.test(lower);
}

/** Edge length of the BMS BGA canvas: every BGA rect on screen stands for this 256x256 image space. */
export const BMS_BGA_CANVAS_SIZE = 256;

export interface BGARect {
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
export function resolveBGAImageRect(
  imageWidth: number,
  imageHeight: number,
  rect: BGARect,
  origin?: { x: number; y: number },
): BGARect {
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

/** The BGA keys showing this frame, as `renderBGA` resolved them (`#SWBGA` frames already picked). */
export interface ActiveBGAKeys {
  opacity?: Record<keyof BGAOpacityTimelines, number>;
  base: string | undefined;
  layer: string | undefined;
  layer2?: string | undefined;
  /** Set only while a POOR is being shown. */
  poor: string | undefined;
  poorOverlays?: boolean;
}

/**
 * The `frame.bga` a skin that sets `drawsBGA` receives: the image behind each active key (`resolve` reads the base or
 * layer texture map), with `poorActive` set when a POOR image is there to show in place of the base and layer.
 */
export function buildSkinBGAFrame<Image>(
  keys: ActiveBGAKeys,
  resolve: (key: string, track: 'base' | 'layer') => Image | undefined,
  subRegionOrigins?: ReadonlyMap<string, { x: number; y: number }>,
): {
  base?: Image;
  layer?: Image;
  layer2?: Image;
  poor?: Image;
  poorActive: boolean;
  poorOverlays?: boolean;
  opacity?: Record<keyof BGAOpacityTimelines, number>;
  origins?: Partial<Record<keyof BGAOpacityTimelines, { x: number; y: number }>>;
} {
  const base = keys.base !== undefined ? resolve(keys.base, 'base') : undefined;
  const layer = keys.layer !== undefined ? resolve(keys.layer, 'layer') : undefined;
  const layer2 = keys.layer2 !== undefined ? resolve(keys.layer2, 'layer') : undefined;
  // POOR images decode like the base (no chroma key), so they live in the base map.
  const poor = keys.poor !== undefined ? resolve(keys.poor, 'base') : undefined;
  const origins: Partial<Record<keyof BGAOpacityTimelines, { x: number; y: number }>> = {};
  for (const track of ['base', 'layer', 'layer2', 'poor'] as const) {
    const key = keys[track];
    const origin = key !== undefined ? subRegionOrigins?.get(key) : undefined;
    if (origin !== undefined) origins[track] = origin;
  }
  return {
    ...(base !== undefined ? { base } : {}),
    ...(layer !== undefined ? { layer } : {}),
    ...(layer2 !== undefined ? { layer2 } : {}),
    ...(poor !== undefined ? { poor } : {}),
    poorActive: poor !== undefined,
    ...(Object.keys(origins).length > 0 ? { origins } : {}),
    ...(keys.opacity !== undefined ? { opacity: keys.opacity } : {}),
    ...(keys.poorOverlays ? { poorOverlays: true } : {}),
  };
}

/** One stage of a stitched NONSTOP chart as its BGA needs it (`NonstopStitchStage` from `@be-music/player-engine/course`). */
export interface NonstopBGAStage {
  bgaOpacity?: BGAOpacityTimelines;
  poorBGAMode?: 0 | 1 | 2;
  windowStart: number;
  windowEnd: number;
  bmpKeys: readonly string[];
  bgaFadeIn?: { start: number; end: number };
  bgaFadeOut?: { start: number; end: number };
}

/**
 * A stage's own base, layer and POOR BGA cues, the stitched timeline's cues split by the stage that owns each BMP key.
 */
export interface NonstopStageBGATimeline {
  base: BGACue[];
  layer: BGACue[];
  layer2?: BGACue[];
  poor: BGACue[];
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
export function splitNonstopBGATimeline(
  timeline: { base: readonly BGACue[]; layer: readonly BGACue[]; layer2?: readonly BGACue[]; poor?: readonly BGACue[] },
  stages: readonly NonstopBGAStage[],
): NonstopStageBGATimeline[] {
  const stageOfKey = new Map<string, number>();
  stages.forEach((stage, index) => stage.bmpKeys.forEach((key) => stageOfKey.set(key, index)));
  const stageAt = (seconds: number): number => {
    const index = stages.findIndex((stage) => seconds < stage.windowEnd);
    return index < 0 ? stages.length - 1 : index;
  };
  const split = stages.map((): NonstopStageBGATimeline => ({ base: [], layer: [], layer2: [], poor: [] }));
  for (const track of ['base', 'layer', 'layer2', 'poor'] as const) {
    for (const cue of timeline[track] ?? []) {
      const stage = (cue.bmpKey !== undefined ? stageOfKey.get(cue.bmpKey) : undefined) ?? stageAt(cue.seconds);
      split[stage]?.[track]?.push(cue);
    }
  }
  return split;
}

/**
 * How opaque a NONSTOP stage's BGA is at `seconds`: fully inside its window, fading in over the 3 s before it and out
 * over the 3 s after it, linearly as LR2 mixes its stage BGA layers (OpenLR2 L27047-L27052).
 */
export function resolveNonstopBGAAlpha(stage: NonstopBGAStage, seconds: number): number {
  const ramp = (window: { start: number; end: number }): number =>
    window.end > window.start ? Math.min(1, Math.max(0, (seconds - window.start) / (window.end - window.start))) : 1;
  if (seconds < stage.windowStart) return stage.bgaFadeIn !== undefined ? ramp(stage.bgaFadeIn) : 0;
  if (seconds >= stage.windowEnd) return stage.bgaFadeOut !== undefined ? 1 - ramp(stage.bgaFadeOut) : 0;
  return 1;
}

/**
 * Whether a miss layer shows at `seconds`: from the last miss (`missSeconds`, on the same second clock) for
 * `durationSeconds`, whatever is judged in between, as `BGAProcessor.drawBGA` draws it for `misslayerDuration` ms from
 * `misslayertime`. The shared built-in/LR2 renderer supplies pause-aware elapsed seconds. A later miss restarts the window.
 */
export function isMissLayerShown(missSeconds: number | undefined, seconds: number, durationSeconds: number): boolean {
  return missSeconds !== undefined && seconds >= missSeconds && seconds - missSeconds < durationSeconds;
}

/** One BGA stack to draw: its base and layer cues (and a POOR image in place of them) at `alpha`. */
export interface BGAStack {
  opacity?: Record<keyof BGAOpacityTimelines, number>;
  poorOverlays?: boolean;
  alpha: number;
  baseCue: BGACue | undefined;
  layerCue: BGACue | undefined;
  layer2Cue?: BGACue | undefined;
  /** Set only while a POOR is being shown and the stack has a POOR cue. */
  poorKey?: string | undefined;
}

/** What {@link resolveBGAStacks} reads: the chart's cues, a stitched NONSTOP chart's stages and the BGA rect's flags. */
export interface BGAStacksInput {
  poorBGAMode?: 0 | 1 | 2;
  /** The chart's cues; its POOR cues, when given, are picked during a POOR. */
  timeline: {
    base: readonly BGACue[];
    layer: readonly BGACue[];
    layer2?: readonly BGACue[];
    poor?: readonly BGACue[];
    opacity?: BGAOpacityTimelines;
  };
  /** A stitched NONSTOP chart's stages and their own cues (`splitNonstopBGATimeline`), in stage order. */
  nonstop?: { stages: readonly NonstopBGAStage[]; timelines: readonly NonstopStageBGATimeline[] } | undefined;
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
 * ({@link resolveNonstopBGAAlpha}), earlier stages first. Every skin family draws a NONSTOP chart's BGA from these.
 */
export function resolveBGAStacks(input: BGAStacksInput): BGAStack[] {
  const { seconds } = input;
  const pick = (
    timeline: {
      base: readonly BGACue[];
      layer: readonly BGACue[];
      layer2?: readonly BGACue[];
      poor?: readonly BGACue[];
    },
    alpha: number,
    mode: 0 | 1 | 2 = 0,
    opacity?: BGAOpacityTimelines,
  ): BGAStack => ({
    ...(opacity !== undefined
      ? {
          opacity: {
            base: pickBGAOpacity(opacity.base, seconds),
            layer: pickBGAOpacity(opacity.layer, seconds),
            layer2: pickBGAOpacity(opacity.layer2, seconds),
            poor: pickBGAOpacity(opacity.poor, seconds),
          },
        }
      : {}),
    alpha,
    baseCue: input.noBase ? undefined : pickActiveBGACue(timeline.base, seconds),
    layerCue: input.noLayer ? undefined : pickActiveBGACue(timeline.layer, seconds),
    ...(timeline.layer2 !== undefined
      ? { layer2Cue: input.noLayer ? undefined : pickActiveBGACue(timeline.layer2, seconds) }
      : {}),
    ...(mode === 1 ? { poorOverlays: true } : {}),
    ...(input.inPoorWindow && mode !== 2 && timeline.poor !== undefined
      ? { poorKey: pickActiveBGAKey(timeline.poor, seconds) }
      : {}),
  });
  const nonstop = input.nonstop;
  if (nonstop === undefined) return [pick(input.timeline, 1, input.poorBGAMode, input.timeline.opacity)];
  return nonstop.stages.flatMap((stage, index) => {
    const timeline = nonstop.timelines[index];
    const alpha = resolveNonstopBGAAlpha(stage, seconds);
    return timeline !== undefined && alpha > 0 ? [pick(timeline, alpha, stage.poorBGAMode, stage.bgaOpacity)] : [];
  });
}
