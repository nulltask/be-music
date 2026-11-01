import { isBmsonRecoveryDisabled } from '../ruleset/bmson-total.ts';
import type { PlayerSummary } from '../core/engine-types.ts';
import type { ScoreSummary } from '../ruleset/score.ts';
import type { BeMusicCourseReplay } from '../replay/course.ts';
import { playedAtAnotherTempo } from '../replay/view.ts';
import {
  betterClearLamp,
  compareClearLamps,
  resolveClearLamp,
  resolveMissCount,
  type ClearLamp,
} from '../ruleset/clear-lamp.ts';
import type { RulesetId } from '../ruleset/definitions.ts';
import {
  applyRecordPolicyLamp,
  classifyReplayAssists,
  resolveAssistClass,
  type RecordPolicy,
} from './assist-policy.ts';

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
 *
 * With a record policy (`resolveRecordPolicy`), the play's lamp is limited first (`applyRecordPolicyLamp`), and a play
 * whose policy blocks score updates (an assisted play) moves only the lamp and the play count, as LR2 and beatoraja
 * keep an assisted play: the record's EX score, max combo and BP stay as they were (absent on a first play).
 */
export function mergeBestRecord(
  previous: BestRecord | undefined,
  play: RecordPlay,
  policy?: Pick<RecordPolicy, 'updatesScore' | 'lamp'>,
): BestRecord {
  if (policy !== undefined && !policy.updatesScore) {
    const lamp = applyRecordPolicyLamp(play.lamp, policy);
    return {
      ...previous,
      lamp: previous === undefined ? lamp : betterClearLamp(previous.lamp, lamp),
      playCount: (previous?.playCount ?? 0) + 1,
    };
  }
  if (policy !== undefined) play = { ...play, lamp: applyRecordPolicyLamp(play.lamp, policy) };
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
    lamp: FULL_COMBO_LAMPS.has(play.lamp) && compareClearLamps(play.lamp, lamp) > 0 ? play.lamp : lamp,
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
  score: Pick<
    ScoreSummary,
    'total' | 'perfect' | 'great' | 'good' | 'bad' | 'poor' | 'emptyPoor' | 'minePoor' | 'exScore'
  >;
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
 * the result's POOR folds them in, plus the notes a play that ended early never judged, as LR2 and beatoraja count them:
 * OpenLR2 L9436-L9439, beatoraja `BMSPlayer` L915).
 */
export function recordPlayFromResult(result: RecordPlayResult): RecordPlay {
  const judgments = judgmentsOf(result);
  return {
    lamp: result.lamp ?? (result.cleared ? 'NORMAL' : 'FAILED'),
    exScore: result.score.exScore,
    maxCombo: result.maxCombo,
    missCount: resolveMissCount(judgments, unjudgedNotes(judgments)),
  };
}

/**
 * What a single play given up with ESC contributes to its chart's record, from its result so far: as
 * {@link recordPlayFromResult}, with the `FAILED` lamp and the notes it never reached in its BP, as LR2 and beatoraja
 * save a play quit mid-way (beatoraja `BMSPlayer.stopPlay` L956-L975). A play quit before it judged a note (no PGREAT to
 * BAD) saves nothing, as beatoraja saves none (`createScoreData` L866-L868).
 */
export function abortedRecordPlayFromResult(result: RecordPlayResult): RecordPlay | undefined {
  const { perfect, great, good, bad } = result.score;
  if (perfect + great + good + bad === 0) return undefined;
  return { ...recordPlayFromResult(result), lamp: 'FAILED' };
}

/** A play's final engine summary, as the facts a record reads from it. */
export type RecordPlaySummary = Pick<
  PlayerSummary,
  'total' | 'perfect' | 'great' | 'good' | 'bad' | 'poor' | 'emptyPoor' | 'minePoor' | 'exScore' | 'gauge' | 'fullCombo'
>;

/**
 * What a play contributes to its chart's record from its final engine summary, for a host whose gameplay hands it no
 * result (the beatoraja family): the lamp comes from `resolveClearLamp` under `ruleset`, the rule every result uses, and
 * the BP counts the notes a play that ended early never judged, as {@link recordPlayFromResult}'s does.
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
    missCount: resolveMissCount(summary, unjudgedNotes(summary)),
  };
}

/**
 * The notes of a play its judgments do not cover: those a play that failed or was given up mid-way never judged. A mine
 * POOR (`minePoor`, which LR2 counts in its POOR) judges no note.
 */
