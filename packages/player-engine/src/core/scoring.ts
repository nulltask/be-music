import {
  _____EX_SCORE_PER_GREAT,
  _____EX_SCORE_PER_PGREAT,
  resolveLR2MoneyScore,
  type JudgmentKind,
  type ScoreSummary,
} from '../ruleset/score.ts';

// The score vocabulary is the ruleset's (`../ruleset/score.ts`, exported from `@be-music/player-engine/ruleset`); the engine
// modules read it through here, next to the trackers that fill a summary as a play is judged.
export {
  computeScoreRate,
  createEmptyScore,
  _____EX_SCORE_PER_GREAT,
  _____EX_SCORE_PER_PGREAT,
  _____RANK_LABELS,
  LR2_MONEY_SCORE_MAX,
  resolveDisplayedPoor,
  resolve____RankIndexFromRate,
  resolve____RankIndexFromScore,
  resolve____RankLabel,
  resolveLR2MoneyScore,
  type ____RankLabel,
  type JudgmentKind,
  type ScoreSummary,
} from '../ruleset/score.ts';

export interface ScoreTracker {
  combo: number;
  /** Highest combo reached so far — latched by {@link applyJudgeToSummary}, never reset by BAD / POOR. */
  maxCombo: number;
  /**
   * True when the active ruleset defines LR2's 200000-point "money score". Rulesets without one report EX-SCORE in
   * `ScoreSummary.score` instead — that is what beatoraja shows, and what That-Which-Must-Not-Be-Named has shown since BISTROVER retired
   * its own money score.
   */
  moneyScore: boolean;
  /**
   * The course-wide combo and max combo, for a course stage: carried in from the previous stage and kept alongside the
   * stage's own combo, breaking where it breaks (beatoraja `JudgeManager.coursecombo`, LR2 `now_combo_course`).
   */
  course?: { combo: number; maxCombo: number };
}

export function createScoreTracker(
  options: { moneyScore?: boolean; course?: { combo: number; maxCombo: number } } = {},
): ScoreTracker {
  const tracker: ScoreTracker = {
    combo: 0,
    maxCombo: 0,
    moneyScore: options.moneyScore ?? true,
  };
  if (options.course !== undefined) {
    tracker.course = { combo: options.course.combo, maxCombo: Math.max(options.course.maxCombo, options.course.combo) };
  }
  return tracker;
}

/** Breaks the combo the max combo is measured on, and the course-wide combo with it. */
export function breakTrackedCombo(tracker: ScoreTracker): void {
  tracker.combo = 0;
  if (tracker.course !== undefined) {
    tracker.course.combo = 0;
  }
}

export function applyJudgeToSummary(summary: ScoreSummary, judge: JudgmentKind, tracker: ScoreTracker): void {
  if (judge === 'PERFECT') {
    summary.perfect += 1;
  } else if (judge === 'GREAT') {
    summary.great += 1;
  } else if (judge === 'GOOD') {
    summary.good += 1;
  } else if (judge === 'BAD') {
    summary.bad += 1;
  } else {
    summary.poor += 1;
  }

  const exScoreDelta = resolveExScoreDelta(judge);
  summary.exScore += exScoreDelta;

  if (judge === 'PERFECT' || judge === 'GREAT' || judge === 'GOOD') {
    tracker.combo += 1;
    if (tracker.combo > tracker.maxCombo) {
      tracker.maxCombo = tracker.combo;
    }
    if (tracker.course !== undefined) {
      tracker.course.combo += 1;
      tracker.course.maxCombo = Math.max(tracker.course.maxCombo, tracker.course.combo);
    }
  } else {
    breakTrackedCombo(tracker);
  }

  summary.score = tracker.moneyScore ? resolveLR2MoneyScore(summary) : summary.exScore;
}

function resolveExScoreDelta(judge: JudgmentKind): number {
  if (judge === 'PERFECT') {
    return _____EX_SCORE_PER_PGREAT;
  }
  if (judge === 'GREAT') {
    return _____EX_SCORE_PER_GREAT;
  }
  return 0;
}
