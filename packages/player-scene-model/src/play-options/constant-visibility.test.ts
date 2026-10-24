import { expect, test } from 'vite-plus/test';
import { resolveConstantAlpha, resolveConstantVisibility } from './constant-visibility.ts';
import { resolvePlayOptions } from './choices.ts';

test('normalizes beatoraja CONSTANT settings and disables only its practice preview', () => {
  expect(resolveConstantVisibility()).toEqual({ enabled: false, durationMs: 500, fadeMs: 100 });
  expect(resolveConstantVisibility({ enabled: true, durationMs: -5, fadeMs: 2000 })).toEqual({
    enabled: true,
    durationMs: 1,
    fadeMs: 1000,
  });
  expect(resolveConstantVisibility({ durationMs: 20000, fadeMs: -2000 })).toEqual({
    enabled: false,
    durationMs: 10000,
    fadeMs: -1000,
  });
  expect(resolveConstantVisibility({ enabled: true, practicePreview: true }).enabled).toBe(false);
  expect(resolveConstantVisibility({ durationMs: NaN, fadeMs: Infinity })).toEqual(resolveConstantVisibility());
});

test('positive fade reveals the timeline before the duration horizon', () => {
  const options = resolveConstantVisibility({ enabled: true });
  expect(resolveConstantAlpha(1, 0, options)).toBe(0);
  expect(resolveConstantAlpha(0.55, 0, options)).toBeCloseTo(0.5);
  expect(resolveConstantAlpha(0.5, 0, options)).toBe(1);
  expect(resolveConstantAlpha(-1, 0, options)).toBe(1);
});

test('negative and zero fades use the source horizon boundary', () => {
  const options = resolveConstantVisibility({ enabled: true, fadeMs: -100 });
  expect(resolveConstantAlpha(0.5, 0, options)).toBe(0);
  expect(resolveConstantAlpha(0.45, 0, options)).toBeCloseTo(0.5);
  expect(resolveConstantAlpha(0.4, 0, options)).toBe(1);
  expect(resolveConstantAlpha(0, 0, { ...options, fadeMs: -1000 })).toBe(0.5);
  expect(resolveConstantAlpha(0.5, 0, { ...options, fadeMs: 0 })).toBe(0);
  expect(resolveConstantAlpha(0.499, 0, { ...options, fadeMs: 0 })).toBe(1);
});

test('disabled CONSTANT leaves opacity intact and enabled CONSTANT rejects invalid clocks', () => {
  expect(resolveConstantAlpha(100, 0, resolveConstantVisibility())).toBe(1);
  expect(resolveConstantAlpha(NaN, 0, resolveConstantVisibility({ enabled: true }))).toBe(0);
});

test('restores the option snapshot with source defaults and numeric bounds', () => {
  expect(resolvePlayOptions({ visualConstant: true, noteDurationMs: 0, constantFadeMs: -2000 })).toMatchObject({
    visualConstant: true,
    noteDurationMs: 1,
    constantFadeMs: -1000,
  });
});
