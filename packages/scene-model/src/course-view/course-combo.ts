/**
 * The course-wide combo a course stage shows: carried in from the previous stage and running on with the stage's own
 * combo until the first break, then the stage combo itself (beatoraja `JudgeManager.coursecombo`, LR2
 * `now_combo_course`). The judge engine keeps the same figure for the play log; a screen follows it from the combo
 * readings the engine publishes.
 */
export interface CourseComboState {
  combo: number;
  maxCombo: number;
  /** The stage combo last seen. */
  stageCombo: number;
}

/** The course combo a stage starts from: the carried-in combo and max combo, or nothing for a course's first stage. */
export function createCourseCombo(carryIn?: { combo: number; maxCombo: number }): CourseComboState {
  const combo = carryIn?.combo ?? 0;
  return { combo, maxCombo: Math.max(carryIn?.maxCombo ?? 0, combo), stageCombo: 0 };
}

/**
 * The course combo after a new stage-combo reading: a rise adds to the course combo, a drop means the combo broke and
 * the course combo is the stage combo again. Returns a new state; the one given is not changed.
 */
export function reduceCourseCombo(state: Readonly<CourseComboState>, stageCombo: number): CourseComboState {
  const combo = stageCombo >= state.stageCombo ? state.combo + (stageCombo - state.stageCombo) : stageCombo;
  return { combo, stageCombo, maxCombo: Math.max(state.maxCombo, combo) };
}

/** {@link reduceCourseCombo} in place, for a screen that keeps one state object across frames. */
export function advanceCourseCombo(state: CourseComboState, stageCombo: number): void {
  Object.assign(state, reduceCourseCombo(state, stageCombo));
}
