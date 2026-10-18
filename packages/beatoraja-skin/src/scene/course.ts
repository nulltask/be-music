import type { CourseConstraint } from '@be-music/player/course';
import type { CourseView, LibraryCourse } from '@be-music/scene-model';
import { BEATORAJA_OP, BEATORAJA_TEXT } from '../runtime-ids.ts';

const CONSTRAINT_OPS: Partial<Record<CourseConstraint, number>> = {
  grade: BEATORAJA_OP.GRADEBAR_CLASS,
  grade_mirror: BEATORAJA_OP.GRADEBAR_MIRROR,
  grade_random: BEATORAJA_OP.GRADEBAR_RANDOM,
  no_speed: BEATORAJA_OP.GRADEBAR_NOSPEED,
  no_good: BEATORAJA_OP.GRADEBAR_NOGOOD,
  no_great: BEATORAJA_OP.GRADEBAR_NOGREAT,
  gauge_lr2: BEATORAJA_OP.GRADEBAR_GAUGE_LR2,
  gauge_5k: BEATORAJA_OP.GRADEBAR_GAUGE_5KEYS,
  gauge_7k: BEATORAJA_OP.GRADEBAR_GAUGE_7KEYS,
  gauge_9k: BEATORAJA_OP.GRADEBAR_GAUGE_9KEYS,
  gauge_24k: BEATORAJA_OP.GRADEBAR_GAUGE_24KEYS,
  ln: BEATORAJA_OP.GRADEBAR_LN,
  cn: BEATORAJA_OP.GRADEBAR_CN,
  hcn: BEATORAJA_OP.GRADEBAR_HCN,
};

/**
 * The `OPTION_GRADEBAR_*` ops (1002-1017) a focused course bar lights on the select screen, one per constraint it has
 * (beatoraja `BooleanPropertyFactory.createCourseDataConstraintProperty`).
 */
export function resolveBeatorajaCourseConstraintOps(constraints: readonly CourseConstraint[]): number[] {
  return constraints.flatMap((constraint) => {
    const op = CONSTRAINT_OPS[constraint];
    return op !== undefined ? [op] : [];
  });
}

/**
 * The ops a focused course bar lights on the select screen (beatoraja `BooleanPropertyFactory`): `OPTION_GRADEBAR` (3)
 * on a fixed course only (`instanceof GradeBar`), `OPTION_RANDOMCOURSEBAR` (1031) on a random course,
 * `OPTION_PLAYABLEBAR` (5) when the course can start (every stage in the library, or every stage filter readable), one
 * `OPTION_GRADEBAR_*` op per constraint, and the course's best lamp (`lampOp`, one of `CLEAR_LAMP_*`;
 * `CLEAR_LAMP_NOPLAY` without one, and always on a random course, which keeps no record).
 */
export function resolveBeatorajaCourseBarOps(course: LibraryCourse, lampOp?: number): number[] {
  const ops: number[] = [course.random !== undefined ? BEATORAJA_OP.RANDOMCOURSEBAR : BEATORAJA_OP.GRADEBAR];
  if (course.playable) ops.push(BEATORAJA_OP.PLAYABLEBAR);
  ops.push(...resolveBeatorajaCourseConstraintOps(course.definition.constraints));
  ops.push(course.random === undefined ? (lampOp ?? BEATORAJA_OP.CLEAR_LAMP_NOPLAY) : BEATORAJA_OP.CLEAR_LAMP_NOPLAY);
  return ops;
}

/**
 * The ops a running course lights outside the select screen (beatoraja `BooleanPropertyFactory`): `MODE_COURSE` (290),
 * and for the stage being played `OPTION_COURSE_STAGE1-4` (280-283) when it is one of the first four and not the last,
 * or `OPTION_COURSE_STAGE_FINAL` (289) on the last.
 */
export function resolveBeatorajaCourseStageOps(course: CourseView): number[] {
  const ops: number[] = [BEATORAJA_OP.MODE_COURSE];
  const index = course.stageIndex;
  if (index === undefined) return ops;
  if (index >= course.stages.length - 1) ops.push(BEATORAJA_OP.COURSE_STAGE_FINAL);
  else if (index <= 3) ops.push(BEATORAJA_OP.COURSE_STAGE1 + index);
  return ops;
}

/**
 * A scene's static op set with {@link resolveBeatorajaCourseStageOps} added when the play is a course stage (`course`
 * given): a new set then, else the set given.
 */
export function withBeatorajaCourseStageOps(
  ops: ReadonlySet<number>,
  course: CourseView | undefined,
): ReadonlySet<number> {
  return course !== undefined ? new Set([...ops, ...resolveBeatorajaCourseStageOps(course)]) : ops;
}

/**
 * The course stage titles on strings 150-159 (beatoraja `StringPropertyFactory.createCoursetitle`). On the select
 * screen a stage missing from the library reads `(no song) <title>`, as beatoraja marks a course bar's song it does not
 * have; a stage the course does not have reads empty. Returns `undefined` for other string ids.
 */
export function resolveBeatorajaCourseText(
  id: number,
  course: CourseView,
  options: { readonly missingStages?: ReadonlySet<number> } = {},
): string | undefined {
  if (id < BEATORAJA_TEXT.COURSE1_TITLE || id > BEATORAJA_TEXT.COURSE10_TITLE) return undefined;
  const index = id - BEATORAJA_TEXT.COURSE1_TITLE;
  const stage = course.stages[index];
  if (stage === undefined) return '';
  return options.missingStages?.has(index) === true ? `(no song) ${stage.title}` : stage.title;
}

/** The stages of a library course that are not in the library (by index), which its bar marks `(no song)`. */
export function beatorajaMissingCourseStages(course: LibraryCourse): ReadonlySet<number> {
  return new Set(course.stages.flatMap((stage, index) => (stage.chart === undefined ? [index] : [])));
}
