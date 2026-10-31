import { normalizeChannel, normalizeObjectKey, resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import type { BGATimingResolver } from './bga.ts';
import { parseBmsARGB } from './bmp-directives.ts';

export interface BGAOpacityCue {
  seconds: number;
  opacity: number;
  /** Multiplicative RGB from A1–A4. Omitted means white. */
  tint?: number;
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
  A1: 'base',
  A2: 'layer',
  A3: 'layer2',
  A4: 'poor',
};

/**
 * Build independent plane controls. A1–A4 set RGB and alpha; 0B–0E replace alpha while retaining RGB.
 * Opacity bytes are hexadecimal regardless of resource-id base. 00 is a rest on both channel families.
 * Equal-time controls follow source event order, with the later event winning.
 */
export function buildBGAOpacityTimelines(
  chart: BeMusicJSON,
  resolver: Pick<BGATimingResolver, 'eventToSeconds'>,
): BGAOpacityTimelines {
  const result: BGAOpacityTimelines = { base: [], layer: [], layer2: [], poor: [] };
  for (const event of chart.events) {
    const channel = normalizeChannel(event.channel);
    const track = OPACITY_TRACKS[channel];
    if (!track || /^0+$/u.test(event.value)) continue;
    const seconds = resolver.eventToSeconds(event);
    if (!Number.isFinite(seconds)) continue;
    if (channel.startsWith('A')) {
      const key = normalizeObjectKey(event.value, resolveBMSBase(chart), chart.sourceFormat === 'bmson');
      const raw = chart.bms.argb[key];
      // Keep malformed decimal suffixes/clamping in the legacy parser out of the authored control timeline.
      if (typeof raw !== 'string' || !/^(?:\s*\d+\s*,){3}\s*\d+\s*$/u.test(raw)) continue;
      const fields = raw.split(',').map(Number);
      if (fields.some((field) => field < 0 || field > 255)) continue;
      const argb = parseBmsARGB(raw)!;
      result[track].push({ seconds, opacity: argb.a / 255, tint: (argb.r << 16) | (argb.g << 8) | argb.b });
    } else if (/^[0-9a-f]{2}$/iu.test(event.value))
      result[track].push({ seconds, opacity: Number.parseInt(event.value, 16) / 255 });
  }
  for (const cues of [result.base, result.layer, result.layer2, result.poor]) {
    cues.sort((left, right) => left.seconds - right.seconds);
    let tint: number | undefined;
    for (const cue of cues) {
      if (cue.tint !== undefined) tint = cue.tint;
      else if (tint !== undefined) cue.tint = tint;
    }
  }
  return result;
}

/** RGB multiplier at chart time, retaining color through opacity-only changes. White before the first cue. */
export function pickBGATint(cues: readonly BGAOpacityCue[], seconds: number): number {
  if (Number.isNaN(seconds)) return 0xffffff;
  let low = 0;
  let high = cues.length - 1;
  let tint = 0xffffff;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const cue = cues[middle]!;
    if (cue.seconds <= seconds) {
      tint = cue.tint ?? 0xffffff;
      low = middle + 1;
    } else high = middle - 1;
  }
  return tint;
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
