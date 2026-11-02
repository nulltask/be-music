import { describe, expect, test } from 'vite-plus/test';
import {
  backSpinChevron,
  hellChargeZigzag,
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

  /** The zigzag as `[x, y]` pairs, rounded to µpx so float noise does not matter. */
  const pairs = (points: number[]): Array<[number, number]> => {
    const out: Array<[number, number]> = [];
    for (let index = 0; index < points.length; index += 2)
      out.push([Math.round(points[index]! * 1e6) / 1e6, Math.round(points[index + 1]! * 1e6) / 1e6]);
    return out;
  };

  test('the zigzag runs from the tail to the head about the centre, a corner every half wavelength', () => {
    expect(pairs(hellChargeZigzag(0, 20, 0, 28, { amplitude: 4, wavelength: 14 }))).toEqual([
      [6, 0],
      [14, 7],
      [6, 14],
      [14, 21],
      [6, 28],
    ]);
    // A span that does not end on a corner ends part way along the swing.
    expect(pairs(hellChargeZigzag(0, 20, 0, 10, { amplitude: 4, wavelength: 14 }))).toEqual([
      [6, 0],
      [14, 7],
      [10.571429, 10],
    ]);
    expect(hellChargeZigzag(0, 20, 0, 0)).toEqual([]);
    expect(hellChargeZigzag(0, 20, 0, 70, { wavelength: 0 })).toEqual([]);
  });

  test('the zigzag stands still unless it flows, and flows down or back up the lane', () => {
    const still = pairs(hellChargeZigzag(0, 20, 0, 28, { amplitude: 4, wavelength: 14 }));
    expect(pairs(hellChargeZigzag(0, 20, 0, 28, { amplitude: 4, wavelength: 14, nowMs: 5000 }))).toEqual(still);
    expect(pairs(hellChargeZigzag(0, 20, 0, 28, { amplitude: 4, wavelength: 14, flow: 0, nowMs: 100 }))).toEqual(still);
    // 60 px/s for 0.1 s moves it 6 px: the corner at 7 goes down to 13, or up to 1.
    const down = pairs(hellChargeZigzag(0, 20, 0, 28, { amplitude: 4, wavelength: 14, flow: 1, nowMs: 100 }));
    expect(down.slice(1, 3)).toEqual([
      [6, 6],
      [14, 13],
    ]);
    const up = pairs(hellChargeZigzag(0, 20, 0, 28, { amplitude: 4, wavelength: 14, flow: -1, nowMs: 100 }));
    expect(up.slice(1, 3)).toEqual([
      [14, 1],
      [6, 8],
    ]);
    // A whole wavelength later it is back where it started.
    const wrapped = pairs(
      hellChargeZigzag(0, 20, 0, 28, { amplitude: 4, wavelength: 14, flow: 1, nowMs: 1000 * (14 / 60) }),
    );
    expect(wrapped).toEqual(still);
    // Every corner stays inside the swing, and the line spans the body.
    for (const [x] of down) expect(Math.abs(x - 10)).toBeLessThanOrEqual(4 + 1e-9);
    expect(down[0]![1]).toBe(0);
    expect(down.at(-1)![1]).toBe(28);
  });

  test('each hell charge phase differs in colour, glow and zigzag motion together', () => {
    const standby = resolveHellChargeLook('pending', 0);
    const charging = resolveHellChargeLook('held', 0);
    const draining = resolveHellChargeLook('draining', 0);
    expect(resolveHellChargeLook(undefined)).toEqual(standby);
    expect(standby).toMatchObject({ phase: 'standby', flow: 0, glow: 0.3 });
    expect(charging).toMatchObject({ phase: 'charging', flow: 1 });
    expect(draining).toMatchObject({ phase: 'draining', flow: -1 });
    expect(new Set([standby.color, charging.color, draining.color]).size).toBe(3);
    expect(new Set([standby.lineColor, charging.lineColor, draining.lineColor]).size).toBe(3);
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
      expect(resolveHellChargeLook(state, 100)).toEqual({
        phase: 'spent',
        color: standby.color,
        lineColor: standby.lineColor,
        glow: 0,
        flow: 0,
      });
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
