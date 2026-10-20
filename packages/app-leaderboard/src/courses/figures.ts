import type { ReplayCourseInfo, ReplayRulesetResult } from '@be-music/player-engine/replay';

/** One reached stage of a course run under one ruleset, as the run page breaks the run down. */
export interface CourseStageFigures {
  exScore: number;
  noteCount: number;
  /** BP: BADs, POORs and empty POORs, plus the notes the stage never judged (it failed before them). */
  missCount: number;
  maxCombo: number;
  /** Judgment counts, with `fast` and `slow`. */
  judges: Record<string, number>;
  gaugeType: string;
  /** The gauge the stage ended on, in percent: what the next stage carries in. */
  gaugeFinal: number;
  cleared: boolean;
}

/** A stage result of `simulateCourseReplay` (`ReplayCourseResult.stages`) as it is stored. */
export function toCourseStageFigures(result: ReplayRulesetResult): CourseStageFigures {
  const { judge } = result;
  const judged = judge.pgreat + judge.great + judge.good + judge.bad + judge.poor;
  return {
    exScore: result.exScore,
    noteCount: result.noteCount,
    missCount: judge.bad + judge.poor + judge.emptyPoor + Math.max(0, result.noteCount - judged),
    maxCombo: result.maxCombo,
    judges: { ...judge, fast: result.fast, slow: result.slow },
    gaugeType: result.gauge.type,
    gaugeFinal: result.gauge.final,
    cleared: result.gauge.cleared,
  };
}

/**
 * Where an earned trophy stands in its course's trophy list, which lists them easiest first (beatoraja
 * `GradeBar.getTrophy` keeps the last one that qualifies): 1 for the first, 0 for none or a name the list lacks. A name
 * listed twice takes its last place, as the last qualifying trophy is the one earned.
 */
export function courseTrophyRank(trophies: ReplayCourseInfo['trophies'], trophy: string | undefined | null): number {
  if (trophy === undefined || trophy === null) return 0;
  for (let index = trophies.length - 1; index >= 0; index -= 1) {
    if (trophies[index]!.name === trophy) return index + 1;
  }
  return 0;
}

/** A player's best trophy on one course, ruleset and assist class, and the run that earned it. */
export interface CourseTrophyBest {
  trophy: string | null;
  rank: number;
  scoreId: string | null;
}

export const NO_TROPHY: CourseTrophyBest = { trophy: null, rank: 0, scoreId: null };

/**
 * Folds a run's trophy into the best, as `mergeBestScores` folds the other bests: only a strictly higher trophy
 * replaces it, so a tie keeps the run that earned it first.
 */
export function mergeCourseTrophy(
  current: CourseTrophyBest | undefined,
  run: { scoreId: string; trophy: string | null; rank: number },
): { next: CourseTrophyBest; improved: boolean } {
  const best = current ?? NO_TROPHY;
  if (run.trophy === null || run.rank <= best.rank) return { next: best, improved: false };
  return { next: { trophy: run.trophy, rank: run.rank, scoreId: run.scoreId }, improved: true };
}
