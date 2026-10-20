import { canonicalizeJSONValue, sha256Hex } from '@be-music/chart-model';
import { normalizeCourseConstraints, type CourseConstraint, type NonstopConnection } from '../course/definition.ts';
import type { RulesetCourseKind } from '../ruleset/course.ts';
import type { BeMusicCourseReplay } from './course.ts';

/** The version of the course fingerprint. Version `0`, like `bmfp0`, may still change between releases. */
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
 * The canonical course fingerprint document (see `docs/fingerprint-spec.md`, "Course fingerprint"). Every field is a
 * string or a list of strings, so the document has one JSON form under RFC 8785.
 */
export interface CourseFingerprintDocument {
  v: typeof COURSE_FINGERPRINT_VERSION;
  kind: RulesetCourseKind;
  /** The normalized constraint names, sorted. */
  constraints: CourseConstraint[];
  /** The stages' chart fingerprints, in stage order. */
  stages: string[];
  /** A NONSTOP course only: one connection per seam (stages − 1 of them), and the placement mode. */
  nonstop?: { connections: NonstopConnection[]; placement: 'intended' | 'lr2' };
}

/** The connection the stitcher reads for a seam the course does not name (`StitchNonstopOptions.connections`). */
const DEFAULT_NONSTOP_CONNECTION: NonstopConnection = 'fade';

/**
 * Builds the canonical document a course fingerprint hashes. What plays alike is written alike:
 *
 * - the constraints are normalized (beatoraja's enum names read as their table-header names, unknown names dropped,
 *   one per group as beatoraja keeps them), deduplicated and sorted;
 * - a NONSTOP course lists exactly one connection per seam: one listed after the last stage joins nothing and is
 *   dropped, and a seam the course does not name is `fade`, as the stitcher reads it;
 * - other kinds carry no `nonstop`, whatever the input says;
 * - the name, trophies and `release` flag are not inputs at all.
 */
export function createCourseFingerprintDocument(input: CourseFingerprintInput): CourseFingerprintDocument {
  const constraints = [...new Set(normalizeCourseConstraints(input.constraints))].sort();
  const stages = [...input.stageChartFingerprints];
  const document: CourseFingerprintDocument = { v: COURSE_FINGERPRINT_VERSION, kind: input.kind, constraints, stages };
  if (input.kind === 'nonstop' && input.nonstop !== undefined) {
    const seams = Math.max(0, stages.length - 1);
    const connections = Array.from(
      { length: seams },
      (_seam, index) => input.nonstop!.connections[index] ?? DEFAULT_NONSTOP_CONNECTION,
    );
    document.nonstop = { connections, placement: input.nonstop.placement };
  }
  return document;
}

/**
 * The course fingerprint (`bmcourse0:<sha256>`): the SHA-256 of the course's {@link createCourseFingerprintDocument
 * document} serialized with the JSON Canonicalization Scheme (RFC 8785), as `bmfp` hashes a chart's. The same course read
 * from a `.lr2crs`, a beatoraja course file or a difficulty table gets one fingerprint whenever its charts match, and a
 * random course, once its stages are drawn, is keyed like a fixed one.
 */
export function computeCourseFingerprint(input: CourseFingerprintInput): string {
  return `${COURSE_FINGERPRINT_VERSION}:${sha256Hex(canonicalizeJSONValue(createCourseFingerprintDocument(input)))}`;
}

/**
 * Each stage's chart fingerprint as a course replay records it: a played stage's `chart.chartFingerprint`, an
 * unreached stage's own `chartFingerprint`. `undefined` where the log does not say.
 */
export function resolveCourseStageChartFingerprints(courseLog: BeMusicCourseReplay): Array<string | undefined> {
  return courseLog.stages.map((entry) => (entry.played ? entry.replay.chart.chartFingerprint : entry.chartFingerprint));
}

/**
 * The fingerprint of the course a course replay ran ({@link computeCourseFingerprint}), or `undefined` when a stage's
 * chart fingerprint is missing. Failed runs have one too: their unreached stages carry their chart fingerprint.
 */
export function computeCourseReplayFingerprint(courseLog: BeMusicCourseReplay): string | undefined {
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
