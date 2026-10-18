import type { JudgeWindowSetUs, RulesetWindowTables } from '@be-music/player/core/engine';
import { describe, expect, it } from 'vite-plus/test';
import { toBeMusicJudgeWindows } from './judge-windows.ts';

const KEY: JudgeWindowSetUs = {
  judges: [
    [-20_000, 20_000],
    [-60_000, 50_000],
    [-150_000, 120_000],
    [-280_000, 220_000],
  ],
  ms: [-0, 1_000_000],
};
const SCRATCH: JudgeWindowSetUs = {
  judges: [
    [-30_000, 30_000],
    [-70_000, 70_000],
    [-160_000, 160_000],
    [-290_000, 290_000],
  ],
  ms: [-500_000, 500_000],
};
const LONG_END: JudgeWindowSetUs = {
  judges: [
    [-120_000, 120_000],
    [-160_000, 160_000],
    [-200_000, 200_000],
    [-280_000, 220_000],
  ],
};

describe('toBeMusicJudgeWindows', () => {
  it('turns the µs window pairs into positive early / late ms', () => {
    const tables: RulesetWindowTables = {
      note: KEY,
      scratch: SCRATCH,
      longNoteEnd: LONG_END,
      longScratchEnd: LONG_END,
    };
    const windows = toBeMusicJudgeWindows(tables);
    expect(windows.note).toEqual({
      perfect: { earlyMs: 20, lateMs: 20 },
      great: { earlyMs: 50, lateMs: 60 },
      good: { earlyMs: 120, lateMs: 150 },
      bad: { earlyMs: 220, lateMs: 280 },
      emptyPoor: { earlyMs: 1000, lateMs: 0 },
    });
    expect(Object.is(windows.note.emptyPoor?.lateMs, 0)).toBe(true);
    expect(windows.scratch.bad).toEqual({ earlyMs: 290, lateMs: 290 });
    expect(windows.scratch.emptyPoor).toEqual({ earlyMs: 500, lateMs: 500 });
  });

  it('leaves out the empty POOR window where the ruleset has none', () => {
    const tables: RulesetWindowTables = { note: KEY, scratch: SCRATCH, longNoteEnd: LONG_END, longScratchEnd: KEY };
    const { longNoteEnd } = toBeMusicJudgeWindows(tables);
    expect(longNoteEnd.emptyPoor).toBeUndefined();
    expect('emptyPoor' in longNoteEnd).toBe(false);
    expect(longNoteEnd.perfect).toEqual({ earlyMs: 120, lateMs: 120 });
  });
});
