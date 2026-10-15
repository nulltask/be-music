import type { CourseDraft, CourseKind, NonstopConnection } from '@be-music/player/course';
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

/**
 * The combo an LR2 skin shows next to the judgement (`#DST_NOWCOMBO`): the course combo during an expert or grade
 * course, as LR2 draws `now_combo_course` there (OpenLR2 L2019-L2034, L2516), else the stage's own combo.
 */
export function resolveLr2JudgeCombo(
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

/**
 * LR2's course-maker ops (OpenLR2 L5779-L5808): 571 while a course is being made, 572 otherwise, and 590 + the number
 * of songs added so far (590-599) while making. When not making, 580 + N (580-589) light while the selected course has
 * more than N stages. (OpenLR2 marks 571 / 572 as falling through to the next case, a decompilation artefact; this
 * follows the evident intent.)
 */
export const LR2_COURSE_MAKER_OPS = { STAGES_OVER: 580, MAKING: 571, NOT_MAKING: 572, SONGS_ADDED: 590 } as const;

export function resolveLr2CourseMakerOps(draft: CourseDraft | undefined, selectedStageCount = 0): number[] {
  if (draft !== undefined) {
    return [LR2_COURSE_MAKER_OPS.MAKING, LR2_COURSE_MAKER_OPS.SONGS_ADDED + Math.min(draft.stages.length, 9)];
  }
  const ops: number[] = [LR2_COURSE_MAKER_OPS.NOT_MAKING];
  for (let count = 0; count < Math.min(selectedStageCount, 10); count += 1)
    ops.push(LR2_COURSE_MAKER_OPS.STAGES_OVER + count);
  return ops;
}

/**
 * The course a select skin shows while one is being made: LR2 draws the songs added so far on texts 150-154 / 160-164
 * and the name being typed on text 170 (`namePrompt` while it is empty), in place of the selected bar's course
 * (OpenLR2 L8408-L8414).
 */
export function resolveLr2CourseDraftInfo(draft: CourseDraft, namePrompt = ''): SceneCourseInfo {
  return {
    kind: draft.kind,
    title: draft.name.length > 0 ? draft.name : namePrompt,
    stages: draft.stages.map((stage) => ({ title: stage.title ?? '' })),
  };
}

/** LR2 text 198: the connection a new NONSTOP course gets (its `config.course.defaultconnection`). */
export function resolveLr2CourseMakerText(st: number, defaultConnection: NonstopConnection): string | undefined {
  return st === 198 ? LR2_CONNECTION_LABELS[defaultConnection] : undefined;
}

/** What an LR2 select button does to the player's courses (OpenLR2 L11063-L11137). */
export type Lr2CourseMakerAction =
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
export function resolveLr2CourseMakerAction(type: number): Lr2CourseMakerAction | undefined {
  if (type === 230) return { kind: 'finish' };
  if (type === 231) return { kind: 'cancel' };
  if (type === 233) return { kind: 'delete' };
  if (type >= 240 && type <= 248) return { kind: 'connection', slot: type - 240 };
  if (type === 268) return { kind: 'default-connection' };
  return undefined;
}

/**
 * The cell an LR2 select button draws for the player's courses: buttons 240-248 show the selected NONSTOP course's
 * connection after stage 1-9 and 268 the default connection, each by its index in LR2's order (`ButtonByInput` draws the
 * value it edits). `undefined` for other buttons.
 */
export function resolveLr2CourseMakerButtonState(
  type: number,
  course: SceneCourseInfo | undefined,
  defaultConnection: NonstopConnection,
): number | undefined {
  const action = resolveLr2CourseMakerAction(type);
  if (action?.kind === 'default-connection') return LR2_CONNECTION_ORDER.indexOf(defaultConnection);
  if (action?.kind !== 'connection') return undefined;
  if (course?.kind !== 'nonstop') return 0;
  return Math.max(0, LR2_CONNECTION_ORDER.indexOf(course.connections?.[action.slot] ?? 'fade'));
}

const LR2_CONNECTION_ORDER = Object.keys(LR2_CONNECTION_LABELS) as NonstopConnection[];
