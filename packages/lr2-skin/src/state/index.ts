/**
 * `@be-music/lr2-skin/state`: the scene models of `@be-music/scene-model` in LR2's skin vocabulary — which ops hold,
 * which value a number or a text draws, where a slider sits and which LR2 timers a moment of a scene starts. Pure and
 * deterministic: no renderer, no DOM, no clock; time comes in as an input. See `docs/lr2-skin.md`.
 *
 * - Scene state: {@link Lr2SceneState}, what a skin reads of a scene (ops, numbers, texts, sliders).
 * - Select: {@link resolveLr2SelectState} for the bar under the cursor, the buttons' actions, the bars' bodies, levels
 *   and lamps, and the select timers.
 * - Decide: {@link resolveLr2DecideState} for the chart about to be played (and its course).
 * - Charts and records: a chart's key-mode op and features, a record's clear-lamp op and bar lamp.
 * - Courses: the course ops, numbers and texts of a `CourseView`, the course maker's ops, texts and buttons.
 */
export type { Lr2Clock, Lr2SceneState, Lr2TimerUpdate } from './scene-state.ts';
export {
  LR2_KEYS_FILTER_OPS,
  lr2CourseMatchesKeysFilter,
  resolveLr2ChartFeatures,
  resolveLr2KeyModeOp,
  type Lr2ChartFeatures,
} from './chart.ts';
export { resolveLr2BarLamp, resolveLr2LampOp } from './records.ts';
export { resolveLr2DecideState, type Lr2DecideInput } from './decide.ts';
export {
  pickLr2BarBody,
  resolveLr2BarLevel,
  resolveLr2SelectButton,
  resolveLr2SelectState,
  resolveLr2SelectTimers,
  type Lr2CourseMakerInput,
  type Lr2CycledOption,
  type Lr2SelectButtonAction,
  type Lr2SelectInput,
  type Lr2SelectState,
  type Lr2SelectTimerEvent,
} from './select.ts';
export {
  lr2ShowsCourseCombo,
  resolveLr2CourseConnectionText,
  resolveLr2CourseDraftInfo,
  resolveLr2CourseMakerAction,
  resolveLr2CourseMakerButtonState,
  resolveLr2CourseMakerOps,
  resolveLr2CourseMakerText,
  resolveLr2CourseNumber,
  resolveLr2CourseOps,
  resolveLr2CourseStageDifficultyOps,
  resolveLr2CourseText,
  resolveLr2JudgeCombo,
  resolveLr2NonstopStage,
  type Lr2CourseMakerAction,
} from './course.ts';
