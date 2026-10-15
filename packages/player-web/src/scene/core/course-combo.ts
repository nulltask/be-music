/**
 * The course-wide combo a course stage shows: carried in from the previous stage and running on with the stage's own
 * combo until the first break, then the stage combo itself (beatoraja `JudgeManager.coursecombo`, LR2
 * `now_combo_course`). The judge engine keeps the same figure for the play log; the scene follows it from the combo
 * readings the engine publishes.
 */
export interface CourseComboState {
  combo: number;
  maxCombo: number;
  /** The stage combo last seen. */
  stageCombo: number;
}

export function createCourseCombo(carryIn?: { combo: number; maxCombo: number }): CourseComboState {
  const combo = carryIn?.combo ?? 0;
  return { combo, maxCombo: Math.max(carryIn?.maxCombo ?? 0, combo), stageCombo: 0 };
}

/** Follows a new stage-combo reading: a rise adds to the course combo, a drop means the combo broke. */
export function advanceCourseCombo(state: CourseComboState, stageCombo: number): void {
  state.combo = stageCombo >= state.stageCombo ? state.combo + (stageCombo - state.stageCombo) : stageCombo;
  state.stageCombo = stageCombo;
  state.maxCombo = Math.max(state.maxCombo, state.combo);
}
