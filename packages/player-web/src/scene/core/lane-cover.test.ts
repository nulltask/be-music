import { describe, expect, it } from 'vite-plus/test';
import { resolveHiSpeedForVisibleMs, resolveNoteVisibleMs } from './lane-cover.ts';

describe('resolveNoteVisibleMs', () => {
  it('measures the lane in beats at the scroll and converts beats to ms at the BPM', () => {
    // 576 px at 144 px/beat = 4 beats; at 120 BPM one beat is 500 ms.
    expect(resolveNoteVisibleMs(576, 0, 0, 144, 120)).toBe(2000);
  });

  it("matches beatoraja's white number for a lane one measure tall at hi-speed 1", () => {
    const hiSpeed = 2.5;
    const bpm = 155;
    const lanecover = 0.2;
    const pixelsPerBeat = 72 * hiSpeed;
    const beatoraja = (240_000 / bpm / hiSpeed) * (1 - lanecover);
    expect(resolveNoteVisibleMs(72 * 4, lanecover, 0, pixelsPerBeat, bpm)).toBeCloseTo(beatoraja, 9);
  });

  it('divides by the scroll rate and reads 0 while the chart scrolls backwards or stands still, as beatoraja', () => {
    // beatoraja: `region = nscroll > 0 ? (240000 / nbpm / hispeed / speed) / nscroll : 0`.
    expect(resolveNoteVisibleMs(576, 0, 0, 144, 120, 2)).toBe(1000);
    expect(resolveNoteVisibleMs(576, 0, 0, 144, 120, 0.5)).toBe(4000);
    expect(resolveNoteVisibleMs(576, 0, 0, 144, 120, 0)).toBe(0);
    expect(resolveNoteVisibleMs(576, 0, 0, 144, 120, -1)).toBe(0);
  });

  it('subtracts SUDDEN+ and LIFT from the travelled height', () => {
    expect(resolveNoteVisibleMs(576, 0.25, 0.25, 144, 120)).toBe(1000);
    expect(resolveNoteVisibleMs(576, 0.8, 0.5, 144, 120)).toBe(0);
  });

  it('reports 0 without a usable scroll, BPM, or lane', () => {
    expect(resolveNoteVisibleMs(576, 0, 0, 0, 120)).toBe(0);
    expect(resolveNoteVisibleMs(576, 0, 0, 144, 0)).toBe(0);
    expect(resolveNoteVisibleMs(576, 0, 0, 144, Number.NaN)).toBe(0);
    expect(resolveNoteVisibleMs(0, 0, 0, 144, 120)).toBe(0);
  });
});

describe('resolveHiSpeedForVisibleMs', () => {
  it('inverts resolveNoteVisibleMs', () => {
    const visibleMs = resolveNoteVisibleMs(480, 0.25, 0, 120 * 2.5, 150);
    expect(resolveHiSpeedForVisibleMs(480, 0.25, 0, 120, 150, visibleMs)).toBeCloseTo(2.5, 9);
  });

  it('is undefined when nothing is uncovered or an input is not positive', () => {
    expect(resolveHiSpeedForVisibleMs(480, 1, 0, 120, 150, 500)).toBeUndefined();
    expect(resolveHiSpeedForVisibleMs(480, 0, 0, 120, 0, 500)).toBeUndefined();
    expect(resolveHiSpeedForVisibleMs(480, 0, 0, 120, 150, 0)).toBeUndefined();
  });
});
