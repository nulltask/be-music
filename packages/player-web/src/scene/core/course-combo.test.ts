import { describe, expect, it } from 'vite-plus/test';
import { advanceCourseCombo, createCourseCombo } from './course-combo.ts';

describe('course combo', () => {
  it('runs on from the carried-in combo until the first break', () => {
    const state = createCourseCombo({ combo: 40, maxCombo: 55 });
    advanceCourseCombo(state, 1);
    advanceCourseCombo(state, 2);
    expect(state).toMatchObject({ combo: 42, maxCombo: 55 });
    for (let combo = 3; combo <= 20; combo += 1) advanceCourseCombo(state, combo);
    expect(state).toMatchObject({ combo: 60, maxCombo: 60 });
  });

  it('falls back to the stage combo after a break', () => {
    const state = createCourseCombo({ combo: 40, maxCombo: 40 });
    advanceCourseCombo(state, 5);
    advanceCourseCombo(state, 0);
    expect(state.combo).toBe(0);
    advanceCourseCombo(state, 1);
    expect(state).toMatchObject({ combo: 1, maxCombo: 45 });
  });

  it('treats a drop between readings as a break', () => {
    const state = createCourseCombo({ combo: 10, maxCombo: 10 });
    advanceCourseCombo(state, 8);
    advanceCourseCombo(state, 2);
    expect(state).toMatchObject({ combo: 2, maxCombo: 18 });
  });

  it('starts from zero without a carry', () => {
    const state = createCourseCombo();
    advanceCourseCombo(state, 3);
    expect(state).toMatchObject({ combo: 3, maxCombo: 3 });
  });
});
