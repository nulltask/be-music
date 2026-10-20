import { playedAtAnotherTempo } from './view.ts';
import type { BeMusicPlaylog } from './format.ts';

/** Assists a rankable play may use; a ranking lists assisted plays apart. */
export type PlaylogAssistFlag = 'auto-scratch' | 'judge-window-override';

/** Why a play cannot be ranked. */
export type PlaylogIneligibleReason = 'auto-play' | 'aborted' | 'tempo' | 'course-stage' | 'missing-fingerprint';

export type PlaylogEligibility =
  | { eligible: true; chartFingerprint: string; playFingerprint: string; assistFlags: PlaylogAssistFlag[] }
  | { eligible: false; reason: PlaylogIneligibleReason };

/**
 * Decides whether a play can be ranked (docs/leaderboard.md section 6), for both the client that submits it and the
 * server that ranks it. Auto plays and ESC aborts are rejected, and so is a play at another tempo (`play.tempo`): it is
 * practice, as beatoraja's frequency trainer does not save its scores. So is a course stage: it started from the state the
 * previous stage left and ran on a course gauge, so it is not a single-chart play. So is a log without both
 * fingerprints, since the chart fingerprint is the ranking key and the play fingerprint is what the server verifies.
 * Assists do not reject a play; they are returned as flags so it is ranked apart.
 */
export function checkPlaylogEligibility(playlog: BeMusicPlaylog): PlaylogEligibility {
  if (playlog.play.mode !== 'manual') {
    return { eligible: false, reason: 'auto-play' };
  }
  if (playlog.play.aborted === true) {
    return { eligible: false, reason: 'aborted' };
  }
  if (playedAtAnotherTempo(playlog.play)) {
    return { eligible: false, reason: 'tempo' };
  }
  if (playlog.play.course !== undefined) {
    return { eligible: false, reason: 'course-stage' };
  }
  const { chartFingerprint, playFingerprint } = playlog.chart;
  if (chartFingerprint === undefined || playFingerprint === undefined) {
    return { eligible: false, reason: 'missing-fingerprint' };
  }
  const assistFlags: PlaylogAssistFlag[] = [];
  if (playlog.play.autoScratch) assistFlags.push('auto-scratch');
  if (playlog.play.judgeWindowOverrideMs !== undefined) assistFlags.push('judge-window-override');
  return { eligible: true, chartFingerprint, playFingerprint, assistFlags };
}
