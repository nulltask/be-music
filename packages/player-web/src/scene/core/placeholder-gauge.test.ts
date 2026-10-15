import { describe, expect, test } from 'vite-plus/test';
import { createPlaceholderGaugeState } from './placeholder-gauge.ts';

describe('createPlaceholderGaugeState', () => {
  test('shows the single-chart gauge at its start outside a course', () => {
    expect(createPlaceholderGaugeState('GROOVE')).toMatchObject({ type: 'GROOVE', current: 20, clearThreshold: 80 });
    expect(createPlaceholderGaugeState('HARD')).toMatchObject({ type: 'HARD', current: 100, survival: true });
  });

  test('starts a course stage on its course gauge and the value carried in', () => {
    const first = createPlaceholderGaugeState('GROOVE', { stage: { kind: 'grade' }, ruleset: 'lr2' });
    expect(first).toMatchObject({
      type: 'GRADE',
      current: 100,
      initial: 100,
      clearThreshold: 0,
      survival: true,
      cleared: true,
    });
    const carryIn = { gauge: 64, combo: 0, maxCombo: 12 };
    const later = createPlaceholderGaugeState('EASY', { stage: { kind: 'expert', carryIn }, ruleset: 'lr2' });
    expect(later).toMatchObject({ type: 'COURSE-EASY', current: 64, initial: 64 });
    expect(createPlaceholderGaugeState('GROOVE', { stage: { kind: 'grade' }, ruleset: 'beatoraja' }).type).toBe(
      'CLASS',
    );
  });
});
