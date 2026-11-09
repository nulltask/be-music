import { classifyReplayAssists, resolveAssistClass } from '@be-music/player-engine/records';
import { resolveClearLamp } from '@be-music/player-engine/ruleset';
import { isAutoPlayResult } from '@be-music/player-scene-model';
import type { BeMusicResultData } from './result-data.ts';
import { formatPlayVariantLabel } from './chart-stats.ts';
import { COURSE_KIND_LABELS } from './select-list.ts';

/**
 * The play's clear lamp as the result track column labels it: `PERFECT` (every note a PGREAT), `FULL COMBO` (no BAD /
 * POOR), `CLEAR`, or `FAILED`. Empty POORs never break a combo, so they don't cost a full combo either.
 */
export type ResultLamp = 'PERFECT' | 'FULL COMBO' | 'CLEAR' | 'FAILED';

/**
 * The result track's label for the play's clear lamp, by the one clear-lamp rule (`resolveClearLamp` of
 * `@be-music/player-engine/ruleset`) on beatoraja's full set of lamps: MAX reads `PERFECT`, a PERFECT or FULL COMBO lamp
 * `FULL COMBO`, and any other clear `CLEAR`.
 */
export function resolveResultLamp(result: Pick<BeMusicResultData, 'score' | 'cleared'>): ResultLamp {
  const lamp = resolveClearLamp({ cleared: result.cleared, score: result.score });
  if (lamp === 'FAILED') return 'FAILED';
  if (lamp === 'MAX') return 'PERFECT';
  return lamp === 'PERFECT' || lamp === 'FULL_COMBO' ? 'FULL COMBO' : 'CLEAR';
}

/** The headline a result screen leads with. */
export type ResultVerdict = 'STAGE CLEAR' | 'FAILED' | 'COURSE CLEAR' | 'COURSE FAILED';

/**
 * The result's headline: `STAGE CLEAR` / `FAILED` for one play, `COURSE CLEAR` / `COURSE FAILED` for the result of a
 * whole EXPERT / GRADE course run (`run: 'course'`). A course stage and a NONSTOP run read as one play.
 */
export function resolveResultVerdict(result: Pick<BeMusicResultData, 'cleared' | 'run'>): ResultVerdict {
  if (result.run === 'course') return result.cleared ? 'COURSE CLEAR' : 'COURSE FAILED';
  return result.cleared ? 'STAGE CLEAR' : 'FAILED';
}

/**
 * How a result was played, when not by the player's hands alone: `AUTO PLAY` for a full AUTO play, `ASSIST` for a play
 * with assisted options (AUTO SCRATCH, a widened judge, …).
 */
export type ResultPlayTag = 'AUTO PLAY' | 'ASSIST';

const ASSISTED_REPLAYS = new WeakMap<object, boolean>();

/**
 * The tag a result screen shows beside its verdict, so an AUTO or assisted play's result never reads as a plain one: `AUTO
 * PLAY` for a full AUTO play (`isAutoPlayResult` of `@be-music/player-scene-model`, as LR2 keeps AUTOPLAY on through the
 * result), else `ASSIST` when the replay the play recorded used an assisted option by the assist policy the clear lamp and
 * the Leaderboard follow (`classifyReplayAssists`, #602), else none. A play without a recorded replay (a replay played
 * back, a course run) reads only its AUTO flag.
 */
export function resolveResultPlayTag(
  result: Pick<BeMusicResultData, 'autoPlay' | 'replay'>,
): ResultPlayTag | undefined {
  if (isAutoPlayResult(result)) return 'AUTO PLAY';
  const { replay } = result;
  if (replay === undefined) return undefined;
  let assisted = ASSISTED_REPLAYS.get(replay);
  if (assisted === undefined) {
    assisted = resolveAssistClass(classifyReplayAssists(replay)) !== 'none';
    ASSISTED_REPLAYS.set(replay, assisted);
  }
  return assisted ? 'ASSIST' : undefined;
}

/** One label / value line of the track column. */
export interface ResultTrackRow {
  label: string;
  value: string;
}

/**
 * The chart facts the 16:9 result screens list beside the score grid: play mode, level, tempo, and the combo breaks
 * (BAD + POOR) of the run.
 */
