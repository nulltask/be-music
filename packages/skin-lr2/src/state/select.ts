import type { CourseDraft, NonstopConnection } from '@be-music/player-engine/course';
import type { ClearLamp } from '@be-music/player-engine/ruleset';
import {
  resolveCourseView,
  type CourseView,
  type DifficultyFilter,
  type LibraryChart,
  type LibraryEntry,
  type PlayOptions,
  type PlaySide,
} from '@be-music/player-scene-model';
import { LR2_BUTTON, LR2_NUM, LR2_OP, LR2_SLIDER, LR2_TEXT, LR2_TIMER } from '../ids/index.ts';
import type { LR2BarBodyKind, LR2BarBodySource, LR2BarLevelKind } from '../skin.ts';
import {
  lr2PlayLevel,
  resolveLR2ChartFeatures,
  resolveLR2ChartText,
  resolveLR2DifficultyOp,
  resolveLR2JudgeRankOp,
  resolveLR2KeyModeOp,
} from './chart.ts';
import {
  resolveLR2CourseConnectionText,
  resolveLR2CourseDraftInfo,
  resolveLR2CourseMakerButtonState,
  resolveLR2CourseMakerOps,
  resolveLR2CourseMakerText,
  resolveLR2CourseNumber,
  resolveLR2CourseOps,
  resolveLR2CourseStageDifficultyOps,
  resolveLR2CourseText,
} from './course.ts';
import {
  LR2_DIFFICULTY_FILTER_BUTTONS,
  resolveLR2OptionButton,
  resolveLR2OptionNumber,
  resolveLR2OptionSlider,
  resolveLR2OptionText,
  resolveLR2PlayOptionOps,
} from './options.ts';
import { resolveLR2LampOp } from './records.ts';
import { lr2TimerUpdate, type LR2Clock, type LR2SceneState, type LR2TimerUpdate } from './scene-state.ts';

/** The course being made on the select screen, when the player makes courses (LR2's course maker). */
export interface LR2CourseMakerInput {
  /** The course being made; absent while none is. */
  readonly draft?: CourseDraft;
  /** The connection a new NONSTOP course gets (text 198, button 268). */
  readonly defaultConnection: NonstopConnection;
  /** What the course name (text 170) reads while the name being made is empty. */
  readonly namePrompt?: string;
}

/** What the LR2 select screen shows: the bar under the cursor, the player's options and records, the screen's state. */
export interface LR2SelectInput {
  /** The bar under the cursor (a session reads it with `focusedEntry(library, browse)`); none on an empty list. */
  readonly focused?: LibraryEntry;
  /** The player's play options: the option ops, the option panel's labels, buttons and sliders. */
  readonly options: PlayOptions;
  /** The player's best record on the focused chart or course: its clear lamp (ops 100-105). */
  readonly record?: { readonly lamp?: ClearLamp };
  /** The option panels open (1-9): ops 21-29, or op 20 while none is. */
  readonly openPanels?: Iterable<number>;
  /** The skin's `#CUSTOMOPTION` choices: their ops (900-999). */
  readonly customOps?: Iterable<number>;
  /** Whether the focused chart's folder has a text (readme) file (ops 174 / 175). */
  readonly readme?: boolean;
  /** The focused chart's lowest and highest BPM over its tempo map (numbers 90 / 91). */
  readonly bpmRange?: { readonly min: number; readonly max: number };
  /** The search word shown (text 30). */
  readonly searchText?: string;
  /** The cursor's place in the list as it is drawn, 0..1 (slider 1): a sliding list lags the cursor. */
  readonly listPosition?: number;
  /** The course maker, when the player makes courses. */
  readonly courseMaker?: LR2CourseMakerInput;
  /** The time now (numbers 21-26). */
  readonly clock?: LR2Clock;
  /** The frame rate (number 20). */
  readonly fps?: number;
}

/** The LR2 select screen's state: a {@link LR2SceneState} and the cell each button draws. */
export interface LR2SelectState extends LR2SceneState {
  /** The cell a `#SRC_BUTTON` of this `type` draws (`LR2_BUTTON`); the caller clamps it to the button's cells. */
  button(type: number): number | undefined;
}

