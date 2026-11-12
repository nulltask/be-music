import { expect, test } from 'vite-plus/test';
import { resolveLinearTargetPace } from './target-pace.ts';

const score = (judged: number, total = 100) => ({ total, perfect: judged, great: 0, good: 0, bad: 0, poor: 0 });

test('a fixed target advances evenly with the notes judged', () => {
  expect(resolveLinearTargetPace(180, score(0))).toBe(0);
  expect(resolveLinearTargetPace(180, score(50))).toBe(90);
  expect(resolveLinearTargetPace(180, score(100))).toBe(180);
  expect(resolveLinearTargetPace(180, { total: 100, perfect: 10, great: 10, good: 5, bad: 3, poor: 2 })).toBe(54);
});

test('a chart without notes and a count past the total stay in range', () => {
  expect(resolveLinearTargetPace(180, score(0, 0))).toBe(0);
  expect(resolveLinearTargetPace(180, score(120))).toBe(180);
});
