import type { BeMusicPlaylog } from '@be-music/player/playlog';

export type AssistFlag = 'auto-scratch' | 'judge-window-override';

export type IneligibleReason = 'auto-play' | 'aborted' | 'missing-fingerprint';

export type Eligibility =
  | { eligible: true; chartFingerprint: string; playFingerprint: string; assistFlags: AssistFlag[] }
  | { eligible: false; reason: IneligibleReason };

/**
 * Decides whether a play can be ranked (docs/leaderboard.md section 6). Auto plays and ESC aborts are rejected, and so
 * is a log without both fingerprints, since the chart fingerprint is the ranking key and the play fingerprint is what
 * the server verifies. Assists do not reject a play; they are returned as flags so it is ranked apart.
 */
export function checkEligibility(playlog: BeMusicPlaylog): Eligibility {
  if (playlog.play.mode === 'auto') {
    return { eligible: false, reason: 'auto-play' };
  }
  if (playlog.play.aborted === true) {
    return { eligible: false, reason: 'aborted' };
  }
  const { chartFingerprint, playFingerprint } = playlog.chart;
  if (chartFingerprint === undefined || playFingerprint === undefined) {
    return { eligible: false, reason: 'missing-fingerprint' };
  }
  const assistFlags: AssistFlag[] = [];
  if (playlog.play.autoScratch) assistFlags.push('auto-scratch');
  if (playlog.play.judgeWindowOverrideMs !== undefined) assistFlags.push('judge-window-override');
  return { eligible: true, chartFingerprint, playFingerprint, assistFlags };
}
