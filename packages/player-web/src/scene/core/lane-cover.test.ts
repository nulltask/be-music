import { describe, expect, it } from 'vite-plus/test';
import type { BeMusicLaneCover } from '../../skin/be-music/types.ts';
import { fillLaneCover, resolveGreenNumber, resolveNoteVisibleMs } from './lane-cover.ts';

const blank = (): BeMusicLaneCover => ({ side: '1P', sudden: 9, hidden: 9, lift: 9 });

describe('fillLaneCover', () => {
  it('covers the top under SUDDEN, the bottom under HIDDEN, and both under HID+SUD', () => {
    expect(fillLaneCover(blank(), 'SUDDEN', 0.3, true)).toEqual({ side: '1P', sudden: 0.3, hidden: 0, lift: 0 });
    expect(fillLaneCover(blank(), 'HIDDEN', 0.3, true)).toEqual({ side: '1P', sudden: 0, hidden: 0.3, lift: 0 });
    expect(fillLaneCover(blank(), 'HID+SUD', 0.3, true)).toEqual({ side: '1P', sudden: 0.3, hidden: 0.3, lift: 0 });
  });

  it('covers nothing when the mode is OFF or LANE COVER is switched off', () => {
    expect(fillLaneCover(blank(), 'OFF', 0.3, true)).toEqual({ side: '1P', sudden: 0, hidden: 0, lift: 0 });
    expect(fillLaneCover(blank(), 'HID+SUD', 0.3, false)).toEqual({ side: '1P', sudden: 0, hidden: 0, lift: 0 });
  });

  it('defaults the shutter to a quarter and clamps it to 0..1, like the scene', () => {
    expect(fillLaneCover(blank(), 'SUDDEN', undefined, undefined).sudden).toBe(0.25);
    expect(fillLaneCover(blank(), 'SUDDEN', 1.5, true).sudden).toBe(1);
    expect(fillLaneCover(blank(), 'HIDDEN', -0.2, true).hidden).toBe(0);
  });

  it('writes into the object it is given', () => {
    const target = blank();
    expect(fillLaneCover(target, 'SUDDEN', 0.5, true)).toBe(target);
  });
});

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

describe('resolveGreenNumber', () => {
  it('takes three fifths of the visible time, rounded', () => {
    expect(resolveGreenNumber(2000)).toBe(1200);
    expect(resolveGreenNumber(1001)).toBe(601);
    expect(resolveGreenNumber(0)).toBe(0);
  });
});