/** Ops the select screen always lights: no AUTOPLAY, GHOST, internet ranking, EXTRA MODE, score saving or replay. */
const SELECT_BASE_OPS: readonly number[] = [
  LR2_OP.AUTOPLAY_OFF,
  LR2_OP.GHOST_OFF,
  LR2_OP.OFFLINE,
  LR2_OP.EXTRA_MODE_OFF,
  LR2_OP.SCORE_SAVE_OFF,
  LR2_OP.CLEAR_SAVE_OFF,
  LR2_OP.LOADED,
  LR2_OP.REPLAY_OFF,
];

/** The chart ops of a bar that is not a chart: nothing the chart ops report, an undefined 7-key chart, no lamp. */
const NO_CHART_OPS: readonly number[] = [
  LR2_OP.NO_BGA,
  LR2_OP.NO_LN,
  LR2_OP.NO_TEXT,
  LR2_OP.NO_BPM_CHANGE,
  LR2_OP.NO_RANDOM,
  LR2_OP.NO_STAGEFILE,
  LR2_OP.NO_BANNER,
  LR2_OP.NO_BACKBMP,
  LR2_OP.NO_REPLAY,
  LR2_OP.JUDGE_NORMAL,
  LR2_OP.LAMP_NO_PLAY,
  LR2_OP.DIFFICULTY_UNDEFINED,
  LR2_OP.KEYS_7,
];

/** The chart ops of a focused chart: the bar, its key mode, features, judge rank, difficulty, images and lamp. */
function chartOps(chart: LibraryChart, readme: boolean, lamp: ClearLamp | undefined): number[] {
  const features = resolveLR2ChartFeatures(chart.chart);
  const metadata = chart.chart.metadata;
  return [
    LR2_OP.SONG_BAR,
    LR2_OP.PLAYABLE_BAR,
    resolveLR2KeyModeOp(chart),
    features.bga ? LR2_OP.HAS_BGA : LR2_OP.NO_BGA,
    features.longNote ? LR2_OP.HAS_LN : LR2_OP.NO_LN,
    readme ? LR2_OP.HAS_TEXT : LR2_OP.NO_TEXT,
    features.bpmChange ? LR2_OP.HAS_BPM_CHANGE : LR2_OP.NO_BPM_CHANGE,
    features.random ? LR2_OP.HAS_RANDOM : LR2_OP.NO_RANDOM,
    resolveLR2JudgeRankOp(metadata.rank),
    resolveLR2DifficultyOp(metadata.difficulty),
    metadata.stageFile ? LR2_OP.HAS_STAGEFILE : LR2_OP.NO_STAGEFILE,
    metadata.banner ? LR2_OP.HAS_BANNER : LR2_OP.NO_BANNER,
    metadata.backBMP ? LR2_OP.HAS_BACKBMP : LR2_OP.NO_BACKBMP,
    LR2_OP.NO_REPLAY,
    resolveLR2LampOp(lamp),
  ];
}

function selectOps(input: LR2SelectInput, chart: LibraryChart | undefined, course: CourseView | undefined): number[] {
  const ops = [...SELECT_BASE_OPS];
  // Op 20 while no option panel is open, 21-29 while panel 1-9 is.
  let panelOpen = false;
  for (const panel of input.openPanels ?? []) {
    if (panel < 1 || panel > 9) continue;
    ops.push(LR2_OP.PANEL1 + panel - 1);
    panelOpen = true;
  }
  if (!panelOpen) ops.push(LR2_OP.NO_PANEL);
  for (const op of input.customOps ?? []) ops.push(op);
  ops.push(...resolveLR2PlayOptionOps(input.options));
  ops.push(...(chart !== undefined ? chartOps(chart, input.readme === true, input.record?.lamp) : NO_CHART_OPS));
  // A folder bar lights op 1 (OpenLR2 `GetOptionFlag_dst`: LR2's folder, level-folder and custom-folder bars).
  if (input.focused?.kind === 'folder') ops.push(LR2_OP.FOLDER_BAR);
  // Ops 700-745: the difficulty of the selected course's stages 1-5 (the `x0` ops on any other bar, as LR2 reads 0).
  ops.push(...resolveLR2CourseStageDifficultyOps(course));
  if (input.courseMaker !== undefined) {
    ops.push(...resolveLR2CourseMakerOps(input.courseMaker.draft, course?.stages.length));
  }
  if (course !== undefined && input.focused?.kind === 'course') {
    ops.push(LR2_OP.COURSE_BAR);
    if (input.focused.course.playable) ops.push(LR2_OP.PLAYABLE_BAR);
    // The course's best lamp (ops 100-105), from the player's record on it as LR2 keeps one per course.
    const noPlay = ops.indexOf(LR2_OP.LAMP_NO_PLAY);
    if (noPlay >= 0) ops.splice(noPlay, 1);
    ops.push(resolveLR2LampOp(input.record?.lamp), ...resolveLR2CourseOps(course));
  }
  return ops;
}

