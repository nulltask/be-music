import { playedAtAnotherTempo } from './view.ts';
import type { BeMusicReplay } from './format.ts';

/** Assists a rankable play may use; a ranking lists assisted plays apart. */
export type ReplayAssistFlag = 'auto-scratch' | 'judge-window-override';

/** Why a play cannot be ranked. */
export type ReplayIneligibleReason = 'auto-play' | 'tempo' | 'course-stage' | 'missing-fingerprint';

export type ReplayEligibility =
  | { eligible: true; chartFingerprint: string; playFingerprint: string; assistFlags: ReplayAssistFlag[] }
  | { eligible: false; reason: ReplayIneligibleReason };

/**
 * Decides whether a play can be ranked (docs/leaderboard.md section 6), for both the client that submits it and the
 * server that ranks it. Auto plays are rejected, and so is a play at another tempo (`play.tempo`): it is
 * practice, as beatoraja's frequency trainer does not save its scores. So is a course stage: it started from the state the
 * previous stage left and ran on a course gauge, so it is not a single-chart play. So is a log without both
 * fingerprints, since the chart fingerprint is the ranking key and the play fingerprint is what the server verifies.
 * Assists do not reject a play; they are returned as flags so it is ranked apart. A play given up with ESC
 * (`play.aborted`) is ranked as a failed play, its BP counting the notes it never reached, as LR2 and beatoraja save one.
 */
export function checkReplayEligibility(replay: BeMusicReplay): ReplayEligibility {
  if (replay.play.mode !== 'manual') {
    return { eligible: false, reason: 'auto-play' };
  }
  if (playedAtAnotherTempo(replay.play)) {
    return { eligible: false, reason: 'tempo' };
  }
  if (replay.play.course !== undefined) {
    return { eligible: false, reason: 'course-stage' };
  }
  const { chartFingerprint, playFingerprint } = replay.chart;
  if (chartFingerprint === undefined || playFingerprint === undefined) {
    return { eligible: false, reason: 'missing-fingerprint' };
  }
  const assistFlags: ReplayAssistFlag[] = [];
  if (replay.play.autoScratch) assistFlags.push('auto-scratch');
  if (replay.play.judgeWindowOverrideMs !== undefined) assistFlags.push('judge-window-override');
  return { eligible: true, chartFingerprint, playFingerprint, assistFlags };
}
