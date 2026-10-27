import { playedAtAnotherTempo } from './view.ts';
import type { BeMusicReplay } from './format.ts';

/** Assists a rankable play may use; a ranking lists assisted plays apart. */
export type ReplayAssistFlag = 'auto-scratch' | 'judge-window-override';

/** Why a play cannot be submitted at all. */
export type ReplayIneligibleReason = 'auto-play' | 'missing-fingerprint';

/**
 * Why a submitted play is stored but not ranked: a play at another tempo (`tempo`), and a course stage played on its
 * own submission (`course-stage`). The Leaderboard decides what to show; these are the facts it decides on.
 */
export type ReplayUnrankedReason = 'tempo' | 'course-stage';

export type ReplayEligibility =
  | {
      eligible: true;
      chartFingerprint: string;
      playFingerprint: string;
      assistFlags: ReplayAssistFlag[];
      /** Set when the play is stored but left out of the rankings. */
      unranked?: ReplayUnrankedReason;
    }
  | { eligible: false; reason: ReplayIneligibleReason };

/**
 * Decides whether a play can be submitted and whether it ranks (docs/leaderboard.md section 6), for both the client
 * that submits it and the server that stores it. Every play is submitted except an auto play (replay playback records
 * no new replay, so it never reaches here) and a log without both fingerprints, since the chart fingerprint is the
 * ranking key and the play fingerprint is what the server verifies. A play at another tempo (`play.tempo`) is
 * practice, as beatoraja's frequency trainer does not save its scores, and a course stage started from the state the
 * previous stage left and ran on a course gauge: both are submitted and stored, marked `unranked`. Assists do not
 * reject a play either; they are returned as flags so it is ranked apart. A play given up with ESC (`play.aborted`) is
 * ranked as a failed play, its BP counting the notes it never reached, as LR2 and beatoraja save one.
 */
export function checkReplayEligibility(replay: BeMusicReplay): ReplayEligibility {
  if (replay.play.mode !== 'manual') {
    return { eligible: false, reason: 'auto-play' };
  }
  const { chartFingerprint, playFingerprint } = replay.chart;
  if (chartFingerprint === undefined || playFingerprint === undefined) {
    return { eligible: false, reason: 'missing-fingerprint' };
  }
  const assistFlags: ReplayAssistFlag[] = [];
  if (replay.play.autoScratch) assistFlags.push('auto-scratch');
  if (replay.play.judgeWindowOverrideMs !== undefined) assistFlags.push('judge-window-override');
  const unranked: ReplayUnrankedReason | undefined = playedAtAnotherTempo(replay.play)
    ? 'tempo'
    : replay.play.course !== undefined
      ? 'course-stage'
      : undefined;
  return {
    eligible: true,
    chartFingerprint,
    playFingerprint,
    assistFlags,
    ...(unranked !== undefined ? { unranked } : {}),
  };
}
