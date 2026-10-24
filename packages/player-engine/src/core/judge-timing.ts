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
