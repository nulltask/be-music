import { describe, expect, test } from 'vite-plus/test';
import {
  ignoresLateLongNoteHeadBad,
  isChargeLongNoteMode,
  isMultiBadCollectorTarget,
  longNoteOwesTailMiss,
  resolveEffectiveLongNoteMode,
  resolveLnEarlyRelease,
} from './long-note.ts';
import type { JudgeWindowSetUs } from './definitions.ts';

/** Symmetric end windows: PGREAT ±20 ms, GREAT ±60 ms, GOOD ±150 ms, BAD ±250 ms. */
const END_WINDOWS: JudgeWindowSetUs = {
  judges: [
    [-20_000, 20_000],
    [-60_000, 60_000],
    [-150_000, 150_000],
    [-250_000, 250_000],
  ],
};

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

  test('longNoteOwesTailMiss charges a missed charge note twice unless the head cancels the tail', () => {
    const beatoraja = { headBadSkipsTail: false };
    const iidx = { headBadSkipsTail: true };
    expect(longNoteOwesTailMiss(beatoraja, 2)).toBe(true);
    expect(longNoteOwesTailMiss(beatoraja, 3)).toBe(true);
    expect(longNoteOwesTailMiss(beatoraja, 1)).toBe(false);
    expect(longNoteOwesTailMiss(beatoraja, undefined)).toBe(false);
    expect(longNoteOwesTailMiss(iidx, 2)).toBe(false);
  });

  test('ignoresLateLongNoteHeadBad only drops a late BAD on an LN head under LR2', () => {
    const lr2 = { ignoreLateBadOnLnHead: true };
    expect(ignoresLateLongNoteHeadBad(lr2, 3, true, 1)).toBe(true);
    expect(ignoresLateLongNoteHeadBad(lr2, 3, false, 1)).toBe(false);
    expect(ignoresLateLongNoteHeadBad(lr2, 2, true, 1)).toBe(false);
    expect(ignoresLateLongNoteHeadBad(lr2, 3, true, 2)).toBe(false);
    expect(ignoresLateLongNoteHeadBad(lr2, 3, true, undefined)).toBe(false);
    expect(ignoresLateLongNoteHeadBad({ ignoreLateBadOnLnHead: false }, 3, true, 1)).toBe(false);
  });

  describe('resolveLnEarlyRelease', () => {
    const lr2 = { lnEarlyRelease: 'head-unless-beyond-good' } as const;
    const beatoraja = { lnEarlyRelease: 'worse-of-head-and-tail' } as const;
    const pgreatHead = { judge: 0, dmUs: 5_000 } as const;

    test('LR2 keeps the head judgment for a release inside the GOOD window', () => {
      expect(resolveLnEarlyRelease(lr2, pgreatHead, 1, END_WINDOWS)).toEqual(pgreatHead);
      expect(resolveLnEarlyRelease(lr2, pgreatHead, 100_000, END_WINDOWS)).toEqual(pgreatHead);
      expect(resolveLnEarlyRelease(lr2, pgreatHead, 150_000, END_WINDOWS)).toEqual(pgreatHead);
    });

    test('LR2 BADs a release more than the GOOD window before the tail', () => {
      expect(resolveLnEarlyRelease(lr2, pgreatHead, 150_001, END_WINDOWS)).toEqual({ judge: 3, dmUs: 150_001 });
      expect(resolveLnEarlyRelease(lr2, pgreatHead, 2_000_000, END_WINDOWS)).toEqual({ judge: 3, dmUs: 2_000_000 });
    });

    test('beatoraja takes the worse of the head and the release', () => {
      expect(resolveLnEarlyRelease(beatoraja, pgreatHead, 1, END_WINDOWS)).toEqual(pgreatHead);
      expect(resolveLnEarlyRelease(beatoraja, pgreatHead, 100_000, END_WINDOWS)).toEqual({ judge: 2, dmUs: 100_000 });
      expect(resolveLnEarlyRelease(beatoraja, { judge: 1, dmUs: -50_000 }, 10_000, END_WINDOWS)).toEqual({
        judge: 1,
        dmUs: -50_000,
      });
    });

    test('beatoraja BADs a release that lands BAD or outside every window before the tail', () => {
      expect(resolveLnEarlyRelease(beatoraja, pgreatHead, 200_000, END_WINDOWS)).toEqual({ judge: 3, dmUs: 200_000 });
      expect(resolveLnEarlyRelease(beatoraja, pgreatHead, 2_000_000, END_WINDOWS)).toEqual({
        judge: 3,
        dmUs: 2_000_000,
      });
    });
  });
});
