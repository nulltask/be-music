import { BEATORAJA_OP, BEATORAJA_TEXT } from '@be-music/beatoraja-skin';
import type { CourseConstraint } from '@be-music/player/course';
import type { SceneCourseInfo } from '../course-info.ts';

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
 * The ops a running course lights outside the select screen (beatoraja `BooleanPropertyFactory`): `MODE_COURSE` (290),
 * and for the stage being played `OPTION_COURSE_STAGE1-4` (280-283) when it is one of the first four and not the last,
 * or `OPTION_COURSE_STAGE_FINAL` (289) on the last.
 */
export function resolveBeatorajaCourseStageOps(course: SceneCourseInfo): number[] {
  const ops: number[] = [BEATORAJA_OP.MODE_COURSE];
  const index = course.stageIndex;
  if (index === undefined) return ops;
  if (index >= course.stages.length - 1) ops.push(BEATORAJA_OP.COURSE_STAGE_FINAL);
  else if (index <= 3) ops.push(BEATORAJA_OP.COURSE_STAGE1 + index);
  return ops;
}

/**
 * The course stage titles on strings 150-159 (beatoraja `StringPropertyFactory.createCoursetitle`). On the select
 * screen a stage missing from the collection reads `(no song) <title>`, as beatoraja marks a course bar's song it does
 * not have; a stage the course does not have reads empty. Returns `undefined` for other string ids.
 */
export function resolveBeatorajaCourseText(
  refOp: number,
  course: SceneCourseInfo,
  options: { missingStages?: ReadonlySet<number> } = {},
): string | undefined {
  if (refOp < BEATORAJA_TEXT.COURSE1_TITLE || refOp > BEATORAJA_TEXT.COURSE10_TITLE) return undefined;
  const index = refOp - BEATORAJA_TEXT.COURSE1_TITLE;
  const stage = course.stages[index];
  if (stage === undefined) return '';
  return options.missingStages?.has(index) === true ? `(no song) ${stage.title}` : stage.title;
}
