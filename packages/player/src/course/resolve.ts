import type { CourseDefinition, CourseStageRef } from './definition.ts';

/** Finds a local chart by file hash. Implementations return `undefined` when they hold no such chart. */
export interface CourseChartLookup<T> {
  bySha256(sha256: string): T | undefined;
  byMd5(md5: string): T | undefined;
}

export interface ResolvedCourseStage<T> {
  ref: CourseStageRef;
  /** The local chart, or `undefined` when it is missing. */
  chart: T | undefined;
}

export interface ResolvedCourse<T> {
  course: CourseDefinition;
  stages: ResolvedCourseStage<T>[];
  /** Every stage was found. A course with a missing stage is listed but cannot be started (LR2 and beatoraja alike). */
  playable: boolean;
}

/**
 * Matches each stage to a local chart: by SHA-256 when the stage has one, else by MD5, as beatoraja's `TableBar` does.
 * A stage carrying both hashes falls back to its MD5 when no chart has its SHA-256.
 */
export function resolveCourseStages<T>(course: CourseDefinition, lookup: CourseChartLookup<T>): ResolvedCourse<T> {
  const stages = course.stages.map((ref) => ({
    ref,
    chart:
      (ref.sha256 !== undefined ? lookup.bySha256(ref.sha256) : undefined) ??
      (ref.md5 !== undefined ? lookup.byMd5(ref.md5) : undefined),
  }));
  return { course, stages, playable: stages.every((stage) => stage.chart !== undefined) };
}
