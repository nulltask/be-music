import type { BeMusicCoursePlaylog } from './course.ts';
import { computeCoursePlaylogFingerprint } from './course-fingerprint.ts';
import { checkPlaylogEligibility, type PlaylogAssistFlag } from './eligibility.ts';

/**
 * Why a course run cannot be ranked. `auto-play`, `aborted` and `missing-fingerprint` mean what they mean for a single
 * play, for any stage (`missing-fingerprint` also covers an unreached stage without its chart fingerprint, and a NONSTOP
 * run's stitched play without its fingerprints). `tempo` is a run with a stage (or a NONSTOP run's stitched play) played
 * at another tempo: practice, as for a single play. `not-a-course-run` is a log whose stages do not make one run: no
 * stage played, a played stage after an unreached one, a stage log that was not played as a stage of this course (no
 * `play.course`, or another course kind), or a NONSTOP run whose stitched play does not cover the course's stages.
 */
export type CoursePlaylogIneligibleReason =
  | 'auto-play'
  | 'aborted'
  | 'tempo'
  | 'missing-fingerprint'
  | 'not-a-course-run';

export type CoursePlaylogEligibility =
  | {
      eligible: true;
      /** The course's ranking key (`computeCoursePlaylogFingerprint`). */
      courseFingerprint: string;
      /**
       * The played stages' fingerprints, in order. Empty for a NONSTOP run: its stages were not played on their own, and
       * a verifier rebuilds them from their charts instead.
       */
      stages: Array<{ chartFingerprint: string; playFingerprint: string }>;
      /** A NONSTOP run: the fingerprints of its stitched play (`courseLog.nonstop.playlog`), which was judged. */
      nonstop?: { chartFingerprint: string; playFingerprint: string };
      /** Every assist any stage used, once each. */
      assistFlags: PlaylogAssistFlag[];
    }
  | { eligible: false; reason: CoursePlaylogIneligibleReason; /** The stage at fault, zero-based. */ stage?: number };

type Ineligible = Extract<CoursePlaylogEligibility, { eligible: false }>;

/**
 * Decides whether a course run can be ranked (docs/leaderboard.md, course rankings), for the client that submits it and
 * the server that ranks it. Each played stage must pass the single-play check, except that being a course stage is what
 * it must be here; assists of any stage flag the run. The last stage played may have been given up (ESC): a course
 * given up is ranked as a failed run, as LR2 records it, so only an earlier stage's abort refuses the run.
 *
 * A NONSTOP run (`courseLog.nonstop`) was one play of the stitched chart: that play passes the single-play check
 * instead (an ESC abort is a failed run there too), it must cover every stage of the course, and each stage must still
 * name its chart, since the stage charts key the course.
 */
export function checkCoursePlaylogEligibility(courseLog: BeMusicCoursePlaylog): CoursePlaylogEligibility {
  const order = checkStageOrder(courseLog);
  if (order !== undefined) return order;
  if (courseLog.nonstop !== undefined) return checkNonstopEligibility(courseLog);
  const stages: Array<{ chartFingerprint: string; playFingerprint: string }> = [];
  const assistFlags = new Set<PlaylogAssistFlag>();
  const lastPlayed = courseLog.stages.reduce((last, entry, index) => (entry.played ? index : last), -1);
  for (const [index, entry] of courseLog.stages.entries()) {
    if (!entry.played) continue;
    const { course, ...play } = entry.playlog.play;
    if (course === undefined || course.kind !== courseLog.course.kind) {
      return { eligible: false, reason: 'not-a-course-run', stage: index };
    }
    // A course given up with ESC is a failed run (as LR2 records it): its last played stage may be aborted, no other.
    const givenUp = play.aborted === true && index === lastPlayed;
    const single = checkPlaylogEligibility({
      ...entry.playlog,
      play: givenUp ? { ...play, aborted: false } : play,
    });
    if (!single.eligible) {
      return { eligible: false, reason: single.reason as CoursePlaylogIneligibleReason, stage: index };
    }
    stages.push({ chartFingerprint: single.chartFingerprint, playFingerprint: single.playFingerprint });
    for (const flag of single.assistFlags) assistFlags.add(flag);
  }
  const courseFingerprint = computeCoursePlaylogFingerprint(courseLog);
  if (courseFingerprint === undefined) return { eligible: false, reason: 'missing-fingerprint' };
  return { eligible: true, courseFingerprint, stages, assistFlags: [...assistFlags] };
}

/**
 * The checks every course log shares: the first stage was played, no stage was played after an unreached one, and
 * every unreached stage names its chart.
 */
function checkStageOrder(courseLog: BeMusicCoursePlaylog): Ineligible | undefined {
  let reachedEnd = false;
  for (const [index, entry] of courseLog.stages.entries()) {
    if (entry.played) {
      if (reachedEnd) return { eligible: false, reason: 'not-a-course-run', stage: index };
      continue;
    }
    if (index === 0) return { eligible: false, reason: 'not-a-course-run', stage: index };
    reachedEnd = true;
    if (entry.chartFingerprint === undefined) return { eligible: false, reason: 'missing-fingerprint', stage: index };
  }
  return undefined;
}

function checkNonstopEligibility(courseLog: BeMusicCoursePlaylog): CoursePlaylogEligibility {
  const run = courseLog.nonstop!;
  const { course, ...play } = run.playlog.play;
  if (
    courseLog.course.kind !== 'nonstop' ||
    course?.kind !== 'nonstop' ||
    run.stages.length !== courseLog.stages.length
  ) {
    return { eligible: false, reason: 'not-a-course-run' };
  }
  // A NONSTOP play given up with ESC is a failed run.
  const single = checkPlaylogEligibility({ ...run.playlog, play: { ...play, aborted: false } });
  if (!single.eligible) return { eligible: false, reason: single.reason as CoursePlaylogIneligibleReason };
  for (const [index, entry] of courseLog.stages.entries()) {
    if (entry.played && entry.playlog.chart.chartFingerprint === undefined) {
      return { eligible: false, reason: 'missing-fingerprint', stage: index };
    }
  }
  const courseFingerprint = computeCoursePlaylogFingerprint(courseLog);
  if (courseFingerprint === undefined) return { eligible: false, reason: 'missing-fingerprint' };
  return {
    eligible: true,
    courseFingerprint,
    stages: [],
    nonstop: { chartFingerprint: single.chartFingerprint, playFingerprint: single.playFingerprint },
    assistFlags: single.assistFlags,
  };
}
