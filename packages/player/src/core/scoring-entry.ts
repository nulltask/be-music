/**
 * `@be-music/player/core/scoring`: a deprecated alias kept until the `core/*` subpaths are retired.
 *
 * The score vocabulary (`ScoreSummary`, `JudgeKind`, `createEmptyScore`, `computeScoreRate`, the DJ Rank helpers and
 * LR2's money score) is the ruleset's: import it from `@be-music/player/ruleset`. The trackers that fill a summary
 * while a play is judged are the engine's own and get no new entry point.
 *
 * @deprecated Import the score vocabulary from `@be-music/player/ruleset`.
 * @module
 */
import * as score from '../ruleset/score.ts';
import * as scoring from './scoring.ts';

/** @deprecated Import `JudgeKind` from `@be-music/player/ruleset`. */
export type JudgeKind = score.JudgeKind;
/** @deprecated Import `ScoreSummary` from `@be-music/player/ruleset`. */
export type ScoreSummary = score.ScoreSummary;
/** @deprecated Import `IidxRankLabel` from `@be-music/player/ruleset`. */
export type IidxRankLabel = score.IidxRankLabel;
/** @deprecated Import `createEmptyScore` from `@be-music/player/ruleset`. */
export const createEmptyScore: typeof score.createEmptyScore = score.createEmptyScore;
/** @deprecated Import `computeScoreRate` from `@be-music/player/ruleset`. */
export const computeScoreRate: typeof score.computeScoreRate = score.computeScoreRate;
/** @deprecated Import `resolveDisplayedPoor` from `@be-music/player/ruleset`. */
export const resolveDisplayedPoor: typeof score.resolveDisplayedPoor = score.resolveDisplayedPoor;
/** @deprecated Import `resolveIidxRankIndexFromScore` from `@be-music/player/ruleset`. */
export const resolveIidxRankIndexFromScore: typeof score.resolveIidxRankIndexFromScore =
  score.resolveIidxRankIndexFromScore;
/** @deprecated Import `resolveIidxRankLabel` from `@be-music/player/ruleset`. */
export const resolveIidxRankLabel: typeof score.resolveIidxRankLabel = score.resolveIidxRankLabel;
/** @deprecated Import `resolveLr2MoneyScore` from `@be-music/player/ruleset`. */
export const resolveLr2MoneyScore: typeof score.resolveLr2MoneyScore = score.resolveLr2MoneyScore;
/** @deprecated Import `IIDX_RANK_LABELS` from `@be-music/player/ruleset`. */
export const IIDX_RANK_LABELS: typeof score.IIDX_RANK_LABELS = score.IIDX_RANK_LABELS;

/** @deprecated Use `computeScoreRate` from `@be-music/player/ruleset` and compare with the ninths. */
export const resolveIidxRankIndexFromRate: typeof score.resolveIidxRankIndexFromRate =
  score.resolveIidxRankIndexFromRate;
/** @deprecated The EX score of a PGREAT; no replacement. */
export const IIDX_EX_SCORE_PER_PGREAT: typeof score.IIDX_EX_SCORE_PER_PGREAT = score.IIDX_EX_SCORE_PER_PGREAT;
/** @deprecated The EX score of a GREAT; no replacement. */
export const IIDX_EX_SCORE_PER_GREAT: typeof score.IIDX_EX_SCORE_PER_GREAT = score.IIDX_EX_SCORE_PER_GREAT;
/** @deprecated LR2's money-score ceiling; no replacement. */
export const LR2_MONEY_SCORE_MAX: typeof score.LR2_MONEY_SCORE_MAX = score.LR2_MONEY_SCORE_MAX;
/** @deprecated LR2's DJ Rank select ops are `@be-music/lr2-skin`'s; no replacement here. */
export const resolveIidxSelectRankOp: typeof scoring.resolveIidxSelectRankOp = scoring.resolveIidxSelectRankOp;

/** @deprecated The engine's score tracker, internal to the engine; no replacement. */
export type ScoreTracker = scoring.ScoreTracker;
/** @deprecated The engine's score tracker, internal to the engine; no replacement. */
export const createScoreTracker: typeof scoring.createScoreTracker = scoring.createScoreTracker;
/** @deprecated The engine's score tracker, internal to the engine; no replacement. */
export const breakTrackedCombo: typeof scoring.breakTrackedCombo = scoring.breakTrackedCombo;
/** @deprecated The engine's score tracker, internal to the engine; no replacement. */
export const applyJudgeToSummary: typeof scoring.applyJudgeToSummary = scoring.applyJudgeToSummary;