/** LR2 texts 171-179 on a bar that is not a course: the connection slots read `DISABLE` (OpenLR2 L8400-L8405). */
function noCourseConnectionText(st: number): string | undefined {
  return st >= LR2_TEXT.COURSE_CONNECTION1 && st <= LR2_TEXT.COURSE_CONNECTION9 ? 'DISABLE' : undefined;
}

function selectText(
  st: number,
  input: LR2SelectInput,
  chart: LibraryChart | undefined,
  course: CourseView | undefined,
): string | undefined {
  switch (st) {
    case LR2_TEXT.SEARCH_WORD:
      return input.searchText ?? '';
    case LR2_TEXT.RIVAL:
      // No rival or internet ranking: LR2's "no target".
      return 'NO TARGET';
    case LR2_TEXT.PLAYER:
      return 'PLAYER';
    case LR2_TEXT.SKIN_NAME:
      return 'LR2 SELECT';
    case LR2_TEXT.SKIN_AUTHOR:
      return '';
  }
  const maker = input.courseMaker;
  // While a course is being made, its songs and name take the course texts (150-170) over from the selected bar.
  const textCourse =
    maker?.draft !== undefined ? resolveLR2CourseDraftInfo(maker.draft, maker.namePrompt ?? '') : course;
  return (
    (textCourse !== undefined ? resolveLR2CourseText(st, textCourse) : undefined) ??
    (course !== undefined ? resolveLR2CourseConnectionText(st, course) : noCourseConnectionText(st)) ??
    (maker !== undefined ? resolveLR2CourseMakerText(st, maker.defaultConnection) : undefined) ??
    resolveLR2OptionText(st, input.options, chart !== undefined ? resolveLR2KeyModeOp(chart) : undefined) ??
    (chart !== undefined ? resolveLR2ChartText(st, chart) : undefined)
  );
}

function clockNumber(num: number, clock: LR2Clock | undefined): number | undefined {
  switch (num) {
    case LR2_NUM.YEAR:
      return clock?.year;
    case LR2_NUM.MONTH:
      return clock?.month;
    case LR2_NUM.DAY:
      return clock?.day;
    case LR2_NUM.HOUR:
      return clock?.hour;
    case LR2_NUM.MINUTE:
      return clock?.minute;
    case LR2_NUM.SECOND:
      return clock?.second;
    default:
      return undefined;
  }
}

/** The player's totals (30-41): no play history is kept yet, so each reads 0. */
function isPlayerTotal(num: number): boolean {
  return num >= LR2_NUM.TOTAL_PLAY_COUNT && num <= LR2_NUM.TRIAL_LEVEL_PREVIOUS;
}

/** The best record's numbers (70-89) that need a score history, which is not kept yet: each reads 0. */
const BEST_RECORD_NUMBERS: ReadonlySet<number> = new Set([
  LR2_NUM.BEST_SCORE,
  LR2_NUM.BEST_EXSCORE,
  LR2_NUM.BEST_RATE,
  LR2_NUM.BEST_MAX_COMBO,
  LR2_NUM.BEST_MIN_BP,
  LR2_NUM.PLAY_COUNT,
  LR2_NUM.CLEAR_COUNT,
  LR2_NUM.FAIL_COUNT,
  LR2_NUM.BEST_PERFECT,
  LR2_NUM.BEST_GREAT,
  LR2_NUM.BEST_GOOD,
  LR2_NUM.BEST_BAD,
  LR2_NUM.BEST_POOR,
  LR2_NUM.BEST_PERFECT_RATE,
  LR2_NUM.BEST_GREAT_RATE,
  LR2_NUM.BEST_GOOD_RATE,
  LR2_NUM.BEST_BAD_RATE,
  LR2_NUM.BEST_POOR_RATE,
]);

