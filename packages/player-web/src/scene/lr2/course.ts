import type { CourseKind, NonstopConnection } from '@be-music/player/course';
import type { SceneCourseInfo } from '../course-info.ts';

/**
 * LR2's course ops (OpenLR2 `LR2f.cpp` L5403-L5444): 280-288 light while stage 1-9 is played and is not the last one,
 * 289 on the last stage, 290 for a course (the selected bar on the select screen, the running course in play), and
 * 291 / 292 / 293 name its kind.
 */
export const LR2_COURSE_OPS = {
  FIRST_STAGE: 280,
  FINAL_STAGE: 289,
  COURSE: 290,
  NONSTOP: 291,
  EXPERT: 292,
  GRADE: 293,
} as const;

const KIND_OPS: Record<CourseKind, number> = {
  nonstop: LR2_COURSE_OPS.NONSTOP,
  expert: LR2_COURSE_OPS.EXPERT,
  grade: LR2_COURSE_OPS.GRADE,
};

/**
 * The LR2 ops a course lights: 290 and its kind's op, plus the stage op while a stage is played (280 + index for
 * stages 1-9 that are not the last, 289 for the last). LR2 reads a skin at each scene start, so these also serve as
 * parse-time ops for a course stage's skin (`Lr2ThemeSkins.loadSkin`).
 */
export function resolveLr2CourseOps(course: SceneCourseInfo): number[] {
  const ops: number[] = [LR2_COURSE_OPS.COURSE, KIND_OPS[course.kind]];
  const index = course.stageIndex;
  if (index === undefined) return ops;
  if (index >= course.stages.length - 1) ops.push(LR2_COURSE_OPS.FINAL_STAGE);
  else if (index <= 8) ops.push(LR2_COURSE_OPS.FIRST_STAGE + index);
  return ops;
}

/** LR2 numbers 250-259: the play level of course stage 1-10 (OpenLR2 L923-L942). */
export function resolveLr2CourseNumber(num: number, course: SceneCourseInfo): number | undefined {
  if (num < 250 || num > 259) return undefined;
  return course.stages[num - 250]?.level;
}

/**
 * LR2 course texts (OpenLR2 L8408-L8420): 150-154 the titles of stages 1-5, 160-164 their subtitles, 170 the course
 * title. A stage the course does not have reads empty.
 */
export function resolveLr2CourseText(st: number, course: SceneCourseInfo): string | undefined {
  if (st >= 150 && st <= 154) return course.stages[st - 150]?.title ?? '';
  if (st >= 160 && st <= 164) return course.stages[st - 160]?.subtitle ?? '';
  if (st === 170) return course.title;
  return undefined;
}

/**
 * Whether LR2's combo numbers (104 NOWCOMBO, 105 MAXCOMBO) count the whole course: they do during an expert or grade
 * course (OpenLR2 L652-L661), while a nonstop course shows each stage's own.
 */
export function lr2ShowsCourseCombo(kind: CourseKind): boolean {
  return kind === 'expert' || kind === 'grade';
}

/** LR2's names of the NONSTOP connections (its `option_str[20]`), as the select screen shows them. */
const LR2_CONNECTION_LABELS: Readonly<Record<NonstopConnection, string>> = {
  fade: 'FADE',
  'fade-fit': 'FADE+FIT',
  cut: 'CUT',
  'cut-fit': 'CUT+FIT',
  blank1: 'BLANK1',
  blank2: 'BLANK2',
};

/**
 * LR2 texts 171-179 (OpenLR2 L8400-L8405): the connection after stages 1-9 of the selected NONSTOP course, or
 * `DISABLE` for any other course. Returns `undefined` for other text ids.
 */
export function resolveLr2CourseConnectionText(st: number, course: SceneCourseInfo): string | undefined {
  if (st < 171 || st > 179) return undefined;
  if (course.kind !== 'nonstop' || course.connections === undefined) return 'DISABLE';
  return LR2_CONNECTION_LABELS[course.connections[st - 171] ?? 'fade'];
}

/**
 * The stage a stitched NONSTOP play shows on an LR2 skin at `seconds` (ops 280-289, title text 10). LR2 only announces
 * a stage that follows a BLANK connection (its op 1002 marker, OpenLR2 L12878-L12889), so after a FADE or CUT the
 * previous stage stays shown.
 */
export function resolveLr2NonstopStage(
  stages: ReadonlyArray<{ windowStart: number; lr2StageMarker: boolean }>,
  seconds: number,
): number {
  let shown = 0;
  stages.forEach((stage, index) => {
    if (index > 0 && stage.lr2StageMarker && stage.windowStart <= seconds) shown = index;
  });
  return shown;
}
