/**
 * `@be-music/lr2-skin/state`: the scene models of `@be-music/scene-model` in LR2's skin vocabulary — which ops hold,
 * which value a number or a text draws, where a slider sits and which LR2 timers a moment of a scene starts. Pure and
 * deterministic: no renderer, no DOM, no clock; time comes in as an input. See `docs/lr2-skin.md`.
 *
 * - Scene state: {@link Lr2SceneState}, what a skin reads of a scene (ops, numbers, texts, sliders).
 * - Select: {@link resolveLr2SelectState} for the bar under the cursor, the buttons' actions, the bars' bodies, levels
 *   and lamps, and the select timers.
 * - Decide: {@link resolveLr2DecideState} for the chart about to be played (and its course), and the decide timers.
 * - Play: {@link resolveLr2PlayState} for a frame of a play (its setup and the running play state), the timers a
 *   moment of the play starts and stops, and the lane timer banks.
 * - Result: {@link resolveLr2ResultState} for a play's result (and its course), the result timers and how much of a
 *   result graph shows.
 * - Charts and records: a chart's key-mode op and features, a record's clear-lamp op and bar lamp.
 * - Courses: the course ops, numbers and texts of a `CourseView`, the course maker's ops, texts and buttons.
 */
export type { Lr2Clock, Lr2SceneState, Lr2TimerUpdate } from './scene-state.ts';
export { resolveLr2ChartFeatures, resolveLr2KeyModeOp, type Lr2ChartFeatures } from './chart.ts';
export { resolveLr2BarLamp, resolveLr2LampOp } from './records.ts';
export {
  resolveLr2DecideState,
  resolveLr2DecideTimers,
  type Lr2DecideInput,
  type Lr2DecideTimerInput,
} from './decide.ts';
export {
  isLr2AutoLane,
  resolveLr2GaugeRangeOp,
  resolveLr2GaugeTypeOps,
  resolveLr2LaneTimer,
  resolveLr2PlayKeyModeOp,
  resolveLr2PlayState,
  resolveLr2PlayTimers,
  resolveLr2RankOp,
  type Lr2Lane,
  type Lr2LaneTimerBank,
  type Lr2PlayFrame,
  type Lr2PlayLanes,
  type Lr2PlaySetup,
  type Lr2PlayState,
  type Lr2PlayTimerEvent,
  type Lr2PlayView,
} from './play.ts';
export {
  resolveLr2GraphReveal,
  resolveLr2ResultState,
  resolveLr2ResultTimers,
  type Lr2ResultInput,
  type Lr2ResultState,
  type Lr2ResultTimerInput,
} from './result.ts';
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
