import type { PlayerSummary } from '../core/engine-types.ts';
import type { ScoreSummary } from '../ruleset/score.ts';
import type { BeMusicCourseReplay } from '../replay/course.ts';
import { playedAtAnotherTempo } from '../replay/view.ts';
import {
  betterClearLamp,
  clearLampRank,
  resolveClearLamp,
  resolveMissCount,
  type ClearLamp,
} from '../ruleset/clear-lamp.ts';
import type { RulesetId } from '../ruleset/definitions.ts';

/**
 * A player's best record on a chart or a course under one judge ruleset: the best clear lamp, EX-SCORE, max combo and BP
 * over its plays, each kept on its own (the best EX-SCORE may come from another play than the best lamp), and how many
 * plays it counts. A host keeps one per chart (or course) and judge ruleset.
 */
export interface BestRecord {
  /** The best clear lamp so far. */
  lamp: ClearLamp;
  exScore?: number;
  maxCombo?: number;
  /** The fewest BP (see `resolveMissCount`). */
  missCount?: number;
  /** How many plays the record counts. */
  playCount?: number;
}

/** What one finished play (or course run) contributes to a best record. */
export interface RecordPlay {
  lamp: ClearLamp;
  exScore: number;
  maxCombo: number;
  /** BP (see `resolveMissCount`). */
  missCount: number;
}

/**
 * Merges `play` into `previous`: the better lamp, the higher EX score and max combo, the lower BP, and one more play.
 * Every best is kept on its own, as LR2 and beatoraja do. A record that lacks a field takes the play's.
 */
export function mergeBestRecord(previous: BestRecord | undefined, play: RecordPlay): BestRecord {
  if (previous === undefined) {
    return { lamp: play.lamp, exScore: play.exScore, maxCombo: play.maxCombo, missCount: play.missCount, playCount: 1 };
  }
  return {
    lamp: betterClearLamp(previous.lamp, play.lamp),
    exScore: Math.max(previous.exScore ?? 0, play.exScore),
    maxCombo: Math.max(previous.maxCombo ?? 0, play.maxCombo),
    missCount: previous.missCount === undefined ? play.missCount : Math.min(previous.missCount, play.missCount),
    playCount: (previous.playCount ?? 0) + 1,
  };
}

/** The lamps from FULL COMBO up: the only ones a course stage writes into its chart's record. */
const FULL_COMBO_LAMPS: ReadonlySet<ClearLamp> = new Set<ClearLamp>(['FULL_COMBO', 'PERFECT', 'MAX']);

/**
 * Merges an EXPERT / GRADE course stage's play into its chart's record, as LR2 keeps one (OpenLR2 L9043-L9192): the
 * higher EX score and max combo and the lower BP, and the FULL COMBO lamp (PERFECT and MAX too) when the stage earned
 * one, but neither the clear lamp nor the play count. A chart without a record gets one at `NO_PLAY` (or the full-combo
 * lamp) without a play count.
 */
export function mergeCourseStageRecord(previous: BestRecord | undefined, play: RecordPlay): BestRecord {
  const lamp = previous?.lamp ?? 'NO_PLAY';
  return {
    ...previous,
    lamp: FULL_COMBO_LAMPS.has(play.lamp) && clearLampRank(play.lamp) > clearLampRank(lamp) ? play.lamp : lamp,
    exScore: Math.max(previous?.exScore ?? 0, play.exScore),
    maxCombo: Math.max(previous?.maxCombo ?? 0, play.maxCombo),
    missCount: previous?.missCount === undefined ? play.missCount : Math.min(previous.missCount, play.missCount),
  };
}

/** A finished play's result, as a host's result screen gets it (`BeMusicResultData` is one). */
export interface RecordPlayResult {
  /** The play's clear lamp (`resolveClearLamp`); without one the record falls back to the gauge's verdict. */
  lamp?: ClearLamp;
  cleared: boolean;
  maxCombo: number;
  score: Pick<ScoreSummary, 'total' | 'perfect' | 'great' | 'good' | 'bad' | 'poor' | 'emptyPoor' | 'exScore'>;
  /** The POOR judgments alone, when `score.poor` also counts the empty POORs (a result under LR2 shows them so). */
  judgedPoor?: number;
}

/** A result's judgments with only the POOR judgments in `poor`, so a BP counts each empty POOR once. */
function judgmentsOf(result: RecordPlayResult): RecordPlayResult['score'] {
  return result.judgedPoor === undefined ? result.score : { ...result.score, poor: result.judgedPoor };
}

/**
 * What a play's result contributes to its chart's record: its lamp (a result without one falls back to its gauge's
 * verdict, `NORMAL` or `FAILED`), EX score, max combo and BP (BAD + POOR + empty POOR, each empty POOR once also where
 * the result's POOR folds them in).
 */
export function recordPlayFromResult(result: RecordPlayResult): RecordPlay {
  return {
    lamp: result.lamp ?? (result.cleared ? 'NORMAL' : 'FAILED'),
    exScore: result.score.exScore,
    maxCombo: result.maxCombo,
    missCount: resolveMissCount(judgmentsOf(result)),
  };
}

