/**
 * A ghost's pace (docs/replay.md, "Ghost"): its EX score after each count of notes judged, read off its timeline, so a
 * pacemaker can stand where the ghost stood when it had judged as many notes as the live play has. Advancing by notes
 * judged rather than by time is how LR2 and beatoraja pace a ghost; it holds whatever hi-speed, covers or timing the
 * live player uses. Pure.
 */

import type { GhostPaceScore } from './ghost.ts';
import type { GhostJudgmentCounts, GhostTimeline } from './ghost-timeline.ts';

/** A ghost's EX score by notes judged. */
export interface GhostPace {
  /** The ghost's EX score over the whole chart: its last judgment's. */
  readonly finalEXScore: number;
  /** The ghost's EX score once it had judged `judgedNotes` notes (empty POORs take none), held at its last. */
  exScoreAt(judgedNotes: number): number;
}

/** The notes `counts` have judged: every judgment that takes a note (an empty POOR takes none). */
export function countJudgedNotes(counts: GhostPaceScore | GhostJudgmentCounts): number {
  return counts.perfect + counts.great + counts.good + counts.bad + counts.poor;
}

/** The pace of `timeline` (see the module comment). */
export function buildGhostPace(timeline: Pick<GhostTimeline, 'judgments'>): GhostPace {
  // byJudged[n]: the EX score once n notes were judged (the last judgment at that count, empty POORs after it included).
  const byJudged: number[] = [0];
  for (const step of timeline.judgments) {
    const judged = countJudgedNotes(step.counts);
    while (byJudged.length <= judged) byJudged.push(byJudged[byJudged.length - 1]!);
    byJudged[judged] = step.exScore;
  }
  const finalEXScore = timeline.judgments.at(-1)?.exScore ?? 0;
  return {
    finalEXScore,
    exScoreAt(judgedNotes) {
      if (!(judgedNotes > 0)) return 0;
      const index = Math.min(Math.floor(judgedNotes), byJudged.length - 1);
      return byJudged[index]!;
    },
  };
}
