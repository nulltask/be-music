import { expect, test } from 'vite-plus/test';
import { resolveChartGaugeType } from './chart-gauge.ts';

test('no GAMELEVEL or EXTRA selects nothing', () => {
  expect(resolveChartGaugeType(undefined, 'lr2')).toBeUndefined();
  expect(resolveChartGaugeType({}, 'beatoraja')).toBeUndefined();
});

// Rows: GAMELEVEL / EXTRA; columns: lr2, beatoraja, ____.
test.each([
  ['BEGINNER', undefined, 'EASY', 'EASY', 'EASY'],
  ['BEGINNER', 'EASY', 'EASY', 'ASSIST-EASY', 'ASSIST-EASY'],
  ['BEGINNER', 'HARD', 'GROOVE', 'GROOVE', 'GROOVE'],
  ['BEGINNER', 'VERYHARD', 'GROOVE', 'GROOVE', 'GROOVE'],
  ['NORMAL', undefined, 'GROOVE', 'GROOVE', 'GROOVE'],
  ['NORMAL', 'EASY', 'EASY', 'EASY', 'EASY'],
  ['NORMAL', 'HARD', 'HARD', 'HARD', 'HARD'],
  ['NORMAL', 'VERYHARD', 'HARD', 'EX-HARD', 'EX-HARD'],
  [undefined, 'VERYHARD', 'HARD', 'EX-HARD', 'EX-HARD'],
  ['HYPER', undefined, 'HARD', 'HARD', 'HARD'],
  ['HYPER', 'EASY', 'HARD', 'HARD', 'HARD'],
  ['HYPER', 'HARD', 'HARD', 'EX-HARD', 'EX-HARD'],
  ['HYPER', 'VERYHARD', 'HARD', 'EX-HARD', 'EX-HARD'],
  ['DANGER', undefined, 'DEATH', 'DEATH', 'EX-HARD'],
  ['DANGER', 'VERYHARD', 'DEATH', 'DEATH', 'EX-HARD'],
] as const)('%s / EXTRA %s → lr2 %s, beatoraja %s, ____ %s', (gameLevel, extra, lr2, beatoraja, ac) => {
  const options = { ...(gameLevel ? { gameLevel } : {}), ...(extra ? { extra } : {}) };
  expect(resolveChartGaugeType(options, 'lr2')).toBe(lr2);
  expect(resolveChartGaugeType(options, 'beatoraja')).toBe(beatoraja);
  expect(resolveChartGaugeType(options, '____')).toBe(ac);
});
