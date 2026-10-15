import type { CourseKind } from '@be-music/player/course';
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