function chartNumber(num: number, chart: LibraryChart, input: LR2SelectInput): number | undefined {
  if (BEST_RECORD_NUMBERS.has(num)) return 0;
  switch (num) {
    case LR2_NUM.EXSCORE_MAX:
      return chart.totalNotes * 2;
    case LR2_NUM.TOTAL_NOTES:
      return chart.totalNotes;
    case LR2_NUM.MAX_BPM:
      return input.bpmRange !== undefined ? Math.round(input.bpmRange.max) : undefined;
    case LR2_NUM.MIN_BPM:
      return input.bpmRange !== undefined ? Math.round(input.bpmRange.min) : undefined;
    case LR2_NUM.FOLDER_LEVEL_BEGINNER:
    case LR2_NUM.FOLDER_LEVEL_NORMAL:
    case LR2_NUM.FOLDER_LEVEL_HYPER:
    case LR2_NUM.FOLDER_LEVEL_ANOTHER:
    case LR2_NUM.FOLDER_LEVEL_INSANE:
      // No folder of a chart's difficulties yet: the chart's own level under its difficulty's number.
      return chart.chart.metadata.difficulty === num - LR2_NUM.FOLDER_LEVEL_BEGINNER + 1
        ? lr2PlayLevel(chart)
        : undefined;
    case LR2_NUM.BPM:
      // The chart is not playing: its start BPM.
      return chart.bpm;
    default:
      // The internet ranking (92-94) and the rest: not bound.
      return undefined;
  }
}

function selectNumber(
  num: number,
  input: LR2SelectInput,
  chart: LibraryChart | undefined,
  course: CourseView | undefined,
): number | undefined {
  const courseNumber = course !== undefined ? resolveLR2CourseNumber(num, course) : undefined;
  if (courseNumber !== undefined) return courseNumber;
  if (num === LR2_NUM.FPS) return input.fps;
  if (num >= LR2_NUM.YEAR && num <= LR2_NUM.SECOND) return clockNumber(num, input.clock);
  if (isPlayerTotal(num)) return 0;
  const optionNumber = resolveLR2OptionNumber(num, input.options);
  if (optionNumber !== undefined) return optionNumber;
  return chart !== undefined ? chartNumber(num, chart, input) : undefined;
}

/**
 * The LR2 select screen's state for the bar under the cursor: the select ops (the base ops, the option ops, the
 * focused chart's ops, a course bar's course ops and stage difficulties, the course maker's ops, the open panels and
 * the skin's custom options), the numbers (the clock, the options, the focused chart and course), the texts (the
 * focused chart, the option panel, the course and the course being made, the search word) and the button cells and
 * sliders.
 */
export function resolveLR2SelectState(input: LR2SelectInput): LR2SelectState {
  const focused = input.focused;
  const chart = focused?.kind === 'chart' ? focused.chart : undefined;
  const course = focused?.kind === 'course' ? resolveCourseView(focused.course) : undefined;
  const maker = input.courseMaker;
  return {
    ops: new Set(selectOps(input, chart, course)),
    number: (num) => selectNumber(num, input, chart, course),
    text: (st) => selectText(st, input, chart, course),
    slider: (type) =>
      type === LR2_SLIDER.SELECT_POSITION ? input.listPosition : resolveLR2OptionSlider(type, input.options),
    button: (type) =>
      (maker !== undefined ? resolveLR2CourseMakerButtonState(type, course, maker.defaultConnection) : undefined) ??
      resolveLR2OptionButton(type, input.options),
  };
}

/** A play option a select button cycles through its choices (`PLAY_OPTION_CHOICES`). */
export type LR2CycledOption = Exclude<keyof PlayOptions, 'hiSpeed' | 'shutter' | 'autoPlay'>;

/** What an LR2 select button asks for (its `#SRC_BUTTON` `type`); the course maker's buttons have their own. */
export type LR2SelectButtonAction =
  /** Open or close option panel 1-9. */
  | { readonly kind: 'panel'; readonly panel: number }
  /** Step a side's hi-speed; the button's `plusOnly` says which way. */
  | { readonly kind: 'hi-speed'; readonly side: PlaySide }
  /** Move a play option to its next choice. */
  | { readonly kind: 'cycle-option'; readonly option: LR2CycledOption }
  /** Set the difficulty filter. */
  | { readonly kind: 'set-difficulty-filter'; readonly value: DifficultyFilter }
  /** Play the selected bar, with AUTOPLAY, or its replay; show the chart's text file; open the key config or skins. */
  | { readonly kind: 'play' | 'autoplay' | 'replay' | 'read-text' | 'key-config' | 'skin-select' };

