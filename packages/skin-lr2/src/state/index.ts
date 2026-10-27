/**
 * `@be-music/skin-lr2/state`: the scene models of `@be-music/player-scene-model` in LR2's skin vocabulary — which ops hold,
 * which value a number or a text draws, where a slider sits and which LR2 timers a moment of a scene starts. Pure and
 * deterministic: no renderer, no DOM, no clock; time comes in as an input. See `docs/lr2-skin.md`.
 *
 * - Scene state: {@link LR2SceneState}, what a skin reads of a scene (ops, numbers, texts, sliders).
 * - Select: {@link resolveLR2SelectState} for the bar under the cursor, the buttons' actions, the bars' bodies, levels
 *   and lamps, and the select timers.
 * - Decide: {@link resolveLR2DecideState} for the chart about to be played (and its course), and the decide timers.
 * - Play: {@link resolveLR2PlayState} for a frame of a play (its setup and the running play state), the timers a
 *   moment of the play starts and stops, and the lane timer banks.
 * - Result: {@link resolveLR2ResultState} for a play's result (and its course), the result timers and how much of a
 *   result graph shows.
 * - Charts and records: a chart's key-mode op and features, a record's clear-lamp op and bar lamp.
 * - Courses: the course ops, numbers and texts of a `CourseView`, the course maker's ops, texts and buttons.
 */
export type { LR2Clock, LR2SceneState, LR2TimerUpdate } from './scene-state.ts';
export { resolveLR2ChartFeatures, resolveLR2KeyModeOp, type LR2ChartFeatures } from './chart.ts';
export { resolveLR2BarLamp, resolveLR2LampOp } from './records.ts';
export {
  LR2_BATTLE_CYCLE,
  LR2_JUDGE_TIMING_AUTO_ADJUST_CYCLE,
  LR2_JUDGE_TIMING_LIMIT_MS,
  stepLR2JudgeTiming,
} from './options.ts';
export {
  resolveLR2DecideState,
  resolveLR2DecideTimers,
  type LR2DecideInput,
  type LR2DecideTimerInput,
} from './decide.ts';
export {
  isLR2AutoLane,
  resolveLR2GaugeRangeOp,
  resolveLR2GaugeTypeOps,
  resolveLR2LaneTimer,
  resolveLR2PlayKeyModeOp,
  resolveLR2PlayKeyModeOps,
  resolveLR2PlayState,
  resolveLR2PlayTimers,
  resolveLR2RankOp,
  type LR2Lane,
  type LR2LaneTimerBank,
  type LR2PlayFrame,
  type LR2PlayLanes,
  type LR2PlaySetup,
  type LR2PlayState,
  type LR2PlayTimerEvent,
  type LR2PlayView,
} from './play.ts';
export {
  resolveLR2GraphReveal,
  resolveLR2ResultState,
  resolveLR2ResultTimers,
  type LR2ResultInput,
  type LR2ResultState,
  type LR2ResultTimerInput,
} from './result.ts';
export {
  pickLR2BarBody,
  resolveLR2BarLevel,
  resolveLR2SelectButton,
  resolveLR2SelectState,
  resolveLR2SelectTimers,
  type LR2CourseMakerInput,
  type LR2CycledOption,
  type LR2SelectButtonAction,
  type LR2SelectInput,
  type LR2SelectState,
  type LR2SelectTimerEvent,
} from './select.ts';
export {
  formatLR2RandomMixSetting,
  lr2ShowsCourseCombo,
  resolveLR2CourseConnectionText,
  resolveLR2CourseDraftInfo,
  resolveLR2CourseMakerAction,
  resolveLR2CourseMakerButtonState,
  resolveLR2CourseMakerOps,
  resolveLR2CourseMakerText,
  resolveLR2CourseNumber,
  resolveLR2CourseOps,
  resolveLR2CourseStageDifficultyOps,
  resolveLR2RandomMixButtonState,
  resolveLR2RandomMixText,
  resolveLR2CourseText,
  resolveLR2JudgeCombo,
  resolveLR2NonstopStage,
  type LR2CourseMakerAction,
} from './course.ts';
