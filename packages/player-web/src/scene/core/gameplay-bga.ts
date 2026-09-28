import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import { normalizeObjectKey, resolveBmsBase, type BeMusicJson } from '@be-music/json';
import { parseBmsBga } from '@be-music/chart';
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
