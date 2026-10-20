import { LR2_BUTTON, LR2_NUM, LR2_OP, LR2_TEXT } from '../ids/index.ts';
import type { CourseDraft, CourseKind, NonstopConnection } from '@be-music/player-engine/course';
import type { CourseView } from '@be-music/player-scene-model';

const KIND_OPS: Record<CourseKind, number> = {
  nonstop: LR2_OP.COURSE_NONSTOP,
  expert: LR2_OP.COURSE_EXPERT,
  grade: LR2_OP.COURSE_GRADE,
};

/**
 * The LR2 ops a course lights: 290 and its kind's op, plus the stage op while a stage is played (280 + index for
 * stages 1-9 that are not the last, 289 for the last). LR2 reads a skin at each scene start, so these also serve as
 * parse-time ops for a course stage's skin (`LR2ThemeSkins.loadSkin`).
 */
export function resolveLR2CourseOps(course: CourseView): number[] {
  const ops: number[] = [LR2_OP.COURSE, KIND_OPS[course.kind]];
  const index = course.stageIndex;
  if (index === undefined) return ops;
  if (index >= course.stages.length - 1) ops.push(LR2_OP.COURSE_STAGE_FINAL);
  else if (index <= 8) ops.push(LR2_OP.COURSE_STAGE1 + index);
  return ops;
}

/**
 * LR2 select ops 700-745 (OpenLR2 L5995-L6031): `700 + 10 × i + difficulty` lights for stage i + 1 (of the first five)
 * of the selected bar's course, by the stage chart's `#DIFFICULTY` (0 undefined, 1 BEGINNER … 5 INSANE). LR2 reads
 * 0 for a stage it does not have, a chart it does not own and any bar that is not a course, so those light the `x0` op.
 */
export function resolveLR2CourseStageDifficultyOps(course: CourseView | undefined): number[] {
  return [0, 1, 2, 3, 4].map((index) => {
    const difficulty = Math.trunc(course?.stages[index]?.difficulty ?? 0);
    return LR2_OP.COURSE_STAGE_DIFFICULTY + index * 10 + (difficulty >= 0 && difficulty <= 5 ? difficulty : 0);
  });
}

/** LR2 numbers 250-259: the play level of course stage 1-10 (OpenLR2 L923-L942). */
export function resolveLR2CourseNumber(num: number, course: CourseView): number | undefined {
  if (num < LR2_NUM.COURSE_STAGE1_LEVEL || num > LR2_NUM.COURSE_STAGE10_LEVEL) return undefined;
  return course.stages[num - LR2_NUM.COURSE_STAGE1_LEVEL]?.level;
}

/**
 * LR2 course texts (OpenLR2 L8408-L8420): 150-154 the titles of stages 1-5, 160-164 their subtitles, 170 the course
 * title. A stage the course does not have reads empty.
 */
export function resolveLR2CourseText(st: number, course: CourseView): string | undefined {
  if (st >= LR2_TEXT.COURSE_STAGE1_TITLE && st <= LR2_TEXT.COURSE_STAGE5_TITLE) {
    return course.stages[st - LR2_TEXT.COURSE_STAGE1_TITLE]?.title ?? '';
  }
  if (st >= LR2_TEXT.COURSE_STAGE1_SUBTITLE && st <= LR2_TEXT.COURSE_STAGE5_SUBTITLE) {
    return course.stages[st - LR2_TEXT.COURSE_STAGE1_SUBTITLE]?.subtitle ?? '';
  }
  if (st === LR2_TEXT.COURSE_TITLE) return course.title;
  return undefined;
}

/**
 * Whether LR2's combo numbers (104 NOWCOMBO, 105 MAXCOMBO) count the whole course: they do during an expert or grade
 * course (OpenLR2 L652-L661), while a nonstop course shows each stage's own.
 */
export function lr2ShowsCourseCombo(kind: CourseKind): boolean {
  return kind === 'expert' || kind === 'grade';
}

/**
 * The combo an LR2 skin shows next to the judgement (`#DST_NOWCOMBO`): the course combo during an expert or grade
 * course, as LR2 draws `now_combo_course` there (OpenLR2 L2019-L2034, L2516), else the stage's own combo.
 */
