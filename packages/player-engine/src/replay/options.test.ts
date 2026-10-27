import { describe, expect, test } from 'vite-plus/test';
import {
  diffReplayOptions,
  parseReplayOptionChanges,
  parseReplayOptionState,
  resolveReplayOptionsAt,
} from './options.ts';
import type { ReplayOptionChange } from './options.ts';

describe('replay option timeline', () => {
  test('preserves source names and primitive values without keeping mutable caller objects', () => {
    const source = { hsFix: 'STARTBPM', displayAreaInfo: 'ON', hiSpeed: 2, autoScratch1P: true, future: null };
    const parsed = parseReplayOptionState(JSON.parse(JSON.stringify(source)));
    source.hiSpeed = 9;
    expect(parsed).toEqual({ hsFix: 'STARTBPM', displayAreaInfo: 'ON', hiSpeed: 2, autoScratch1P: true, future: null });
    for (const value of [{ nested: {} }, { array: [] }, { n: Infinity }, []])
      expect(() => parseReplayOptionState(value)).toThrow();
  });
  test('rejects invalid times and retains edits sharing one chart time', () => {
    for (const timeUs of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      expect(() => parseReplayOptionChanges([{ timeUs, values: {} }])).toThrow();
    expect(() =>
      parseReplayOptionChanges([
        { timeUs: 2, values: {} },
        { timeUs: 1, values: {} },
      ]),
    ).toThrow();
    expect(() => parseReplayOptionChanges({})).toThrow();
    expect(() => parseReplayOptionChanges([{ timeUs: 0, values: { n: {} } }])).toThrow();
    const changes = parseReplayOptionChanges([
      { timeUs: 0, values: { hiSpeed: 3 } },
      { timeUs: 0, values: { hiSpeed: 4 } },
    ]);
    expect(resolveReplayOptionsAt({ hiSpeed: 2 }, changes, 0)).toEqual({ hiSpeed: 4 });
  });
  test('reconstructs forward playback and backward seeks without mutating initial values', () => {
    const initial = { hiSpeed: 2, displayAreaInfo: 'OFF' };
    const changes: ReplayOptionChange[] = [
      { timeUs: 10, values: { hiSpeed: 3 } },
      { timeUs: 20, values: { displayAreaInfo: 'ON' } },
    ];
    expect(resolveReplayOptionsAt(initial, changes, 20)).toEqual({ hiSpeed: 3, displayAreaInfo: 'ON' });
    expect(resolveReplayOptionsAt(initial, changes, 9)).toEqual(initial);
    expect(initial.hiSpeed).toBe(2);
    expect(diffReplayOptions(initial, initial)).toBeUndefined();
    expect(diffReplayOptions(initial, { ...initial, hiSpeed: 3 })).toEqual({ hiSpeed: 3 });
    expect(resolveReplayOptionsAt(undefined, undefined, 0)).toEqual({});
  });
});