function unjudgedNotes(
  score: Pick<ScoreSummary, 'total' | 'perfect' | 'great' | 'good' | 'bad' | 'poor' | 'minePoor'>,
): number {
  return score.total - (score.perfect + score.great + score.good + score.bad + score.poor) + (score.minePoor ?? 0);
}

/**
 * What a course stage's result contributes to its chart's record: the same as {@link recordPlayFromResult}, whose BP
 * already counts the notes a stage that failed mid-way never judged, as LR2 counts a stage's (OpenLR2 L9111-L9113).
 */
export function courseStageRecordPlayFromResult(result: RecordPlayResult): RecordPlay {
  return recordPlayFromResult(result);
}

/** {@link courseStageRecordPlayFromResult} for a stage whose result is its engine summary (the beatoraja family). */
export function courseStageRecordPlayFromSummary(
  summary: RecordPlaySummary,
  maxCombo: number,
  ruleset?: RulesetId,
): RecordPlay {
  return recordPlayFromSummary(summary, maxCombo, ruleset);
}

/** What a course run's result (`ReplayCourseResult`) contributes to the course's record. */
export function courseRunRecordPlay(result: RecordPlay): RecordPlay {
  return { lamp: result.lamp, exScore: result.exScore, maxCombo: result.maxCombo, missCount: result.missCount };
}

/** How a play was played, as far as keeping a record goes. */
export interface RecordPlayKind {
  autoPlay: boolean;
  /** Effective no-recovery policy, not merely selecting spec mode for an ordinary chart. */
  recoveryDisabled?: boolean;
  replay: boolean;
  /** The play's tempo (`play.tempo`): another tempo than 1 is practice. */
  tempo: number;
}

/**
 * Whether a single play counts for its chart's record: not an auto play, not a replay, not a course stage (NONSTOP
 * included: the course keeps the record), a play at another tempo (practice), or effective zero-total no-recovery.
 * The same rule holds whichever
 * skin family plays the chart.
 */
export function playKeepsRecord(play: RecordPlayKind & { course: boolean }): boolean {
  return !play.autoPlay && !play.replay && !play.course && play.tempo === 1 && play.recoveryDisabled !== true;
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

/**
 * The assist class of a course run (`resolveAssistClass`): the highest class of its played stages, or of a NONSTOP run's
 * stitched play.
 */
export function resolveCourseRunAssistClass(
  courseLog: Pick<BeMusicCourseReplay, 'stages' | 'nonstop'>,
): ReturnType<typeof resolveAssistClass> {
  const replays =
    courseLog.nonstop !== undefined
      ? [courseLog.nonstop.replay]
      : courseLog.stages.flatMap((entry) => (entry.played ? [entry.replay] : []));
  return resolveAssistClass(replays.flatMap((replay) => classifyReplayAssists(replay)));
}

/**
 * Whether a course run keeps an ordinary record: no autoplay, tempo training, affected zero-total policy or assisted
 * stage (`resolveCourseRunAssistClass`): LR2 saves no course stage with an assist on (`CheckScoreSaveConditon`), and
 * beatoraja turns `updateCourseScore` off and leaves an assisted course clear FAILED.
 */
export function courseRunKeepsRecord(courseLog: Pick<BeMusicCourseReplay, 'stages' | 'nonstop'>): boolean {
  const disabled = (replay: import('../replay/format.ts').BeMusicReplay): boolean =>
    isBmsonRecoveryDisabled(replay.chart, replay.play.bmsonTotalMode);
  return (
    !isCourseRunAutoPlayed(courseLog) &&
    !isCourseRunAtAnotherTempo(courseLog) &&
    resolveCourseRunAssistClass(courseLog) === 'none' &&
    !(courseLog.nonstop !== undefined
      ? disabled(courseLog.nonstop.replay)
      : courseLog.stages.some((entry) => entry.played && disabled(entry.replay)))
  );
}