export function resolveResultTrackRows(result: Pick<BeMusicResultData, 'score' | 'chart'>): ResultTrackRow[] {
  const { chart: chartEntry, score } = result;
  return [
    { label: 'MODE', value: formatPlayVariantLabel(chartEntry) },
    {
      label: 'LEVEL',
      value:
        chartEntry.playLevel !== undefined && String(chartEntry.playLevel) !== '' ? String(chartEntry.playLevel) : '-',
    },
    {
      label: 'BPM',
      value: chartEntry.bpm !== undefined && Number.isFinite(chartEntry.bpm) ? String(Math.round(chartEntry.bpm)) : '-',
    },
    { label: 'COMBO BREAK', value: String(Math.max(0, score.bad + score.poor)) },
  ];
}

/** One stage of a course run, as its result's track column lists it. */
export interface ResultCourseStageRow {
  /** The stage number, from 1. */
  stage: number;
  title: string;
  subtitle?: string;
  artist?: string;
  genre?: string;
  /** The chart's play level, `-` when unknown. */
  level: string;
  /** The chart's `#DIFFICULTY` (1 BEGINNER … 5 INSANE), when known. */
  difficulty?: number;
  /** The run reached the stage; a stage after the one a course failed on reads `false`. */
  played: boolean;
}

/** What the track column of a course run's result shows in place of one chart: the course and its stages. */
export interface ResultCourseCard {
  /** `DAN`, `COURSE` or `NONSTOP`. */
  kind: string;
  title: string;
  /** The stages reached out of the course's, and the trophy earned (`2 / 4 STAGES · goldmedal`). */
  detail: string;
  stages: ResultCourseStageRow[];
}

/**
 * The course card of a course run's result (an EXPERT / GRADE run, or a NONSTOP run, its stitched play as one): the
 * course and every stage chart it plays in order, the ones the run never reached marked unplayed. `undefined` for any
 * other result, a course stage's included, whose track column shows its own chart.
 */
export function resolveResultCourseCard(
  result: Pick<BeMusicResultData, 'run' | 'course' | 'courseRun'>,
): ResultCourseCard | undefined {
  const { course, courseRun } = result;
  if (course === undefined || course.stageIndex !== undefined) return undefined;
  if (result.run !== 'course' && result.run !== 'nonstop') return undefined;
  const total = course.stages.length;
  // A NONSTOP run without a course log (a practice run) played every stage of its stitched chart.
  const reached = Math.min(total, courseRun?.stagesPlayed ?? total);
  const detail = [`${reached} / ${total} STAGES`, ...(courseRun?.trophy !== undefined ? [courseRun.trophy] : [])];
  return {
    kind: COURSE_KIND_LABELS[course.kind],
    title: course.title,
    detail: detail.join(' · '),
    stages: course.stages.map((stage, index) => ({
      stage: index + 1,
      title: stage.title,
      ...(stage.subtitle !== undefined ? { subtitle: stage.subtitle } : {}),
      ...(stage.artist !== undefined ? { artist: stage.artist } : {}),
      ...(stage.genre !== undefined ? { genre: stage.genre } : {}),
      level: stage.level !== undefined ? String(stage.level) : '-',
      ...(stage.difficulty !== undefined ? { difficulty: stage.difficulty } : {}),
      played: index < reached,
    })),
  };
}

/** How a course card's stage list scrolls when its stages do not fit ({@link resolveResultCourseScroll}). */
export interface ResultCourseScrollTiming {
  /** How long the list rests at the top, and again at the bottom, before it moves on. */
  holdMs: number;
  /** How fast it scrolls, in px per second. */
  pxPerSecond: number;
}

/** The built-in skins' timing: a 2.5 s rest at each end, 30 px a second between. */
export const RESULT_COURSE_SCROLL_TIMING: Readonly<ResultCourseScrollTiming> = { holdMs: 2500, pxPerSecond: 30 };

/**
 * How far (px, 0..`overflowPx`) a course card's stage list has scrolled up `elapsedMs` into the result, when the stages
 * laid out at their usual height run `overflowPx` past the card: it rests at the top, scrolls up until the last stage is
 * at the bottom, rests there, then starts again from the top. 0 for a list that fits, and before the result shows.
 */
export function resolveResultCourseScroll(
  overflowPx: number,
  elapsedMs: number,
  timing: Readonly<ResultCourseScrollTiming> = RESULT_COURSE_SCROLL_TIMING,
): number {
  if (!(overflowPx > 0) || !(elapsedMs > 0) || !Number.isFinite(elapsedMs) || !(timing.pxPerSecond > 0)) return 0;
  const hold = Math.max(0, timing.holdMs);
  const travel = (overflowPx / timing.pxPerSecond) * 1000;
  const t = elapsedMs % (hold * 2 + travel);
  if (t < hold) return 0;
  if (t < hold + travel) return ((t - hold) / travel) * overflowPx;
  return overflowPx;
}
