import { describe, expect, test } from 'vite-plus/test';
import { isChargeLongNoteMode, isMultiBadCollectorTarget, resolveEffectiveLongNoteMode } from './long-note.ts';

describe('ruleset long-note rules', () => {
  test('resolveEffectiveLongNoteMode maps the chart mode through the ruleset style', () => {
    expect([1, 2, 3].map((mode) => resolveEffectiveLongNoteMode('ln', mode as 1 | 2 | 3))).toEqual([1, 1, 1]);
    expect([1, 2, 3].map((mode) => resolveEffectiveLongNoteMode('per-note', mode as 1 | 2 | 3))).toEqual([1, 2, 3]);
    expect([1, 2, 3].map((mode) => resolveEffectiveLongNoteMode('charge', mode as 1 | 2 | 3))).toEqual([2, 2, 3]);
  });

  test('isChargeLongNoteMode is true for CN and HCN only', () => {
    expect([1, 2, 3].map((mode) => isChargeLongNoteMode(mode as 1 | 2 | 3))).toEqual([false, true, true]);
  });

  test('isMultiBadCollectorTarget only takes later notes after a tap BAD', () => {
    const later = { time: 2, isLong: false };
    expect(isMultiBadCollectorTarget({ time: 1, isLong: false, judge: 3 }, later)).toBe(true);
    expect(isMultiBadCollectorTarget({ time: 1, isLong: false, judge: 2 }, later)).toBe(false);
    expect(isMultiBadCollectorTarget({ time: 1, isLong: true, judge: 3 }, later)).toBe(false);
  });

  test('isMultiBadCollectorTarget spares earlier long notes but takes earlier taps', () => {
    const consumed = { time: 2, isLong: false, judge: 0 } as const;
    expect(isMultiBadCollectorTarget(consumed, { time: 1, isLong: false })).toBe(true);
    expect(isMultiBadCollectorTarget(consumed, { time: 1, isLong: true })).toBe(false);
    expect(isMultiBadCollectorTarget(consumed, { time: 2, isLong: true })).toBe(true);
  });
});
