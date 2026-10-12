import type { BeMusicJudgeTiming } from './types.ts';

/** A histogram of judgement timings (see {@link binJudgeTimings}). */
export interface BeMusicJudgeTimingHistogram {
  /** Width of each bin (ms). */
  binMs: number;
  /** Lower edge (ms) of `counts[0]`; bin `i` covers `originMs + i × binMs` up to (not including) the next edge. */
  originMs: number;
  /** Judgements per bin, earliest (most negative) first. */
  counts: readonly number[];
}

/**
 * Bins judgement timings by their signed offset for a timing histogram (negative = early / FAST, positive = late /
 * SLOW). Bin edges sit on multiples of `binMs`, so the bin starting at 0 holds the dead-on and slightly late presses.
 *
 * Without `rangeMs` the bins cover the earliest to the latest timing (no bins when `timings` is empty). With it they
 * cover `-rangeMs..rangeMs` whatever the timings, so histograms of different plays line up, and timings outside that
 * range are left out.
 *
 * @throws RangeError when `binMs` is not a positive finite number.
 */
export function binJudgeTimings(
  timings: readonly Pick<BeMusicJudgeTiming, 'deltaMs'>[],
  binMs = 1,
  rangeMs?: number,
): BeMusicJudgeTimingHistogram {
  if (!(Number.isFinite(binMs) && binMs > 0)) throw new RangeError(`binMs must be a positive number, got ${binMs}`);
  let min: number;
  let max: number;
  if (rangeMs !== undefined) {
    const range = Math.abs(rangeMs);
    min = -range;
    max = range;
  } else {
    min = Number.POSITIVE_INFINITY;
    max = Number.NEGATIVE_INFINITY;
    for (const { deltaMs } of timings) {
      if (!Number.isFinite(deltaMs)) continue;
      if (deltaMs < min) min = deltaMs;
      if (deltaMs > max) max = deltaMs;
    }
    if (min > max) return { binMs, originMs: 0, counts: [] };
  }
  const firstBin = Math.floor(min / binMs);
  const counts = Array.from({ length: Math.floor(max / binMs) - firstBin + 1 }, () => 0);
  for (const { deltaMs } of timings) {
    if (!Number.isFinite(deltaMs) || deltaMs < min || deltaMs > max) continue;
    counts[Math.floor(deltaMs / binMs) - firstBin]! += 1;
  }
  // `+ 0` turns a -0 origin (an all-late set starting in bin 0) into 0.
  return { binMs, originMs: firstBin * binMs + 0, counts };
}
