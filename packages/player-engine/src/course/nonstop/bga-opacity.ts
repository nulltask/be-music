import {
  buildBGAOpacityTimelines,
  pickBGAOpacity,
  pickBGATint,
  type BGAOpacityTimelines,
  type ResolvedChart,
} from '@be-music/chart-model';
import type { NonstopStagePlacement } from './plan.ts';

const TRACK_CHANNELS = [
  ['base', '0B'],
  ['layer', '0C'],
  ['layer2', '0D'],
  ['poor', '0E'],
] as const;

/** Stage-owned histories stay independent during BGA crossfades; cue times use the stitched clock. */
export function placeNonstopBGAOpacity(chart: ResolvedChart, placement: NonstopStagePlacement): BGAOpacityTimelines {
  const source = buildBGAOpacityTimelines(chart.source, chart.timing);
  const result: BGAOpacityTimelines = { base: [], layer: [], layer2: [], poor: [] };
  const freeze = chart.reversal?.seconds ?? Number.POSITIVE_INFINITY;
  for (const [track] of TRACK_CHANNELS) {
    result[track] = source[track]
      .filter((cue) => cue.seconds <= freeze)
      .map((cue) => ({
        seconds: placement.offsetSeconds + cue.seconds / placement.rate,
        opacity: cue.opacity,
        ...(cue.tint !== undefined ? { tint: cue.tint } : {}),
      }));
  }
  return result;
}

export function hasBGAOpacity(timelines: BGAOpacityTimelines): boolean {
  return TRACK_CHANNELS.some(([track]) => timelines[track].length > 0);
}

/**
 * The flattened chart follows stage ownership windows. Seed every stage's four tracks with their effective values
 * at its window start, then copy later changes in that window. A stage without opacity commands therefore restores
 * opaque white defaults, while a command in a trimmed leading interval still supplies the correct initial value.
 * If any stage has RGB controls, emit full ARGB tuples on A1–A4 for allocation by the composer; otherwise keep the
 * original hexadecimal opacity channel form. Full ARGB also represents alpha zero, which 0B–0E cannot encode.
 */
export function flattenNonstopBGAOpacity(
  stages: readonly {
    opacity: BGAOpacityTimelines;
    windowStart: number;
    windowEnd: number;
  }[],
): Array<{ seconds: number; channel: string; value: string; stage: number }> {
  if (!stages.some((entry) => hasBGAOpacity(entry.opacity))) return [];
  const result: Array<{ seconds: number; channel: string; value: string; stage: number }> = [];
  const hasTint = stages.some((entry) =>
    TRACK_CHANNELS.some(([track]) => entry.opacity[track].some((cue) => cue.tint !== undefined)),
  );
  stages.forEach((entry, stage) => {
    const start = Math.max(0, entry.windowStart);
    for (const [track, channel] of TRACK_CHANNELS) {
      const add = (seconds: number, opacity: number): void => {
        const tint = pickBGATint(entry.opacity[track], seconds);
        result.push({
          seconds,
          channel: hasTint ? `A${TRACK_CHANNELS.findIndex(([name]) => name === track) + 1}` : channel,
          value: hasTint
            ? [Math.round(opacity * 255), (tint >>> 16) & 255, (tint >>> 8) & 255, tint & 255].join(',')
            : Math.round(opacity * 255)
                .toString(16)
                .toUpperCase()
                .padStart(2, '0'),
          stage,
        });
      };
      add(start, pickBGAOpacity(entry.opacity[track], start));
      for (const cue of entry.opacity[track]) {
        if (cue.seconds > start && cue.seconds < entry.windowEnd) add(cue.seconds, cue.opacity);
      }
    }
  });
  return result;
}
