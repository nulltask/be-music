import { normalizeChannel, type BeMusicJSON } from '@be-music/chart-source';
import type { BGATimingResolver } from './bga.ts';

export interface BGAOpacityCue {
  seconds: number;
  opacity: number;
}

export interface BGAOpacityTimelines {
  base: BGAOpacityCue[];
  layer: BGAOpacityCue[];
  layer2: BGAOpacityCue[];
  poor: BGAOpacityCue[];
}

const OPACITY_TRACKS: Readonly<Record<string, keyof BGAOpacityTimelines>> = {
  '0B': 'base',
  '0C': 'layer',
  '0D': 'layer2',
  '0E': 'poor',
};

/** BMS opacity channels carry hexadecimal bytes, independently of the chart's resource-id base. 00 is a rest. */
export function buildBGAOpacityTimelines(
  chart: BeMusicJSON,
  resolver: Pick<BGATimingResolver, 'eventToSeconds'>,
): BGAOpacityTimelines {
  const result: BGAOpacityTimelines = { base: [], layer: [], layer2: [], poor: [] };
  for (const event of chart.events) {
    const track = OPACITY_TRACKS[normalizeChannel(event.channel)];
    if (!track || !/^[0-9a-f]{2}$/iu.test(event.value) || event.value === '00') continue;
    const seconds = resolver.eventToSeconds(event);
    if (!Number.isFinite(seconds)) continue;
    result[track].push({ seconds, opacity: Number.parseInt(event.value, 16) / 255 });
  }
  for (const cues of [result.base, result.layer, result.layer2, result.poor]) {
    cues.sort((left, right) => left.seconds - right.seconds);
  }
  return result;
}

/** The last authored opacity at or before chart time; opaque before the first cue. Safe to query after a seek. */
export function pickBGAOpacity(cues: readonly BGAOpacityCue[], seconds: number): number {
  if (Number.isNaN(seconds)) return 1;
  let low = 0;
  let high = cues.length - 1;
  let opacity = 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = cues[middle]!;
    if (cue.seconds <= seconds) {
      opacity = cue.opacity;
      low = middle + 1;
    } else high = middle - 1;
  }
  return opacity;
}
