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

test('P.ATTACK and EX-HARD show a full survival gauge before the engine starts', () => {
  for (const type of ['P-ATTACK', 'EX-HARD'] as const) {
    expect(createPlaceholderGaugeState(type)).toMatchObject({
      type,
      current: 100,
      initial: 100,
      survival: true,
      clearThreshold: 0,
    });
  }
  expect(
    createPlaceholderGaugeState('P-ATTACK', {
      ruleset: 'lr2',
      stage: { kind: 'grade', carryIn: { gauge: 31, combo: 0, maxCombo: 0 } },
    }),
  ).toMatchObject({ type: 'P-ATTACK', current: 31, initial: 31, survival: true });
});

test('G.ATTACK starts full, but LR2 grade courses use the reset grade gauge', () => {
  expect(createPlaceholderGaugeState('G-ATTACK')).toMatchObject({ type: 'G-ATTACK', current: 100, survival: true });
  expect(createPlaceholderGaugeState('G-ATTACK', { ruleset: 'lr2', stage: { kind: 'grade' } })).toMatchObject({
    type: 'GRADE',
    current: 100,
  });
  expect(
    createPlaceholderGaugeState('G-ATTACK', {
      ruleset: 'lr2',
      stage: { kind: 'expert', carryIn: { gauge: 31, combo: 0, maxCombo: 0 } },
    }),
  ).toMatchObject({ type: 'G-ATTACK', current: 31 });
});
