import type { BeMusicCoursePlaylog } from './course.ts';
import { computeCoursePlaylogFingerprint } from './course-fingerprint.ts';
import { checkPlaylogEligibility, type PlaylogAssistFlag } from './eligibility.ts';

/**
 * Why a course run cannot be ranked. `auto-play`, `aborted` and `missing-fingerprint` mean what they mean for a single
 * play, for any stage (`missing-fingerprint` also covers an unreached stage without its chart fingerprint).
 * `not-a-course-run` is a log whose stages do not make one run: no stage played, a played stage after an unreached one,
 * or a stage log that was not played as a stage of this course (no `play.course`, or another course kind).
 */
export type CoursePlaylogIneligibleReason = 'auto-play' | 'aborted' | 'missing-fingerprint' | 'not-a-course-run';

export type CoursePlaylogEligibility =
  | {
      eligible: true;
      /** The course's ranking key (`computeCoursePlaylogFingerprint`). */
      courseFingerprint: string;
      /** The played stages' fingerprints, in order. */
      stages: Array<{ chartFingerprint: string; playFingerprint: string }>;
      /** Every assist any stage used, once each. */
      assistFlags: PlaylogAssistFlag[];
    }
  | { eligible: false; reason: CoursePlaylogIneligibleReason; /** The stage at fault, zero-based. */ stage?: number };

/**
 * Decides whether a course run can be ranked (docs/leaderboard.md, course rankings), for the client that submits it and
 * the server that ranks it. Each played stage must pass the single-play check, except that being a course stage is what
 * it must be here; assists of any stage flag the run. Whether a run that stopped before the last stage was failed or
 * given up needs the stages re-simulated, so the server decides that.
 */
export function checkCoursePlaylogEligibility(courseLog: BeMusicCoursePlaylog): CoursePlaylogEligibility {
  const stages: Array<{ chartFingerprint: string; playFingerprint: string }> = [];
  const assistFlags = new Set<PlaylogAssistFlag>();
  let reachedEnd = false;
  for (const [index, entry] of courseLog.stages.entries()) {
    if (!entry.played) {
      if (index === 0) return { eligible: false, reason: 'not-a-course-run', stage: index };
      reachedEnd = true;
      if (entry.chartFingerprint === undefined) return { eligible: false, reason: 'missing-fingerprint', stage: index };
      continue;
    }
    const { course, ...play } = entry.playlog.play;
    if (reachedEnd || course === undefined || course.kind !== courseLog.course.kind) {
      return { eligible: false, reason: 'not-a-course-run', stage: index };
    }
    const single = checkPlaylogEligibility({ ...entry.playlog, play });
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
