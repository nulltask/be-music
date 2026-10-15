import { sha256Hex } from '@be-music/chart';
import { normalizeCourseConstraints, type NonstopConnection } from '../course/definition.ts';
import type { RulesetCourseKind } from '../ruleset/course.ts';
import type { BeMusicCoursePlaylog } from './course.ts';

/** The version prefix of a course fingerprint. Version `0`, like `bmfp0`, may still change between releases. */
export const COURSE_FINGERPRINT_VERSION = 'bmcourse0';

/** What identifies a course: its kind, its constraints and its stages' charts, in order. */
export interface CourseFingerprintInput {
  kind: RulesetCourseKind;
  /** Constraint names, in table-header (`grade_mirror`) or beatoraja enum (`MIRROR`) form, in any order. */
  constraints: readonly string[];
  /** Each stage's chart fingerprint (`bmfp0:…`), in stage order. */
  stageChartFingerprints: readonly string[];
  /**
   * A NONSTOP course's connections (the one after each stage but the last) and placement mode. They decide the stitched
   * chart that is played, so two NONSTOP courses of the same charts joined differently are different courses.
   */
  nonstop?: { connections: readonly NonstopConnection[]; placement: 'intended' | 'lr2' };
}

/**
 * The course fingerprint (`bmcourse0:<sha256>`): a hash of the course kind, its constraints and its stages' chart
 * fingerprints in order. The constraints are normalized first (beatoraja's enum names read as their table-header names,
 * unknown names dropped, one per group as beatoraja keeps them) and sorted, and the course's name and trophies are left
 * out, so the same course read from a `.lr2crs`, a beatoraja course file or a difficulty table gets one fingerprint
 * whenever its charts match. A random course, once its stages are drawn, is keyed like a fixed one. A NONSTOP course
 * also includes its connections and placement mode (`input.nonstop`), which decide the chart that is played.
 */
export function computeCourseFingerprint(input: CourseFingerprintInput): string {
  const constraints = [...new Set(normalizeCourseConstraints(input.constraints))].sort();
  const stages = [...input.stageChartFingerprints];
  // Only the connections between the stages count: one listed after the last stage joins nothing.
  const nonstop =
    input.kind === 'nonstop' && input.nonstop !== undefined
      ? {
          connections: input.nonstop.connections.slice(0, Math.max(0, stages.length - 1)),
          placement: input.nonstop.placement,
        }
      : undefined;
  const canonical = JSON.stringify({
    kind: input.kind,
    constraints,
    stages,
    ...(nonstop !== undefined ? { nonstop } : {}),
  });
  return `${COURSE_FINGERPRINT_VERSION}:${sha256Hex(canonical)}`;
}

/**
 * Each stage's chart fingerprint as a course play log records it: a played stage's `chart.chartFingerprint`, an
 * unreached stage's own `chartFingerprint`. `undefined` where the log does not say.
 */
export function resolveCourseStageChartFingerprints(courseLog: BeMusicCoursePlaylog): Array<string | undefined> {
  return courseLog.stages.map((entry) =>
    entry.played ? entry.playlog.chart.chartFingerprint : entry.chartFingerprint,
  );
}

/**
 * The fingerprint of the course a course play log ran ({@link computeCourseFingerprint}), or `undefined` when a stage's
 * chart fingerprint is missing. Failed runs have one too: their unreached stages carry their chart fingerprint.
 */
export function computeCoursePlaylogFingerprint(courseLog: BeMusicCoursePlaylog): string | undefined {
  const stageChartFingerprints = resolveCourseStageChartFingerprints(courseLog);
  if (stageChartFingerprints.some((fingerprint) => fingerprint === undefined)) return undefined;
  const run = courseLog.nonstop;
  return computeCourseFingerprint({
    kind: courseLog.course.kind,
    constraints: courseLog.course.constraints,
    stageChartFingerprints: stageChartFingerprints as string[],
    ...(run !== undefined ? { nonstop: { connections: run.connections, placement: run.placement } } : {}),
  });
}
