import type { PlayerSummary } from '@be-music/player/core/engine';
import { resolveCourseTrophy, type PlaylogCourseResult } from '@be-music/player/playlog';
import type { BrowserCourseEntry } from '@be-music/player-web/collection';
import type { BeMusicCourseRecord, BeMusicSongRecord } from '@be-music/player-web/skin';

/*
 * How the demo shows a course run's results: when a stage's result is skipped, the records kept per course, and the
 * course result as a beatoraja result skin reads it. The run itself is `CourseRun` (`@be-music/player/course`); its
 * result payload, the stage graphs and how a result is presented are the play result model of `@be-music/scene-model`.
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
export function courseRecordKey(course: BrowserCourseEntry, placement: 'intended' | 'lr2' = 'intended'): string {
  const { definition } = course;
  const stages = definition.stages.map((stage) => stage.sha256 ?? stage.md5 ?? '').join(',');
  const key = `course:${definition.kind}:${[...definition.constraints].sort().join('+')}:${stages}`;
  if (definition.kind !== 'nonstop') return key;
  // A NONSTOP course's connections and placement decide the chart that is played, as in its course fingerprint.
  const connections = (definition.connections ?? []).slice(0, Math.max(0, definition.stages.length - 1));
  return `${key}:${connections.join('+')}:${placement}`;
}

/**
 * The player's best record on a course bar, read from the records under {@link courseRecordKey}, with the trophy its
 * bests earn: beatoraja's `GradeBar.getTrophy` takes the best EX score and the fewest BP (which may come from different
 * runs) over the course's notes, whether the run cleared or not. A random course bar (its stages are drawn on start)
 * and a NEW COURSE bar have no record. A NONSTOP course reads the record of the placement it would be played with.
 */
export function lookupCourseRecord(
  course: BrowserCourseEntry,
  records: { get(key: string): BeMusicSongRecord | undefined },
  placement: 'intended' | 'lr2' = 'intended',
): BeMusicCourseRecord | undefined {
  if (course.random !== undefined || course.newCourse === true) return undefined;
  const record = records.get(courseRecordKey(course, placement));
  if (record === undefined) return undefined;
  const noteCount = course.stages.reduce((sum, stage) => sum + (stage.song?.totalNotes ?? 0), 0);
  if (record.exScore === undefined || record.missCount === undefined || noteCount <= 0) return record;
  const trophy = resolveCourseTrophy(course.definition.trophies, {
    exScore: record.exScore,
    missCount: record.missCount,
    noteCount,
  });
  return trophy !== undefined ? { ...record, trophy } : record;
}

/**
 * The course result as a beatoraja result skin reads one run (`PlayerSummary`): the course's summed judgments, its
 * EX score (beatoraja's score) and the gauge the course ended on. beatoraja keeps the course score the same way
 * (`CourseResult` sums the stage scores).
 */
export function buildCourseResultSummary(result: PlaylogCourseResult): PlayerSummary {
  return {
    total: result.noteCount,
    perfect: result.judge.pgreat,
    great: result.judge.great,
    good: result.judge.good,
    bad: result.judge.bad,
    poor: result.judge.poor,
    emptyPoor: result.judge.emptyPoor,
    fast: result.fast,
    slow: result.slow,
    exScore: result.exScore,
    score: result.exScore,
    gauge: {
      type: result.gauge.type,
      current: result.gauge.final,
      max: 100,
      initial: 100,
      clearThreshold: 0,
      effectiveTotal: 0,
      cleared: result.gauge.cleared,
      survival: true,
    },
    course: { combo: 0, maxCombo: result.maxCombo },
  };
}
