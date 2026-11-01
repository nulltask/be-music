import { isBmsonRecoveryDisabled } from '../ruleset/bmson-total.ts';
import { classifyReplayAssists, resolveAssistClass, type AssistClass } from '../records/assist-policy.ts';
import { playedAtAnotherTempo } from './view.ts';
import type { BeMusicReplay } from './format.ts';

/**
 * An assisted option a play used, by its finding id (`AssistFinding.option` of `classifyReplayAssists`): `auto-scratch`,
 * `judge-window-override`, `H-RANDOM`, `bpm-guide`, …. A ranking lists assisted plays apart.
 */
export type ReplayAssistFlag = string;

/** Why a play cannot be submitted at all. */
export type ReplayIneligibleReason = 'auto-play' | 'two-player' | 'missing-fingerprint';

/**
 * Why a submitted play is stored but not ranked: a play at another tempo (`tempo`), a course stage played on its own
 * submission (`course-stage`), bmson zero-total no-recovery (`bmson-total`), or an option whose source saves no data
 * from the play (`no-save`, the `no-save` assist class). The Leaderboard decides what to show; these are the facts it
 * decides on.
 */
export type ReplayUnrankedReason = 'tempo' | 'course-stage' | 'bmson-total' | 'no-save';

export type ReplayEligibility =
  | {
      eligible: true;
      chartFingerprint: string;
      playFingerprint: string;
      assistFlags: ReplayAssistFlag[];
      /** The play's assist class (`resolveAssistClass`): `light` and `assist` rank apart, `no-save` is unranked. */
      assistClass: AssistClass;
      /** Set when the play is stored but left out of the rankings. */
      unranked?: ReplayUnrankedReason;
    }
  | { eligible: false; reason: ReplayIneligibleReason };

/**
 * Decides whether a play can be submitted and whether it ranks (docs/leaderboard.md section 6), for both the client
 * that submits it and the server that stores it. Every play is submitted except a two-player play (which has no
 * single-player ranking), an auto play (replay playback records no new replay, so it never reaches here) and a log
 * without both fingerprints, since the chart fingerprint is the ranking key and the play fingerprint is what the server
 * verifies. A play at another tempo (`play.tempo`) is practice, as beatoraja's frequency trainer does not save its
 * scores, and a course stage started from the state the previous stage left and ran on a course gauge: both are
 * submitted and stored, marked `unranked`. Assists do not reject a play either: they are classified by their sources
 * (`classifyReplayAssists`, #602) and returned as flags and a class, so a `light` or `assist` play is ranked apart and a
 * `no-save` play is stored unranked. A play given up with ESC (`play.aborted`) is ranked as a failed play, its BP
 * counting the notes it never reached, as LR2 and beatoraja save one.
 */
export function checkReplayEligibility(replay: BeMusicReplay): ReplayEligibility {
  if (replay.play.mode !== 'manual') {
    return { eligible: false, reason: 'auto-play' };
  }
  if (replay.play.battleMode === 'TWO-PLAYER' || replay.play.battleMode === 'COUPLE')
    return { eligible: false, reason: 'two-player' };
  const { chartFingerprint, playFingerprint } = replay.chart;
  if (chartFingerprint === undefined || playFingerprint === undefined) {
    return { eligible: false, reason: 'missing-fingerprint' };
  }
  const findings = classifyReplayAssists(replay);
  const assistFlags: ReplayAssistFlag[] = findings.map((finding) => finding.option);
  const assistClass = resolveAssistClass(findings);
  const unranked: ReplayUnrankedReason | undefined = playedAtAnotherTempo(replay.play)
    ? 'tempo'
    : replay.play.course !== undefined
      ? 'course-stage'
      : isBmsonRecoveryDisabled(replay.chart, replay.play.bmsonTotalMode)
        ? 'bmson-total'
        : assistClass === 'no-save'
          ? 'no-save'
          : undefined;
  return {
    eligible: true,
    chartFingerprint,
    playFingerprint,
    assistFlags,
    assistClass,
    ...(unranked !== undefined ? { unranked } : {}),
  };
}
