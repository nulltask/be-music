import type { RandomCourseDrawFailure } from '@be-music/player/course';
import type { BeMusicCoursePlaylog, PlaylogCourseResult } from '@be-music/player/playlog';
import type { BrowserCourseEntry, BrowserSongEntry } from '@be-music/player-web/collection';
import type { NonstopPrepareFailure } from './nonstop-course.ts';
import { courseRunKeepsRecord, type SongRecordPlay } from './song-records.ts';

/**
 * The decisions the demo's course flow takes, kept apart from the scenes that act on them so they can be tested: what
 * a course bar starts, what a stage's end leads to, and which runs keep a record.
 */

/** What picking a course bar starts. */
export type CourseStartPlan =
  /** A NEW COURSE bar: start making a course of its folder's kind. */
  | { action: 'make'; kind: BrowserCourseEntry['definition']['kind'] }
  /** A course with a stage missing from the collection: nothing starts. */
  | { action: 'unplayable' }
  /** A random course: draw its stages first, then plan the drawn course. */
  | { action: 'draw' }
  /** A NONSTOP course: stitch its stages and play them as one chart. */
  | { action: 'nonstop' }
  /** Any other course: play its stages one by one. */
  | { action: 'stages' };

export function planCourseStart(entry: BrowserCourseEntry): CourseStartPlan {
  if (entry.newCourse === true) return { action: 'make', kind: entry.definition.kind };
  if (!entry.playable) return { action: 'unplayable' };
  if (entry.random !== undefined) return { action: 'draw' };
  return entry.definition.kind === 'nonstop' ? { action: 'nonstop' } : { action: 'stages' };
}

/**
 * The song the decide screen shows before a course's first stage. It names the selected bar, the course, as LR2's
 * splash does; the first stage's chart supplies the rest, without the stage's own subtitle, artist and genre.
 */
export function courseDecideSong(course: BrowserCourseEntry, first: BrowserSongEntry): BrowserSongEntry {
  const { subtitle: _subtitle, artist: _artist, genre: _genre, ...stage } = first;
  return { ...stage, title: course.definition.name };
}

/** The status line for a course that cannot start because some of its stages are not in the collection. */
export function describeUnplayableCourse(course: BrowserCourseEntry): string {
  const missing = course.stages.filter((stage) => stage.song === undefined).length;
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
  failure: { reason: NonstopPrepareFailure; stage?: number },
): string {
  const stage = failure.stage !== undefined ? ` (stage ${failure.stage + 1})` : '';
  return `${name}: cannot stitch the NONSTOP course: ${failure.reason}${stage}`;
}

/** The record facts of a course run's result, as a chart's best record keeps them. */
export function courseRecordPlay(result: PlaylogCourseResult): SongRecordPlay {
  return { lamp: result.lamp, exScore: result.exScore, maxCombo: result.maxCombo, missCount: result.missCount };
}

/**
 * The record a course run leaves under `key`, or `undefined` when the run keeps none: an auto-played run, or one at
 * another tempo, which is practice (and the Leaderboard refuses it as `tempo`).
 */
export function resolveCourseRecordUpdate(
  courseLog: Pick<BeMusicCoursePlaylog, 'stages' | 'nonstop'>,
  result: PlaylogCourseResult,
  key: string,
): { key: string; play: SongRecordPlay } | undefined {
  return courseRunKeepsRecord(courseLog) ? { key, play: courseRecordPlay(result) } : undefined;
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
 * What R on the result does: a NONSTOP run is stitched and played again; a single chart plays again when the last
 * play started is this chart's; a course stage or a course result offers no retry, as LR2 and beatoraja disable quick
 * retry there.
 */
export function resolveResultRetry<T>(options: {
  /** Whether the result offers quick retry at all (`resolveResultPresentation`). */
  quickRetry: boolean;
  nonstopRetry?: () => void;
  songId: string;
  lastPlay?: { songId: string; play: T };
}): { kind: 'nonstop'; retry: () => void } | { kind: 'replay'; play: T } | undefined {
  if (options.nonstopRetry !== undefined) return { kind: 'nonstop', retry: options.nonstopRetry };
  if (!options.quickRetry || options.lastPlay?.songId !== options.songId) return undefined;
  return { kind: 'replay', play: options.lastPlay.play };
}
