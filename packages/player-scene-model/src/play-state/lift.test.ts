import { expect, test } from 'vite-plus/test';
import { resolveLiftedLane } from './lift.ts';

test.each([
  { top: 0, bottom: 480 },
  { top: 420, bottom: 1800 },
])('LIFT keeps time-to-line on any stage: %o', (lane) => {
  const before = { ...lane, x: 20, w: 30 };
  const lifted = resolveLiftedLane(before, 0.25);
  expect(lifted.bottom).toBe(lane.bottom - (lane.bottom - lane.top) * 0.25);
  expect(lifted.baseBottom).toBe(lane.bottom);
  expect(lifted.scrollScale).toBe(0.75);
  const speed = 100;
  expect((lifted.bottom - lane.top) / (speed * lifted.scrollScale)).toBe((lane.bottom - lane.top) / speed);
  expect(before).toEqual({ ...lane, x: 20, w: 30 });
});

test('bounds LIFT and keeps sides independent, including a fully closed lane', () => {
  expect(resolveLiftedLane({ top: 10, bottom: 410 }, 2)).toMatchObject({ bottom: 10, scrollScale: 0 });
  expect(resolveLiftedLane({ top: 10, bottom: 410 }, -1)).toMatchObject({ bottom: 410, scrollScale: 1 });
  expect(resolveLiftedLane({ top: 10, bottom: 410 }, NaN)).toMatchObject({ bottom: 410, scrollScale: 1 });
  expect(resolveLiftedLane({ top: 10, bottom: 410 }, 0.1).bottom).toBe(370);
  expect(resolveLiftedLane({ top: 10, bottom: 410 }, 0.3).bottom).toBe(290);
});

test('AC LIFT raises the line while retaining the original scroll scale', () => {
  expect(resolveLiftedLane({ top: 0, bottom: 723 }, 100 / 723, false)).toEqual({
    top: 0,
    bottom: 623,
    baseBottom: 723,
    scrollScale: 1,
  });
});
