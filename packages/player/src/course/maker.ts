import { type CourseDefinition, type CourseKind, createCourseStageRef, type NonstopConnection } from './definition.ts';
import { LR2_NONSTOP_CONNECTIONS, parseLr2NonstopConnections } from './lr2crs.ts';

/** LR2's course maker takes at most five songs (OpenLR2 `LR2f.cpp` L12221-L12229: `count <= 4` before adding). */
export const LR2_COURSE_MAKER_MAX_STAGES = 5;

/** The connections LR2's select-screen buttons 240-248 edit: the one after each of stages 1-9. */
const LR2_CONNECTION_SLOTS = 9;

const LR2_COURSE_TYPES: Readonly<Record<CourseKind, number>> = { expert: 0, nonstop: 1, grade: 2 };

/** One song picked into a course being made. */
export interface CourseDraftStage {
  /** The chart's MD5 (lowercase hex): LR2 keys a course's stages by it. */
  md5: string;
  /** The chart's key mode: every stage must match the first one's. */
  keyMode: number;
  title?: string;
  artist?: string;
}

/** A course being made on the select screen (LR2's `isMakingCourse` state). */
export interface CourseDraft {
  kind: CourseKind;
  name: string;
  stages: CourseDraftStage[];
}

/** Why a song cannot join a course being made. */
export type CourseDraftAppendFailure = 'full' | 'key-mode' | 'no-md5';

/** An empty course of `kind`, named `name` (LR2 starts with a "type the course title" prompt, a host concern). */
export function createCourseDraft(kind: CourseKind, name = ''): CourseDraft {
  return { kind, name, stages: [] };
}

/**
 * Adds a song to the end of a course being made, as LR2's decide on a song bar does (OpenLR2 L12221-L12229): at most
 * {@link LR2_COURSE_MAKER_MAX_STAGES} songs, all in the first song's key mode. The same song may appear twice.
 */
export function appendCourseDraftStage(
  draft: CourseDraft,
  stage: CourseDraftStage,
): { ok: true; draft: CourseDraft } | { ok: false; reason: CourseDraftAppendFailure } {
  if (draft.stages.length >= LR2_COURSE_MAKER_MAX_STAGES) return { ok: false, reason: 'full' };
  const md5 = stage.md5.toLowerCase();
  if (!/^[0-9a-f]{32}$/u.test(md5)) return { ok: false, reason: 'no-md5' };
  const first = draft.stages[0];
  if (first !== undefined && first.keyMode !== stage.keyMode) return { ok: false, reason: 'key-mode' };
  return { ok: true, draft: { ...draft, stages: [...draft.stages, { ...stage, md5 }] } };
}

/** Drops the last song of a course being made (LR2's right click, OpenLR2 L12265-L12269). */
export function removeLastCourseDraftStage(draft: CourseDraft): CourseDraft {
  return { ...draft, stages: draft.stages.slice(0, -1) };
}

/**
 * An LR2 course hash: a 32-character header, then each stage's MD5 (OpenLR2 `WriteCourse` L17580-L17621). The header
 * holds the connection after each of stages 1-10 (chars 0-9, `0`-`5`; `0` for a course that is not NONSTOP), the
 * course type (char 10: 0 EXPERT, 1 NONSTOP, 2 GRADE) and zeros. LR2 puts the first four characters of the player's
 * password MD5 at chars 28-31; a browser has no password, so they stay `0`.
 */
export function buildLr2CourseHash(course: {
  kind: CourseKind;
  stageMd5s: readonly string[];
  connections?: readonly NonstopConnection[];
}): string {
  const keys = Array.from({ length: 10 }, (_, index) => {
    const connection = course.kind === 'nonstop' ? course.connections?.[index] : undefined;
    return String(Math.max(0, connection === undefined ? 0 : LR2_NONSTOP_CONNECTIONS.indexOf(connection)));
  }).join('');
  const header = `${keys}${LR2_COURSE_TYPES[course.kind]}${'0'.repeat(21)}`;
  return `${header}${course.stageMd5s.map((md5) => md5.toLowerCase()).join('')}`;
}

