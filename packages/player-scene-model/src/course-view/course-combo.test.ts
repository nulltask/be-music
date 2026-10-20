import { describe, expect, it } from 'vite-plus/test';
import { createCourseCombo, reduceCourseCombo, type CourseComboState } from './course-combo.ts';

/** The course combo after each stage-combo reading in turn. */
function readings(state: CourseComboState, stageCombos: readonly number[]): CourseComboState {
  return stageCombos.reduce(reduceCourseCombo, state);
}

describe('course combo', () => {
  it('runs on from the carried-in combo until the first break', () => {
    const state = readings(createCourseCombo({ combo: 40, maxCombo: 55 }), [1, 2]);
    expect(state).toMatchObject({ combo: 42, maxCombo: 55 });
    const later = readings(
      state,
      Array.from({ length: 18 }, (_, index) => index + 3),
    );
    expect(later).toMatchObject({ combo: 60, maxCombo: 60 });
  });

  it('falls back to the stage combo after a break', () => {
    const state = readings(createCourseCombo({ combo: 40, maxCombo: 40 }), [5, 0]);
    expect(state.combo).toBe(0);
    expect(reduceCourseCombo(state, 1)).toMatchObject({ combo: 1, maxCombo: 45 });
  });

  it('treats a drop between readings as a break', () => {
    expect(readings(createCourseCombo({ combo: 10, maxCombo: 10 }), [8, 2])).toMatchObject({ combo: 2, maxCombo: 18 });
  });

  it('starts from zero without a carry', () => {
    expect(reduceCourseCombo(createCourseCombo(), 3)).toMatchObject({ combo: 3, maxCombo: 3 });
  });

  it('reduces without changing the state it is given', () => {
    const state = createCourseCombo({ combo: 4, maxCombo: 9 });
    const next = reduceCourseCombo(state, 2);
    expect(next).toEqual({ combo: 6, maxCombo: 9, stageCombo: 2 });
    expect(state).toEqual({ combo: 4, maxCombo: 9, stageCombo: 0 });
  });
});
