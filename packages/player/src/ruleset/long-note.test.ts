import { describe, expect, test } from 'vite-plus/test';
import {
  addHCNPassing,
  ignoresLateLongNoteHeadBad,
  noteLateReachUs,
  isChargeLongNoteMode,
  isMultiBadCollectorTarget,
  longNoteOwesTailMiss,
  resolveEffectiveLongNoteMode,
  HCN_TICK_US,
  HCNTickCounter,
  resolveLNEarlyRelease,
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
    const lr2 = { ignoreLateBadOnLNHead: true };
    expect(ignoresLateLongNoteHeadBad(lr2, 3, true, 1)).toBe(true);
    expect(ignoresLateLongNoteHeadBad(lr2, 3, false, 1)).toBe(false);
    expect(ignoresLateLongNoteHeadBad(lr2, 2, true, 1)).toBe(false);
    expect(ignoresLateLongNoteHeadBad(lr2, 3, true, 2)).toBe(false);
    expect(ignoresLateLongNoteHeadBad(lr2, 3, true, undefined)).toBe(false);
    expect(ignoresLateLongNoteHeadBad({ ignoreLateBadOnLNHead: false }, 3, true, 1)).toBe(false);
  });

  test('noteLateReachUs stops an LR2 LN head at its late GOOD leg', () => {
    const lr2 = { ignoreLateBadOnLNHead: true };
    const windows = {
      judges: [
        [-15_000, 15_000],
        [-30_000, 30_000],
        [-60_000, 60_000],
        [-200_000, 200_000],
      ],
    } as unknown as JudgeWindowSetUs;
    expect(noteLateReachUs(lr2, windows, 1)).toBe(60_000);
    expect(noteLateReachUs(lr2, windows, undefined)).toBe(200_000);
    expect(noteLateReachUs(lr2, windows, 2)).toBe(200_000);
    expect(noteLateReachUs({ ignoreLateBadOnLNHead: false }, windows, 1)).toBe(200_000);
  });

  test('addHCNPassing chains passings by tail and drops a head judged after its tail', () => {
    interface Link {
      id: string;
      endUs: number;
      next?: Link;
    }
    const ids = (head: Link | undefined): string[] => {
      const out: string[] = [];
      for (let link = head; link !== undefined; link = link.next) out.push(link.id);
      return out;
    };
    const later: Link = { id: 'later', endUs: 3_000 };
    let chain = addHCNPassing<Link>(undefined, later, 2_000);
    expect(ids(chain)).toEqual(['later']);
    // An earlier note still passing goes ahead of the one judged early.
    chain = addHCNPassing(chain, { id: 'earlier', endUs: 1_500 }, 1_000);
    expect(ids(chain)).toEqual(['earlier', 'later']);
    // A head missed after its tail passed never ticks.
    chain = addHCNPassing(chain, { id: 'missed', endUs: 1_200 }, 1_200);
    expect(ids(chain)).toEqual(['earlier', 'later']);
    chain = addHCNPassing(chain, { id: 'last', endUs: 4_000 }, 3_500);
    expect(ids(chain)).toEqual(['earlier', 'later', 'last']);
  });

  describe('resolveLNEarlyRelease', () => {
    const lr2 = { lnEarlyRelease: 'head-unless-beyond-good' } as const;
    const beatoraja = { lnEarlyRelease: 'worse-of-head-and-tail' } as const;
    const pgreatHead = { judge: 0, dmUs: 5_000 } as const;

    test('LR2 keeps the head judgment for a release inside the GOOD window', () => {
      expect(resolveLNEarlyRelease(lr2, pgreatHead, 1, END_WINDOWS)).toEqual(pgreatHead);
      expect(resolveLNEarlyRelease(lr2, pgreatHead, 100_000, END_WINDOWS)).toEqual(pgreatHead);
      expect(resolveLNEarlyRelease(lr2, pgreatHead, 150_000, END_WINDOWS)).toEqual(pgreatHead);
    });

    test('LR2 BADs a release more than the GOOD window before the tail', () => {
      expect(resolveLNEarlyRelease(lr2, pgreatHead, 150_001, END_WINDOWS)).toEqual({ judge: 3, dmUs: 150_001 });
      expect(resolveLNEarlyRelease(lr2, pgreatHead, 2_000_000, END_WINDOWS)).toEqual({ judge: 3, dmUs: 2_000_000 });
    });

    test('beatoraja takes the worse of the head and the release', () => {
      expect(resolveLNEarlyRelease(beatoraja, pgreatHead, 1, END_WINDOWS)).toEqual(pgreatHead);
      expect(resolveLNEarlyRelease(beatoraja, pgreatHead, 100_000, END_WINDOWS)).toEqual({ judge: 2, dmUs: 100_000 });
      expect(resolveLNEarlyRelease(beatoraja, { judge: 1, dmUs: -50_000 }, 10_000, END_WINDOWS)).toEqual({
        judge: 1,
        dmUs: -50_000,
      });
    });

    test('beatoraja BADs a release that lands BAD or outside every window before the tail', () => {
      expect(resolveLNEarlyRelease(beatoraja, pgreatHead, 200_000, END_WINDOWS)).toEqual({ judge: 3, dmUs: 200_000 });
      expect(resolveLNEarlyRelease(beatoraja, pgreatHead, 2_000_000, END_WINDOWS)).toEqual({
        judge: 3,
        dmUs: 2_000_000,
      });
    });
  });

  describe('HCNTickCounter', () => {
    const run = (counter: HCNTickCounter, untilUs: number): Array<[boolean, number]> => {
      const ticks: Array<[boolean, number]> = [];
      counter.advance(untilUs, (gain, atUs) => ticks.push([gain, atUs]));
      return ticks;
    };

    test('a lane losing from the start ticks once the counter is past -200 ms, then every 200 ms', () => {
      const counter = new HCNTickCounter(1_000_000);
      expect(run(counter, 1_200_001)).toEqual([]);
      expect(run(counter, 1_600_001)).toEqual([
        [false, 1_200_001],
        [false, 1_400_001],
      ]);
    });

    test('gaining starts from where the counter stands and leftover time carries over', () => {
      const counter = new HCNTickCounter(0);
      counter.setGaining(true, 0, () => undefined);
      expect(run(counter, 150_000)).toEqual([]);
      counter.setGaining(false, 150_000, () => undefined);
      // From +150 ms the counter needs 350 ms more to pass -200 ms.
      expect(counter.nextTickUs()).toBe(150_000 + 350_001);
      expect(run(counter, 600_000)).toEqual([[false, 500_001]]);
    });

    test('a tick exactly at the limit waits for time to move past it', () => {
      const counter = new HCNTickCounter(0);
      counter.setGaining(true, 0, () => undefined);
      expect(run(counter, HCN_TICK_US + 1)).toEqual([]);
      expect(run(counter, HCN_TICK_US + 2)).toEqual([[true, HCN_TICK_US + 1]]);
    });
  });
});
