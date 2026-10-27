/**
 * The automatic judge-timing adjustment a player picks: none, beatoraja's calibration, or LR2's `autojudge` ON (1) or
 * SILENT (2). Replays recorded before the modes existed store a boolean (`true` for beatoraja's), which
 * {@link resolveJudgeTimingAutoAdjust} reads.
 */
export type JudgeTimingAutoAdjust = 'OFF' | 'BEATORAJA' | 'LR2-ON' | 'LR2-SILENT';

/** Every {@link JudgeTimingAutoAdjust}, in the order a selector lists them. */
export const JUDGE_TIMING_AUTO_ADJUST_MODES: readonly JudgeTimingAutoAdjust[] = [
  'OFF',
  'BEATORAJA',
  'LR2-ON',
  'LR2-SILENT',
];

/** The mode a stored or recorded value names: a mode as is, `true` beatoraja's and anything else OFF. */
export function resolveJudgeTimingAutoAdjust(value: unknown): JudgeTimingAutoAdjust {
  if (value === true) return 'BEATORAJA';
  return (JUDGE_TIMING_AUTO_ADJUST_MODES as readonly unknown[]).includes(value)
    ? (value as JudgeTimingAutoAdjust)
    : 'OFF';
}

/** Whether a mode is one of LR2's (ON or SILENT). */
export function isLR2JudgeTimingAutoAdjust(mode: JudgeTimingAutoAdjust | undefined): boolean {
  return mode === 'LR2-ON' || mode === 'LR2-SILENT';
}

/**
 * beatoraja 0.8.9 JudgeManager.updateMicro: PG/GR/GD within ±150 ms adjust by
 * nearest 30 ms, with half ties away from zero. Our signed delta is late-positive;
 * upstream mfast is early-positive. Automatic updates bypass the launcher's ±500 clamp.
 */
export function adjustBeatorajaJudgeTiming(currentMs: number, judge: string, deltaMs: number | undefined): number {
  if (!['PERFECT', 'GREAT', 'GOOD'].includes(judge) || deltaMs === undefined || !Number.isFinite(deltaMs))
    return currentMs;
  const deltaUs = Math.round(deltaMs * 1000);
  if (Math.abs(deltaUs) > 150000) return currentMs;
  return currentMs + Math.trunc((deltaUs + (deltaUs >= 0 ? 15000 : -15000)) / 30000);
}

/** LR2's adjustment window: the hits sampled since the last step (`midcount`) and their summed offsets (`midsum`). */
export interface LR2JudgeTimingSamples {
  count: number;
  sumMs: number;
}

/** An empty window, as a play starts with (LR2 leaves the reset at play start undetermined; be-music resets). */
export function createLR2JudgeTimingSamples(): LR2JudgeTimingSamples {
  return { count: 0, sumMs: 0 };
}

/**
 * LR2 beta3 (OpenLR2 `LR2f.cpp` 7472-7511): every PGREAT, GREAT, GOOD or BAD hit of a normal note adds its signed
 * offset (late-positive, in LR2's whole milliseconds) to the window. Misses, empty POORs and long notes are never
 * sampled (7463, 7524, `ProcLongnote`). Returns whether the hit was sampled.
 */
export function sampleLR2JudgeTiming(
  samples: LR2JudgeTimingSamples,
  judge: string,
  deltaMs: number | undefined,
  longNote: boolean,
): boolean {
  if (longNote || !['PERFECT', 'GREAT', 'GOOD', 'BAD'].includes(judge)) return false;
  if (deltaMs === undefined || !Number.isFinite(deltaMs)) return false;
  samples.count += 1;
  samples.sumMs += Math.round(deltaMs);
  return true;
}

/**
 * LR2 beta3 (OpenLR2 `LR2f.cpp` 12641-12647), once per judging pass: with more than nine samples, the timing moves 1 ms
 * toward the side the hits lean to (later hits raise it), not at all when they balance, and the window starts over.
 * Fewer samples leave both alone. There is no averaging, rounding or clamp.
 */
export function settleLR2JudgeTiming(currentMs: number, samples: LR2JudgeTimingSamples): number {
  if (samples.count <= 9) return currentMs;
  const next = currentMs + Math.sign(samples.sumMs);
  samples.count = 0;
  samples.sumMs = 0;
  return next;
}
