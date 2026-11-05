// When a finished play goes to the Leaderboard (Options dialog → Leaderboard → "Submit when"). The Leaderboard takes
// every play the player sends and decides what it shows (docs/leaderboard.md); this rule only lets the player cut the
// traffic down to the plays that improve on their own best.

/**
 * When a finished play is sent, once "Submit to Leaderboard" is on: `'improved'` (the default) sends a play whose
 * EX-SCORE beats the player's own best on the chart, and the first play of a chart; `'always'` sends every play.
 */
export type LeaderboardSubmitRule = 'improved' | 'always';

/** Every {@link LeaderboardSubmitRule}, for reading a stored setting. */
export const LEADERBOARD_SUBMIT_RULES: readonly LeaderboardSubmitRule[] = ['improved', 'always'];

/** The rule a fresh visit starts with. */
export const DEFAULT_LEADERBOARD_SUBMIT_RULE: LeaderboardSubmitRule = 'improved';

/**
 * Whether a finished single play is sent under `rule`. `previousBestEXScore` is the player's best EX-SCORE on the chart
 * as it was when the play started (`undefined` before the chart's first play), and `exScore` the play's own. A play whose
 * EX-SCORE is not known is sent, as is the first play of a chart; an equal EX-SCORE is not an improvement.
 */
export function shouldSubmitPlay(
  rule: LeaderboardSubmitRule,
  exScore: number | undefined,
  previousBestEXScore: number | undefined,
): boolean {
  if (rule === 'always') return true;
  if (exScore === undefined || previousBestEXScore === undefined) return true;
  return exScore > previousBestEXScore;
}
