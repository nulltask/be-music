/** One player's personal bests on one chart, ruleset and assist class (a `best_scores` row). */
export interface BestScores {
  bestEx: number;
  bestExScoreId: string;
  /** When the best EX score was first reached — orders tied players (earlier first). */
  bestExAt: number;
  /** The best clear lamp, by its rank (`clearLampRank` of `@be-music/player/ruleset`). */
  bestLamp: number;
  bestLampScoreId: string;
  minMiss: number;
  minMissScoreId: string;
  playCount: number;
}

/** The figures of one new play under one ruleset. */
export interface PlayFigures {
  scoreId: string;
  /** When the play was accepted, in epoch milliseconds. */
  playedAt: number;
  exScore: number;
  /** The play's clear lamp, by its rank (`clearLampRank`). */
  lamp: number;
  missCount: number;
}

export interface BestScoresUpdate {
  next: BestScores;
  improved: { exScore: boolean; lamp: boolean; missCount: boolean };
}

/**
 * Folds a new play into the personal bests, beatoraja style: the best EX score, the best clear lamp and the fewest
 * misses are kept separately, each pointing at the play that set it. Only a strictly better value replaces a best, so
 * ties keep the earlier play (it achieved the value first). Every play counts towards `playCount`.
 */
export function mergeBestScores(current: BestScores | undefined, play: PlayFigures): BestScoresUpdate {
  if (current === undefined) {
    return {
      next: {
        bestEx: play.exScore,
        bestExScoreId: play.scoreId,
        bestExAt: play.playedAt,
        bestLamp: play.lamp,
        bestLampScoreId: play.scoreId,
        minMiss: play.missCount,
        minMissScoreId: play.scoreId,
        playCount: 1,
      },
      improved: { exScore: true, lamp: true, missCount: true },
    };
  }
  const exScore = play.exScore > current.bestEx;
  const lamp = play.lamp > current.bestLamp;
  const missCount = play.missCount < current.minMiss;
  return {
    next: {
      bestEx: exScore ? play.exScore : current.bestEx,
      bestExScoreId: exScore ? play.scoreId : current.bestExScoreId,
      bestExAt: exScore ? play.playedAt : current.bestExAt,
      bestLamp: lamp ? play.lamp : current.bestLamp,
      bestLampScoreId: lamp ? play.scoreId : current.bestLampScoreId,
      minMiss: missCount ? play.missCount : current.minMiss,
      minMissScoreId: missCount ? play.scoreId : current.minMissScoreId,
      playCount: current.playCount + 1,
    },
    improved: { exScore, lamp, missCount },
  };
}
