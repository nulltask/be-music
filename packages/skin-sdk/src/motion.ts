/** Timing and easing helpers for skin animation, plus a deterministic hash for decorative jitter. */

/**
 * Deterministic [0, 1) hash for decorative jitter — the same seed always yields the same value, so pooled per-frame
 * redraws don't shimmer.
 */
export function hash01(seed: number): number {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * 0..1 progress of a staged animation step that starts `delayMs` after the timeline origin and runs for `durationMs`.
 * Clamped at both ends so callers can compute every step from one elapsed clock.
 */
export function stageProgress(elapsedMs: number, delayMs: number, durationMs: number): number {
  if (durationMs <= 0) return elapsedMs >= delayMs ? 1 : 0;
  return Math.max(0, Math.min(1, (elapsedMs - delayMs) / durationMs));
}

export function easeOutCubic(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return 1 - (1 - clamped) ** 3;
}

/** Ease-out with a small overshoot past 1 before settling — the "slam" landing for tags and stamps. */
export function easeOutBack(t: number, overshoot = 1.70158): number {
  const clamped = Math.max(0, Math.min(1, t));
  const shifted = clamped - 1;
  return 1 + (overshoot + 1) * shifted ** 3 + overshoot * shifted ** 2;
}

/** Counter roll-up: the integer shown at `progress` (0..1) of counting up to `target`. */
export function rollUpValue(target: number, progress: number): number {
  if (!Number.isFinite(target)) return 0;
  return Math.round(target * easeOutCubic(progress));
}
