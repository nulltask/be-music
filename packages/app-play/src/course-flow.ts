import { CourseRun, type CourseRunStagePlan, type RandomCourseDrawFailure } from '@be-music/player-engine/course';
import {
  resolveCoursePlayedRuleset,
  type BeMusicCourseReplay,
  type ReplayCourseResult,
} from '@be-music/player-engine/replay';
import {
  resolveCourseView,
  type CourseView,
  type LibraryChart,
  type LibraryCourse,
} from '@be-music/player-scene-model';
import { EMPTY_COURSE_STAGE_HISTORY, type CourseStageHistory } from './course-result.ts';
import type { NonstopPlayFailure } from './nonstop-course.ts';
import { courseRunKeepsRecord, courseRunRecordPlay, type RecordPlay } from '@be-music/player-engine/records';
import { rulesetRecordKey } from './chart-best-records.ts';

/**
 * The decisions the player's course flow takes, kept apart from the scenes that act on them so they can be tested: what
 * a course bar starts, what a stage's end leads to, and which runs keep a record.
 */

/** What picking a course bar starts. */
export type CourseStartPlan =
  /** A NEW COURSE bar: start making a course of its folder's kind. */
  | { action: 'make'; kind: LibraryCourse['definition']['kind'] }
  /** A course with a stage missing from the collection: nothing starts. */
  | { action: 'unplayable' }
  /** A random course: draw its stages first, then plan the drawn course. */
  | { action: 'draw' }
  /** A NONSTOP course: stitch its stages and play them as one chart. */
  | { action: 'nonstop' }
  /** Any other course: play its stages one by one. */
  | { action: 'stages' };

export function planCourseStart(entry: LibraryCourse): CourseStartPlan {
  if (entry.newCourse === true) return { action: 'make', kind: entry.definition.kind };
  if (!entry.playable) return { action: 'unplayable' };
  if (entry.random !== undefined) return { action: 'draw' };
  return entry.definition.kind === 'nonstop' ? { action: 'nonstop' } : { action: 'stages' };
}

/** An EXPERT / GRADE course being played: the course bar it started from and its run. */
export interface ActiveCourse {
  course: LibraryCourse;
  run: CourseRun<LibraryChart, CourseStageHistory>;
}

/** A stage of a running course as the player plays it: the run's plan, with the course as the skins show it there. */
export interface CourseStagePlay extends CourseRunStagePlan<LibraryChart> {
  courseInfo: CourseView;
}

/** Starts a run of a course whose stages are all in the collection (`CourseRun` refuses one with a stage missing). */
export function startCourseRun(course: LibraryCourse): ActiveCourse {
  return {
    course,
    run: new CourseRun(
      course.definition,
      course.stages.map((stage) => stage.chart),
    ),
  };
}

/** The next stage of a running course, with the course as the skins show it there; `undefined` once the run is over. */
export function nextCourseStagePlay(active: ActiveCourse): CourseStagePlay | undefined {
  const plan = active.run.nextStage();
  return plan === undefined ? undefined : { ...plan, courseInfo: resolveCourseView(active.course, plan.index) };
}

/** The course as the skins show it at the stage last played (none before the first one). */
export function activeCourseInfo(active: ActiveCourse): CourseView {
  const played = active.run.stagesPlayed;
  return resolveCourseView(active.course, played > 0 ? played - 1 : undefined);
}

/** The graphs of every stage played, in order: a stage given up, or played without graphs, has empty ones. */
export function courseStageHistories(active: ActiveCourse): CourseStageHistory[] {
  return active.run.stageExtras.map((history) => history ?? EMPTY_COURSE_STAGE_HISTORY);
}

/**
 * The song the decide screen shows before a course's first stage. It names the selected bar, the course, as LR2's
 * splash does; the first stage's chart supplies the rest, without the stage's own subtitle, artist and genre.
 */
export function courseDecideSong(course: LibraryCourse, first: LibraryChart): LibraryChart {
  const { subtitle: _subtitle, artist: _artist, genre: _genre, ...stage } = first;
  return { ...stage, title: course.definition.name };
}

/** The status line for a course that cannot start because some of its stages are not in the collection. */
export function describeUnplayableCourse(course: LibraryCourse): string {
  const missing = course.stages.filter((stage) => stage.chart === undefined).length;
  const count = missing === 1 ? '1 stage is' : `${missing} stages are`;
  return `${course.definition.name}: ${count} not in the collection`;
}

