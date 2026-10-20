import { resolveCourseTrophy } from '@be-music/player/replay';
import type { LibraryCourse } from '@be-music/scene-model';
import type { BeMusicCourseBestRecord, BeMusicChartBestRecord } from '@be-music/skin-sdk';

/*
 * How the demo shows a course run's results: when a stage's result is skipped, and the records kept per course. The
 * run itself is `CourseRun` (`@be-music/player/course`); its result payload (on every family's result screen), the
 * stage graphs and how a result is presented are the play result model of `@be-music/scene-model`.
 */

export {
  EMPTY_COURSE_STAGE_HISTORY,
  joinCourseStageHistories,
  playResultFromCourseRun as buildCourseResultData,
  resolveResultPresentation,
  type CourseStageHistory,
  type PlayRunKind as ResultRun,
} from '@be-music/scene-model';

/**
 * Whether a finished course stage goes straight on to the next stage without showing its result: always with stage
 * results skipped (the Debug Menu's **Skip stage results**), and, as LR2 does (OpenLR2 `Main.cpp` M1381-M1384), when the
 * course plays itself and goes on after the stage. The last stage's result (or a failed one's) still shows then.
 */
export function skipsCourseStageResult(options: {
  skipStageResults: boolean;
  autoPlay: boolean;
  courseGoesOn: boolean;
}): boolean {
  return options.skipStageResults || (options.autoPlay && options.courseGoesOn);
}

/**
 * The key a course's best record is kept under: the course kind, its constraints and its stages' chart hashes in
 * order (SHA-256 when the course names one, else MD5), like beatoraja keys course scores on the stage hashes.
 */
export function courseBestRecordKey(course: LibraryCourse, placement: 'intended' | 'lr2' = 'intended'): string {
  const { definition } = course;
  const stages = definition.stages.map((stage) => stage.sha256 ?? stage.md5 ?? '').join(',');
  const key = `course:${definition.kind}:${[...definition.constraints].sort().join('+')}:${stages}`;
  if (definition.kind !== 'nonstop') return key;
  // A NONSTOP course's connections and placement decide the chart that is played, as in its course fingerprint.
  const connections = (definition.connections ?? []).slice(0, Math.max(0, definition.stages.length - 1));
  return `${key}:${connections.join('+')}:${placement}`;
}

/**
 * The player's best record on a course bar, read from the records under {@link courseBestRecordKey}, with the trophy its
 * bests earn: beatoraja's `GradeBar.getTrophy` takes the best EX score and the fewest BP (which may come from different
 * runs) over the course's notes, whether the run cleared or not. A random course bar (its stages are drawn on start)
 * and a NEW COURSE bar have no record. A NONSTOP course reads the record of the placement it would be played with.
 */
export function lookupCourseBestRecord(
  course: LibraryCourse,
  records: { get(key: string): BeMusicChartBestRecord | undefined },
  placement: 'intended' | 'lr2' = 'intended',
): BeMusicCourseBestRecord | undefined {
  if (course.random !== undefined || course.newCourse === true) return undefined;
  const record = records.get(courseBestRecordKey(course, placement));
  if (record === undefined) return undefined;
  const noteCount = course.stages.reduce((sum, stage) => sum + (stage.chart?.totalNotes ?? 0), 0);
  if (record.exScore === undefined || record.missCount === undefined || noteCount <= 0) return record;
  const trophy = resolveCourseTrophy(course.definition.trophies, {
    exScore: record.exScore,
    missCount: record.missCount,
    noteCount,
  });
  return trophy !== undefined ? { ...record, trophy } : record;
}