/** The play option each LR2 option button cycles. */
const CYCLE_BUTTONS: Readonly<Record<number, LR2CycledOption>> = {
  [LR2_BUTTON.DIFFICULTY_FILTER]: 'difficultyFilter',
  [LR2_BUTTON.KEY_MODE_FILTER]: 'keysFilter',
  [LR2_BUTTON.SORT]: 'sort',
  [LR2_BUTTON.GAUGE_1P]: 'gauge1P',
  [LR2_BUTTON.GAUGE_2P]: 'gauge2P',
  [LR2_BUTTON.RANDOM_1P]: 'random1P',
  [LR2_BUTTON.RANDOM_2P]: 'random2P',
  [LR2_BUTTON.AUTO_SCRATCH_1P]: 'autoScratch1P',
  [LR2_BUTTON.AUTO_SCRATCH_2P]: 'autoScratch2P',
  [LR2_BUTTON.LANE_COVER]: 'laneCover',
  [LR2_BUTTON.EFFECT_1P]: 'hiddenSudden1P',
  [LR2_BUTTON.EFFECT_2P]: 'hiddenSudden2P',
  [LR2_BUTTON.FLIP]: 'dpFlip',
  [LR2_BUTTON.BATTLE]: 'battleMode',
  [LR2_BUTTON.HS_FIX]: 'hsFix',
  [LR2_BUTTON.SCORE_GRAPH]: 'scoreGraph',
  [LR2_BUTTON.BGA]: 'bga',
  [LR2_BUTTON.BGA_SIZE]: 'bgaSize',
};

/**
 * What an LR2 select button does (`#SRC_BUTTON` `type`): toggle a panel (1-9), step a hi-speed (57 / 58), cycle a play
 * option (10-12, 40-46, 50, 51, 54, 55, 70, 72, 73), set the difficulty filter (91-96), or play, play with AUTOPLAY,
 * show the text file, replay, or open the key config or skin select (15, 16, 17, 19, 13, 14). `undefined` for any other
 * button, the course maker's included (`resolveLR2CourseMakerAction`).
 */
export function resolveLR2SelectButton(type: number): LR2SelectButtonAction | undefined {
  if (type >= LR2_BUTTON.PANEL1 && type <= LR2_BUTTON.PANEL9) return { kind: 'panel', panel: type };
  if (type === LR2_BUTTON.HISPEED_1P) return { kind: 'hi-speed', side: '1P' };
  if (type === LR2_BUTTON.HISPEED_2P) return { kind: 'hi-speed', side: '2P' };
  const option = CYCLE_BUTTONS[type];
  if (option !== undefined) return { kind: 'cycle-option', option };
  const difficulty = LR2_DIFFICULTY_FILTER_BUTTONS[type];
  if (difficulty !== undefined) return { kind: 'set-difficulty-filter', value: difficulty };
  switch (type) {
    case LR2_BUTTON.PLAY:
      return { kind: 'play' };
    case LR2_BUTTON.AUTOPLAY:
      return { kind: 'autoplay' };
    case LR2_BUTTON.REPLAY:
      return { kind: 'replay' };
    case LR2_BUTTON.READ_TEXT:
      return { kind: 'read-text' };
    case LR2_BUTTON.KEY_CONFIG:
      return { kind: 'key-config' };
    case LR2_BUTTON.SKIN_SELECT:
      return { kind: 'skin-select' };
    default:
      return undefined;
  }
}

/** The `#SRC_BAR_BODY` kind LR2 draws for a bar. */
function barBodyKind(entry: LibraryEntry | undefined): LR2BarBodyKind {
  if (entry?.kind === 'folder') return entry.folder.courses !== undefined ? 'courseFolder' : 'folder';
  if (entry?.kind !== 'course') return 'song';
  // LR2's NEW COURSE bar (body 7, "make a course") and beatoraja's random course (body 9).
  if (entry.course.newCourse === true) return 'courseCreate';
  if (entry.course.random !== undefined) return 'randomCourse';
  return 'course';
}