/** A play's final engine summary, as the facts a record reads from it. */
export type RecordPlaySummary = Pick<
  PlayerSummary,
  'total' | 'perfect' | 'great' | 'good' | 'bad' | 'poor' | 'emptyPoor' | 'exScore' | 'gauge'
>;

/**
 * What a play contributes to its chart's record from its final engine summary, for a host whose gameplay hands it no
 * result (the beatoraja family): the lamp comes from `resolveClearLamp` under `ruleset`, the rule every result uses.
 */
export function recordPlayFromSummary(summary: RecordPlaySummary, maxCombo: number, ruleset?: RulesetId): RecordPlay {
  return {
    lamp: resolveClearLamp({
      cleared: summary.gauge?.cleared ?? false,
      score: summary,
      ...(summary.gauge?.type !== undefined ? { gauge: summary.gauge.type } : {}),
      ...(ruleset !== undefined ? { ruleset } : {}),
    }),
    exScore: summary.exScore,
    maxCombo,
    missCount: resolveMissCount(summary),
  };
}

/** The notes of a play its judgments do not cover: those a stage that failed mid-way never judged. */
function unjudgedNotes(score: Pick<ScoreSummary, 'total' | 'perfect' | 'great' | 'good' | 'bad' | 'poor'>): number {
  return score.total - (score.perfect + score.great + score.good + score.bad + score.poor);
}

/**
 * What a course stage's result contributes to its chart's record: as {@link recordPlayFromResult}, with the notes a
 * stage that failed mid-way never judged counted in its BP, as LR2 counts them (OpenLR2 L9105-L9113).
 */
export function courseStageRecordPlayFromResult(result: RecordPlayResult): RecordPlay {
  const play = recordPlayFromResult(result);
  const judgments = judgmentsOf(result);
  return { ...play, missCount: resolveMissCount(judgments, unjudgedNotes(judgments)) };
}

/** {@link courseStageRecordPlayFromResult} for a stage whose result is its engine summary (the beatoraja family). */
export function courseStageRecordPlayFromSummary(
  summary: RecordPlaySummary,
  maxCombo: number,
  ruleset?: RulesetId,
): RecordPlay {
  const play = recordPlayFromSummary(summary, maxCombo, ruleset);
  return { ...play, missCount: resolveMissCount(summary, unjudgedNotes(summary)) };
}

/** What a course run's result (`ReplayCourseResult`) contributes to the course's record. */
export function courseRunRecordPlay(result: RecordPlay): RecordPlay {
  return { lamp: result.lamp, exScore: result.exScore, maxCombo: result.maxCombo, missCount: result.missCount };
}

/** How a play was played, as far as keeping a record goes. */
export interface RecordPlayKind {
  autoPlay: boolean;
  replay: boolean;
  /** The play's tempo (`play.tempo`): another tempo than 1 is practice. */
  tempo: number;
}

/**
 * Whether a single play counts for its chart's record: not an auto play, not a replay, not a course stage (NONSTOP
 * included: the course keeps the record) and not a play at another tempo (practice). The same rule holds whichever
 * skin family plays the chart.
 */
export function playKeepsRecord(play: RecordPlayKind & { course: boolean }): boolean {
  return !play.autoPlay && !play.replay && !play.course && play.tempo === 1;
}

/**
 * Whether an EXPERT / GRADE course stage also updates its chart's record ({@link mergeCourseStageRecord}): not when it
 * is auto-played, replayed or played at another tempo, as for a single play. A NONSTOP run's stitched play has no stage
 * chart to record.
 */
export function courseStageKeepsRecord(play: RecordPlayKind): boolean {
  return playKeepsRecord({ ...play, course: false });
}

/**
 * Whether a course run played a stage at another tempo at any point (`play.tempo`, `play.tempoChanges`): such a run is
 * practice, so it leaves the course's record alone, as a single play at another tempo leaves the chart's.
 */
export function isCourseRunAtAnotherTempo(courseLog: Pick<BeMusicCourseReplay, 'stages'>): boolean {
  return courseLog.stages.some((entry) => entry.played && playedAtAnotherTempo(entry.replay.play));
}

/**
 * Whether a course run played itself (`play.mode: 'auto'`) on any stage, or on the stitched play of a NONSTOP run: an
 * auto-played run leaves the course's record alone, as an auto play leaves the chart's.
 */
export function isCourseRunAutoPlayed(courseLog: Pick<BeMusicCourseReplay, 'stages' | 'nonstop'>): boolean {
  if (courseLog.nonstop?.replay.play.mode === 'auto') return true;
  return courseLog.stages.some((entry) => entry.played && entry.replay.play.mode === 'auto');
}

/** Whether a course run counts for the course's record: not auto-played and not played at another tempo. */
export function courseRunKeepsRecord(courseLog: Pick<BeMusicCourseReplay, 'stages' | 'nonstop'>): boolean {
  return !isCourseRunAutoPlayed(courseLog) && !isCourseRunAtAnotherTempo(courseLog);
}