/** The status line for a random course whose stages could not be drawn. */
export function describeRandomCourseDrawFailure(name: string, failure: RandomCourseDrawFailure): string {
  const why =
    failure.reason === 'no-candidates' ? 'matches no chart' : `has an invalid filter (${failure.error ?? ''})`;
  return `${name}: stage ${failure.stage + 1} ${why}`;
}

/** The status line for a NONSTOP course that could not be stitched. */
export function describeNonstopPrepareFailure(
  name: string,
  failure: { reason: NonstopPlayFailure; stage?: number },
): string {
  const stage = failure.stage !== undefined ? ` (stage ${failure.stage + 1})` : '';
  return `${name}: cannot stitch the NONSTOP course: ${failure.reason}${stage}`;
}

/**
 * The record a course run leaves under the course's `key`, kept under the judge ruleset the run was played on
 * (`resolveCoursePlayedRuleset`), or `undefined` when the run keeps none: an auto-played run, one at another tempo,
 * which is practice (and the Leaderboard refuses it as `tempo`), and one whose stages were judged under different
 * rulesets.
 */
export function resolveCourseBestRecordUpdate(
  courseLog: Pick<BeMusicCourseReplay, 'stages' | 'nonstop'>,
  result: ReplayCourseResult,
  key: string,
): { key: string; play: RecordPlay } | undefined {
  const ruleset = resolveCoursePlayedRuleset(courseLog);
  if (ruleset === undefined || !courseRunKeepsRecord(courseLog)) return undefined;
  return { key: rulesetRecordKey(ruleset, key), play: courseRunRecordPlay(result) };
}

/** What a play is, for the gameplay exits below. */
export interface CoursePlayKind {
  /** A stage of a running EXPERT / GRADE course. */
  courseStage: boolean;
  /** A NONSTOP course's stitched play. */
  nonstop: boolean;
}

/**
 * Where ESC leads: a running course is given up and ends as a failed run (its course result shows), a NONSTOP run shows
 * its result as it stands, and a single chart goes back to the select screen.
 */
export function resolveGameplayExit(play: CoursePlayKind): 'give-up-course' | 'nonstop-result' | 'select' {
  if (play.courseStage) return 'give-up-course';
  return play.nonstop ? 'nonstop-result' : 'select';
}

/**
 * Where F5 (restart) leads: a NONSTOP course is stitched and played again, as LR2 allows quick retry there; in a course
 * stage it gives the course up, since quick retry is off there; a single chart plays again.
 */
export function resolveGameplayRestart(play: CoursePlayKind): 'restitch' | 'abandon-course' | 'replay' {
  if (play.nonstop) return 'restitch';
  return play.courseStage ? 'abandon-course' : 'replay';
}

/**
 * The overrides a single chart plays again with (F5): the play's own AUTO and replay, not the Debug Menu's. Without
 * them an AUTO play started from a skin's AUTO button would start again as a manual play, and a replay as a live play
 * that keeps a record.
 */
export function playAgainOverrides<L>(play: { autoPlay: boolean; replay?: L | undefined }): {
  autoPlay: boolean;
  replay?: L;
} {
  return { autoPlay: play.autoPlay, ...(play.replay !== undefined ? { replay: play.replay } : {}) };
}

/**
 * What R on the result does: a NONSTOP run is stitched and played again; a single chart plays again when the last
 * play started is this chart's; a course stage or a course result offers no retry, as LR2 and beatoraja disable quick
 * retry there.
 */
export function resolveResultRetry<T>(options: {
  /** Whether the result offers quick retry at all (`resolveResultPresentation`). */
  quickRetry: boolean;
  nonstopRetry?: () => void;
  chartId: string;
  lastPlay?: { chartId: string; play: T };
}): { kind: 'nonstop'; retry: () => void } | { kind: 'replay'; play: T } | undefined {
  if (options.nonstopRetry !== undefined) return { kind: 'nonstop', retry: options.nonstopRetry };
  if (!options.quickRetry || options.lastPlay?.chartId !== options.chartId) return undefined;
  return { kind: 'replay', play: options.lastPlay.play };
}
