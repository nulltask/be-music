import { expect, test } from 'vite-plus/test';
import { GUIDE_SOUNDS, resolveGuideSound } from './guide-sound.ts';

test('each judgment has its guide sound, in beatoraja’s order', () => {
  expect(GUIDE_SOUNDS).toEqual(['PG', 'GR', 'GD', 'BD', 'PR', 'MS']);
  expect(resolveGuideSound('PERFECT')).toBe('PG');
  expect(resolveGuideSound('GREAT')).toBe('GR');
  expect(resolveGuideSound('GOOD')).toBe('GD');
  expect(resolveGuideSound('BAD')).toBe('BD');
});

test('a missed note is PR and an empty POOR is MS', () => {
  expect(resolveGuideSound('POOR')).toBe('PR');
  expect(resolveGuideSound('POOR', 'empty')).toBe('MS');
});

test('nothing plays for READY or for the POOR that sums up a stopped play’s notes', () => {
  expect(resolveGuideSound('READY')).toBeUndefined();
  expect(resolveGuideSound('POOR', 'remaining')).toBeUndefined();
});
