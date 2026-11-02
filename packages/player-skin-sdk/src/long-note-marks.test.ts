import { describe, expect, test } from 'vite-plus/test';
import {
  backSpinChevron,
  hellChargeRungs,
  isBackSpinScratchLongNote,
  resolveHellChargeLook,
  resolveLongNoteMarks,
} from './long-note-marks.ts';

describe('long-note marks', () => {
  test('a back-spin scratch is a charge note on a scratch lane', () => {
    expect(isBackSpinScratchLongNote('scratch', 'cn')).toBe(true);
    expect(isBackSpinScratchLongNote('scratch', 'hcn')).toBe(true);
    expect(isBackSpinScratchLongNote('scratch', 'ln')).toBe(false);
    expect(isBackSpinScratchLongNote('scratch', undefined)).toBe(false);
    expect(isBackSpinScratchLongNote('white', 'cn')).toBe(false);
  });

  test.each([
    [{ mode: 'ln' as const }, { judgedTail: false, hellCharge: false, backSpin: false }],
    [{ mode: 'cn' as const }, { judgedTail: true, hellCharge: false, backSpin: false }],
    [{ mode: 'hcn' as const }, { judgedTail: true, hellCharge: true, backSpin: false }],
    [
      { mode: 'cn' as const, backSpinScratch: true },
      { judgedTail: true, hellCharge: false, backSpin: true },
    ],
    [
      { mode: 'hcn' as const, backSpinScratch: true },
      { judgedTail: true, hellCharge: true, backSpin: true },
    ],
    [{}, { judgedTail: true, hellCharge: false, backSpin: false }],
  ])('marks of %o', (note, marks) => {
    expect(resolveLongNoteMarks(note)).toEqual(marks);
  });

  test('rungs are spaced evenly inside the body and stand still unless flowing', () => {
    expect(hellChargeRungs(0, 70, { spacing: 14 })).toEqual([7, 21, 35, 49]);
    expect(hellChargeRungs(0, 70, { spacing: 14, nowMs: 5000 })).toEqual([7, 21, 35, 49]);
    expect(hellChargeRungs(0, 10, { spacing: 14 })).toEqual([]);
    expect(hellChargeRungs(0, 70, { spacing: 0 })).toEqual([]);
  });

  test('flowing rungs move down and wrap', () => {
    // 60 px/s for 0.1 s moves them 6 px; 14 px later they are back where they started.
    expect(hellChargeRungs(0, 70, { spacing: 14, flowing: true, nowMs: 100 })).toEqual([13, 27, 41, 55]);
    expect(hellChargeRungs(0, 70, { spacing: 14, flowing: true, nowMs: 0 })).toEqual([7, 21, 35, 49]);
    const wrapped = hellChargeRungs(0, 70, { spacing: 14, flowing: true, nowMs: 1000 * (14 / 60) });
    expect(wrapped.map((y) => Math.round(y * 1e6) / 1e6)).toEqual([7, 21, 35, 49]);
  });

  test('flow -1 moves the rungs back up the lane, flow 0 holds them still', () => {
    // Moved 6 px up: 21 → 15, and the rung at 7 leaves the inset body.
    expect(hellChargeRungs(0, 70, { spacing: 14, flow: -1, nowMs: 100 })).toEqual([15, 29, 43, 57]);
    expect(hellChargeRungs(0, 70, { spacing: 14, flow: 0, flowing: true, nowMs: 100 })).toEqual([7, 21, 35, 49]);
    expect(hellChargeRungs(0, 70, { spacing: 14, flow: 1, nowMs: 100 })).toEqual([13, 27, 41, 55]);
  });

  test('each hell charge phase differs in colour, glow and rung motion together', () => {
    const standby = resolveHellChargeLook('pending', 0);
    const charging = resolveHellChargeLook('held', 0);
    const draining = resolveHellChargeLook('draining', 0);
    expect(resolveHellChargeLook(undefined)).toEqual(standby);
    expect(standby).toMatchObject({ phase: 'standby', flow: 0, glow: 0.3 });
    expect(charging).toMatchObject({ phase: 'charging', flow: 1 });
    expect(draining).toMatchObject({ phase: 'draining', flow: -1 });
    expect(new Set([standby.color, charging.color, draining.color]).size).toBe(3);
    // Without colour, the glow still sets them apart: charging brightest, draining dimmest.
    for (const nowMs of [0, 125, 250, 400, 777]) {
      const bright = resolveHellChargeLook('held', nowMs).glow;
      const dim = resolveHellChargeLook('draining', nowMs).glow;
      expect(bright).toBeGreaterThanOrEqual(0.8);
      expect(bright).toBeLessThanOrEqual(1);
      expect(dim).toBeGreaterThanOrEqual(0.15);
      expect(dim).toBeLessThan(standby.glow + 1e-9);
    }
    for (const state of ['done', 'dropped'] as const) {
      expect(resolveHellChargeLook(state, 100)).toEqual({ phase: 'spent', color: standby.color, glow: 0, flow: 0 });
    }
  });

  test('the chevron points up, centred on the lane, inside a tall cap and above a thin one', () => {
    const inside = backSpinChevron(100, 40, 200, 16);
    expect(inside).toHaveLength(12);
    const xs = inside.filter((_, index) => index % 2 === 0);
    const ys = inside.filter((_, index) => index % 2 === 1);
    expect(Math.min(...xs) + Math.max(...xs)).toBeCloseTo(240);
    // The apex is the highest point.
    expect(ys[1]).toBe(Math.min(...ys));
    expect(Math.max(...ys)).toBeLessThanOrEqual(200);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(184);
    const above = backSpinChevron(100, 40, 200, 4);
    expect(Math.max(...above.filter((_, index) => index % 2 === 1))).toBeLessThan(196);
  });
});