export function resolveLR2JudgeCombo(
  stageCombo: number,
  courseCombo: number | undefined,
  kind: CourseKind | undefined,
): number {
  return kind !== undefined && courseCombo !== undefined && lr2ShowsCourseCombo(kind) ? courseCombo : stageCombo;
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
export function resolveLR2CourseConnectionText(st: number, course: CourseView): string | undefined {
  if (st < LR2_TEXT.COURSE_CONNECTION1 || st > LR2_TEXT.COURSE_CONNECTION9) return undefined;
  if (course.kind !== 'nonstop' || course.connections === undefined) return 'DISABLE';
  return LR2_CONNECTION_LABELS[course.connections[st - LR2_TEXT.COURSE_CONNECTION1] ?? 'fade'];
}

/**
 * The stage a stitched NONSTOP play shows on an LR2 skin at `seconds` (ops 280-289, title text 10). LR2 only announces
 * a stage that follows a BLANK connection (its op 1002 marker, OpenLR2 L12878-L12889), so after a FADE or CUT the
 * previous stage stays shown.
 */
export function resolveLR2NonstopStage(
  stages: ReadonlyArray<{ windowStart: number; lr2StageMarker: boolean }>,
  seconds: number,
): number {
  let shown = 0;
  stages.forEach((stage, index) => {
    if (index > 0 && stage.lr2StageMarker && stage.windowStart <= seconds) shown = index;
  });
  return shown;
}

/**
 * LR2's course-maker ops (OpenLR2 L5779-L5808): 571 while a course is being made, 572 otherwise, and 590 + the number
 * of songs added so far (590-599) while making. When not making, 580 + N (580-589) light while the selected course has
 * more than N stages. (OpenLR2 marks 571 / 572 as falling through to the next case, a decompilation artefact; this
 * follows the evident intent.)
 */
export function resolveLR2CourseMakerOps(draft: CourseDraft | undefined, selectedStageCount = 0): number[] {
  if (draft !== undefined) {
    return [LR2_OP.COURSE_MAKING, LR2_OP.COURSE_SONGS_ADDED + Math.min(draft.stages.length, 9)];
  }
  const ops: number[] = [LR2_OP.COURSE_NOT_MAKING];
  for (let count = 0; count < Math.min(selectedStageCount, 10); count += 1) ops.push(LR2_OP.COURSE_STAGES_OVER + count);
  return ops;
}

/**
 * The course a select skin shows while one is being made: LR2 draws the songs added so far on texts 150-154 / 160-164
 * and the name being typed on text 170 (`namePrompt` while it is empty), in place of the selected bar's course
 * (OpenLR2 L8408-L8414).
 */
export function resolveLR2CourseDraftInfo(draft: CourseDraft, namePrompt = ''): CourseView {
  return {
    kind: draft.kind,
    title: draft.name.length > 0 ? draft.name : namePrompt,
    stages: draft.stages.map((stage) => ({
      title: stage.title ?? '',
      ...(stage.subtitle !== undefined ? { subtitle: stage.subtitle } : {}),
    })),
  };
}

/** LR2 text 198: the connection a new NONSTOP course gets (its `config.course.defaultconnection`). */
export function resolveLR2CourseMakerText(st: number, defaultConnection: NonstopConnection): string | undefined {
  return st === LR2_TEXT.COURSE_DEFAULT_CONNECTION ? LR2_CONNECTION_LABELS[defaultConnection] : undefined;
}

/** What an LR2 select button does to the player's courses (OpenLR2 L11063-L11137). */
export type LR2CourseMakerAction =
  | { kind: 'finish' }
  | { kind: 'cancel' }
  | { kind: 'delete' }
  | { kind: 'connection'; slot: number }
  | { kind: 'default-connection' };

/**
 * The course-maker action of an LR2 select button type: 230 finishes the course being made, 231 cancels it, 233 deletes
 * the selected course, 240-248 step the connection after stage 1-9 of the selected NONSTOP course and 268 the default
 * connection. `undefined` for any other button.
 */
export function resolveLR2CourseMakerAction(type: number): LR2CourseMakerAction | undefined {
  if (type === LR2_BUTTON.COURSE_FINISH) return { kind: 'finish' };
  if (type === LR2_BUTTON.COURSE_CANCEL) return { kind: 'cancel' };
  if (type === LR2_BUTTON.COURSE_DELETE) return { kind: 'delete' };
  if (type >= LR2_BUTTON.COURSE_CONNECTION1 && type <= LR2_BUTTON.COURSE_CONNECTION9) {
    return { kind: 'connection', slot: type - LR2_BUTTON.COURSE_CONNECTION1 };
  }
  if (type === LR2_BUTTON.COURSE_DEFAULT_CONNECTION) return { kind: 'default-connection' };
  return undefined;
}

/**
 * The cell an LR2 select button draws for the player's courses: buttons 240-248 show the selected NONSTOP course's
 * connection after stage 1-9 and 268 the default connection, each by its index in LR2's order (`ButtonByInput` draws the
 * value it edits). `undefined` for other buttons.
 */
export function resolveLR2CourseMakerButtonState(
  type: number,
  course: CourseView | undefined,
  defaultConnection: NonstopConnection,
): number | undefined {
  const action = resolveLR2CourseMakerAction(type);
  if (action?.kind === 'default-connection') return LR2_CONNECTION_ORDER.indexOf(defaultConnection);
  if (action?.kind !== 'connection') return undefined;
  if (course?.kind !== 'nonstop') return 0;
  return Math.max(0, LR2_CONNECTION_ORDER.indexOf(course.connections?.[action.slot] ?? 'fade'));
}

const LR2_CONNECTION_ORDER = Object.keys(LR2_CONNECTION_LABELS) as NonstopConnection[];
