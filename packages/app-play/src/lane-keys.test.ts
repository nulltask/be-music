import { describe, expect, test } from 'vite-plus/test';
import { assignLaneKey, effectiveLaneKey, parseLaneKeys, resetLaneKeys } from './lane-keys.ts';

describe('parseLaneKeys', () => {
  test('keeps known groups and lanes with tokens, and drops the rest', () => {
    expect(
      parseLaneKeys({
        beat: { '11': ['a'], '99': ['q'], '12': [], '13': ['', 3, 'w'] },
        popn: { '1': ['shift-left'] },
        other: { '1': ['x'] },
      }),
    ).toEqual({ beat: { '11': ['a'], '13': ['w'] }, popn: { '1': ['shift-left'] } });
  });

  test('reads anything else as no keys of the player’s own', () => {
    expect(parseLaneKeys(undefined)).toEqual({});
    expect(parseLaneKeys([])).toEqual({});
    expect(parseLaneKeys({ beat: ['a'] })).toEqual({});
  });
});

describe('effectiveLaneKey', () => {
  test('is the player’s own key, else the default', () => {
    expect(effectiveLaneKey({ beat: { '11': ['a'] } }, 'beat', '11')).toBe('a');
    expect(effectiveLaneKey({}, 'beat', '16')).toBe('shift-left');
    expect(effectiveLaneKey({}, 'popn', '9')).toBe('b');
  });
});

describe('assignLaneKey', () => {
  test('gives a lane a free key', () => {
    expect(assignLaneKey({}, 'beat', '11', 'a')).toEqual({ beat: { '11': ['a'] } });
  });

  test('swaps with the lane that had the key, so no two lanes share one', () => {
    // `s` is lane 12's default: it moves to 11, and 12 takes 11's `z`.
    const keys = assignLaneKey({}, 'beat', '11', 's');
    expect(keys).toEqual({ beat: { '11': ['s'], '12': ['z'] } });
    expect(effectiveLaneKey(keys, 'beat', '12')).toBe('z');
  });

  test('drops the entry of a lane back on its default, and the group with none left', () => {
    const keys = assignLaneKey({ beat: { '11': ['a'] }, popn: { '1': ['q'] } }, 'beat', '11', 'z');
    expect(keys).toEqual({ popn: { '1': ['q'] } });
  });

  test('keeps the other group as it is, and ignores an unknown lane or an empty key', () => {
    const keys = { popn: { '1': ['q'] } };
    expect(assignLaneKey(keys, 'beat', '16', 'tab')).toEqual({ popn: { '1': ['q'] }, beat: { '16': ['tab'] } });
    expect(assignLaneKey(keys, 'beat', '99', 'a')).toBe(keys);
    expect(assignLaneKey(keys, 'beat', '11', '')).toBe(keys);
  });
});

test('resetLaneKeys puts one group back on its defaults', () => {
  expect(resetLaneKeys({ beat: { '11': ['a'] }, popn: { '1': ['q'] } }, 'beat')).toEqual({ popn: { '1': ['q'] } });
});