/** The course definition of a set of stages, in the shape `parseLr2CourseFile` reads the same course back in. */
function lr2CourseDefinition(
  name: string,
  kind: CourseKind,
  stages: readonly { md5: string; title?: string; artist?: string }[],
  keyMode: number | undefined,
  connectionKeys: readonly NonstopConnection[],
): CourseDefinition {
  const hash = buildLr2CourseHash({ kind, stageMd5s: stages.map((stage) => stage.md5), connections: connectionKeys });
  const header = hash.slice(0, 32);
  const course: CourseDefinition = {
    name,
    kind,
    stages: stages.map((stage) =>
      createCourseStageRef({
        md5: stage.md5,
        ...(stage.title !== undefined ? { title: stage.title } : {}),
        ...(stage.artist !== undefined ? { artist: stage.artist } : {}),
      })!,
    ),
    constraints: kind === 'grade' ? ['grade_mirror', 'gauge_lr2'] : [],
    trophies: [],
    release: true,
    source: { format: 'lr2crs', type: LR2_COURSE_TYPES[kind], header, hash },
  };
  if (keyMode !== undefined) course.keyMode = keyMode;
  if (kind === 'nonstop') course.connections = parseLr2NonstopConnections(header).slice(0, stages.length - 1);
  return course;
}

/**
 * Turns a course being made into a course, as LR2's finish (button 230) saves it: `undefined` for a course with no
 * song. A NONSTOP course gets `defaultConnection` (LR2's `config.course.defaultconnection`, button 268) after each of
 * stages 1-5; the per-stage connections are edited afterwards ({@link withNonstopConnection}).
 */
export function finishCourseDraft(
  draft: CourseDraft,
  options: { defaultConnection?: NonstopConnection } = {},
): CourseDefinition | undefined {
  if (draft.stages.length === 0) return undefined;
  const connection = options.defaultConnection ?? 'fade';
  const keys = Array.from({ length: 10 }, (_, index) => (index < LR2_COURSE_MAKER_MAX_STAGES ? connection : 'fade'));
  return lr2CourseDefinition(draft.name, draft.kind, draft.stages, draft.stages[0]?.keyMode, keys);
}

/**
 * The connection `delta` steps from `connection` in LR2's order (FADE, FADE+FIT, CUT, CUT+FIT, BLANK1, BLANK2),
 * wrapping around: LR2's buttons 240-248 and 268 step +1 on their right half and -1 on their left half.
 */
export function stepLr2NonstopConnection(connection: NonstopConnection, delta: number): NonstopConnection {
  const count = LR2_NONSTOP_CONNECTIONS.length;
  const index = LR2_NONSTOP_CONNECTIONS.indexOf(connection);
  return LR2_NONSTOP_CONNECTIONS[(((index + delta) % count) + count) % count]!;
}

/**
 * A made NONSTOP course with the connection after stage `index + 1` changed (LR2's buttons 240-248, OpenLR2
 * L11119-L11137). LR2 keeps a connection for each of stages 1-9 whatever the course's length, so `index` may pass the
 * last stage. Returns the course unchanged when it is not NONSTOP, is not an LR2 course, or `index` is outside 0-8.
 */
export function withNonstopConnection(
  course: CourseDefinition,
  index: number,
  connection: NonstopConnection,
): CourseDefinition {
  if (course.kind !== 'nonstop' || course.source.format !== 'lr2crs') return course;
  if (!Number.isInteger(index) || index < 0 || index >= LR2_CONNECTION_SLOTS) return course;
  const keys = parseLr2NonstopConnections(course.source.header);
  keys[index] = connection;
  const stages = course.stages.map((stage) => ({
    md5: stage.md5 ?? '',
    ...(stage.title !== undefined ? { title: stage.title } : {}),
    ...(stage.artist !== undefined ? { artist: stage.artist } : {}),
  }));
  const rebuilt = lr2CourseDefinition(course.name, course.kind, stages, course.keyMode, keys);
  return { ...course, connections: rebuilt.connections!, source: rebuilt.source };
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/gu, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * Writes LR2 courses as a `.lr2crs` file: a UTF-8 `<courselist>` that `parseLr2CourseFile` reads back into the same
 * courses. Courses that did not come from an LR2 hash (`source.format !== 'lr2crs'`) are rebuilt from their stage
 * MD5s, and skipped when a stage has none.
 */
export function serializeLr2CourseFile(courses: readonly CourseDefinition[]): string {
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<courselist>'];
  for (const course of courses) {
    let hash: string;
    if (course.source.format === 'lr2crs') {
      hash = course.source.hash;
    } else {
      if (course.stages.some((stage) => stage.md5 === undefined)) continue;
      hash = buildLr2CourseHash({
        kind: course.kind,
        stageMd5s: course.stages.map((stage) => stage.md5!),
        ...(course.connections !== undefined ? { connections: course.connections } : {}),
      });
    }
    lines.push(
      '  <course>',
      `    <title>${escapeXml(course.name)}</title>`,
      `    <line>${course.keyMode ?? 7}</line>`,
      `    <type>${LR2_COURSE_TYPES[course.kind]}</type>`,
      `    <hash>${hash}</hash>`,
      '  </course>',
    );
  }
  lines.push('</courselist>', '');
  return lines.join('\n');
}
