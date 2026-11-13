/**
 * A fixed score target as a pace: a target with no replay behind it (a rank border, a score rate, a ranking place)
 * advances evenly with the notes judged, as the built-in score graph paces it (`resolveScorePace`).
 */

/** The judgment counts a pace is read from. */
export interface TargetPaceScore {
  readonly total: number;
  readonly perfect: number;
  readonly great: number;
  readonly good: number;
  readonly bad: number;
  readonly poor: number;
}

/** The EX score a target of `targetEXScore` has reached by the notes judged so far. */
export function resolveLinearTargetPace(targetEXScore: number, score: TargetPaceScore): number {
  if (score.total <= 0) return 0;
  const judged = score.perfect + score.great + score.good + score.bad + score.poor;
  return Math.round(targetEXScore * Math.min(1, Math.max(0, judged / score.total)));
}
