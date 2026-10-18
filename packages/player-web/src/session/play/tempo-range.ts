import type { TempoPoint } from '@be-music/audio-renderer/triggers';

/**
 * The lowest, highest, and main (longest-held) BPM of a play, from its tempo points: the built-in HUD shows them, and
 * the play log's visible time reads the main one. Not the select screen's `ChartBpmRange` (`chart/bpm-range.ts`).
 */
export interface PlayTempoRange {
  minBpm: number;
  maxBpm: number;
  mainBpm: number;
}

/**
 * Works out a chart's BPM range from its tempo points. `mainBpm` is the BPM held for the longest time in total (each
 * point holds until the next one, the last until `endSeconds`); a tie goes to the BPM reached first. Points with a
 * non-positive or non-finite BPM (stops encoded as BPM 0, broken headers) are ignored. Returns `fallbackBpm` for all
 * three when no point is usable, and `undefined` when there is no usable fallback either.
 */
export function resolvePlayTempoRange(
  tempoPoints: readonly Pick<TempoPoint, 'bpm' | 'seconds'>[],
  endSeconds: number,
  fallbackBpm?: number,
): PlayTempoRange | undefined {
  let minBpm = Number.POSITIVE_INFINITY;
  let maxBpm = Number.NEGATIVE_INFINITY;
  const heldSeconds = new Map<number, number>();
  for (let index = 0; index < tempoPoints.length; index += 1) {
    const point = tempoPoints[index]!;
    const { bpm } = point;
    if (!Number.isFinite(bpm) || bpm <= 0) continue;
    if (bpm < minBpm) minBpm = bpm;
    if (bpm > maxBpm) maxBpm = bpm;
    const next = tempoPoints[index + 1];
    const start = Math.max(0, point.seconds);
    const end = next ? next.seconds : Math.max(endSeconds, start);
    heldSeconds.set(bpm, (heldSeconds.get(bpm) ?? 0) + Math.max(0, end - start));
  }
  if (minBpm > maxBpm) {
    if (fallbackBpm === undefined || !Number.isFinite(fallbackBpm) || fallbackBpm <= 0) return undefined;
    return { minBpm: fallbackBpm, maxBpm: fallbackBpm, mainBpm: fallbackBpm };
  }
  let mainBpm = minBpm;
  let longest = Number.NEGATIVE_INFINITY;
  // Map iteration follows insertion order, so the strict `>` keeps the earliest BPM on a tie.
  for (const [bpm, seconds] of heldSeconds) {
    if (seconds > longest) {
      longest = seconds;
      mainBpm = bpm;
    }
  }
  return { minBpm, maxBpm, mainBpm };
}