/**
 * The bar body a bar of the list draws (`#SRC_BAR_BODY`): a chart takes body 0, a folder 1, a folder of courses 6 (else
 * 1), a course 8, a NEW COURSE bar 7 and a random course 9 (each else 8). Anything the skin lacks falls back to the
 * chart body, then the first body. A slot with no bar (past either end of the list) still gets a body, as LR2's rail
 * draws past the end of the list.
 */
export function pickLR2BarBody(
  bodies: readonly LR2BarBodySource[],
  entry: LibraryEntry | undefined,
): LR2BarBodySource | undefined {
  if (bodies.length === 0) return undefined;
  const kind = barBodyKind(entry);
  const fallback: LR2BarBodyKind | undefined =
    kind === 'courseFolder' ? 'folder' : kind === 'courseCreate' || kind === 'randomCourse' ? 'course' : undefined;
  return (
    bodies.find((body) => body.kind === kind) ??
    (fallback !== undefined ? bodies.find((body) => body.kind === fallback) : undefined) ??
    bodies.find((body) => body.kind === 'song') ??
    bodies[0]
  );
}

const BAR_LEVEL_KINDS: readonly LR2BarLevelKind[] = ['undefined', 'beginner', 'normal', 'hyper', 'another', 'insane'];

/**
 * The level a chart bar draws (`#SRC_BAR_LEVEL`): the chart's play level, in the level kind of its `#DIFFICULTY`
 * (`undefined` for none; LR2's internet-ranking kind is never a chart's). None for a chart without a numeric level.
 */
export function resolveLR2BarLevel(chart: LibraryChart): { kind: LR2BarLevelKind; level: number } | undefined {
  const level = lr2PlayLevel(chart);
  if (level === undefined) return undefined;
  const difficulty = chart.chart.metadata.difficulty;
  const kind = difficulty !== undefined ? (BAR_LEVEL_KINDS[difficulty] ?? 'undefined') : 'undefined';
  return { kind, level };
}

/** A moment of the select screen that starts LR2 timers. */
export type LR2SelectTimerEvent =
  /** The screen appears: timer 0, and the bar-change timer (11) so the bars slide in. */
  | { readonly kind: 'scene-start'; readonly at: number }
  /** The cursor moves by `delta` bars: timers 10 and 11, and 12 (up) or 13 (down). */
  | { readonly kind: 'cursor'; readonly delta: number; readonly at: number }
  /** Option panel 1-9 opens or closes: its open timer (21-29) runs while it is open, its close timer (31-39) from then. */
  | { readonly kind: 'panel'; readonly panel: number; readonly open: boolean; readonly at: number }
  /** Making a course starts (timer 17) or ends (timer 18). */
  | { readonly kind: 'course-making'; readonly making: boolean; readonly at: number };

/** The LR2 timers a moment of the select screen starts and stops. */
export function resolveLR2SelectTimers(event: LR2SelectTimerEvent): LR2TimerUpdate {
  switch (event.kind) {
    case 'scene-start':
      return lr2TimerUpdate([LR2_TIMER.SCENE_START, LR2_TIMER.SONG_BAR_CHANGE], event.at);
    case 'cursor':
      return lr2TimerUpdate(
        [
          LR2_TIMER.SONG_BAR_MOVE,
          LR2_TIMER.SONG_BAR_CHANGE,
          event.delta < 0 ? LR2_TIMER.SONG_BAR_UP : LR2_TIMER.SONG_BAR_DOWN,
        ],
        event.at,
      );
    case 'panel': {
      if (event.panel < 1 || event.panel > 9) return lr2TimerUpdate([], event.at);
      const open = LR2_TIMER.PANEL1_OPEN + event.panel - 1;
      const close = LR2_TIMER.PANEL1_CLOSE + event.panel - 1;
      return event.open ? lr2TimerUpdate([open], event.at, [close]) : lr2TimerUpdate([close], event.at, [open]);
    }
    case 'course-making':
      return event.making
        ? lr2TimerUpdate([LR2_TIMER.COURSE_MAKING_START], event.at, [LR2_TIMER.COURSE_MAKING_END])
        : lr2TimerUpdate([LR2_TIMER.COURSE_MAKING_END], event.at, [LR2_TIMER.COURSE_MAKING_START]);
  }
}
