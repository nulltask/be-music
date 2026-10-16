/**
 * `@be-music/lr2-skin/state`: the scene models of `@be-music/scene-model` in LR2's skin vocabulary — which ops hold,
 * which value a number or a text draws, where a slider sits and which LR2 timers a moment of a scene starts. Pure and
 * deterministic: no renderer, no DOM, no clock; time comes in as an input. See `docs/lr2-skin.md`.
 *
 * - Courses: the course ops, numbers and texts of a {@link CourseView}, the course maker's ops, texts and buttons.
 */
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
