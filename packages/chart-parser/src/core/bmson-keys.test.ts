import { describe, expect, test } from 'vite-plus/test';
import {
  BMSON_BASE36_KEY_CAPACITY,
  BMSON_BASE62_KEY_CAPACITY,
  countDistinctValues,
  createBmsonValueKeyTable,
  encodeBmsonKey,
  resolveBmsonKeyBase,
} from './bmson-keys.ts';

describe('encodeBmsonKey', () => {
  test('encodes 1-based slots as 2-char base-36 keys up to ZZ', () => {
    expect(encodeBmsonKey(1, 36)).toBe('01');
    expect(encodeBmsonKey(36, 36)).toBe('10');
    expect(encodeBmsonKey(BMSON_BASE36_KEY_CAPACITY, 36)).toBe('ZZ');
  });

  test('encodes base-62 keys in beatoraja digit order 0-9A-Za-z up to zz', () => {
    expect(encodeBmsonKey(1, 62)).toBe('01');
    expect(encodeBmsonKey(36, 62)).toBe('0a');
    expect(encodeBmsonKey(62, 62)).toBe('10');
    expect(encodeBmsonKey(BMSON_BASE62_KEY_CAPACITY, 62)).toBe('zz');
  });

  test('returns undefined instead of wrapping around past the key space', () => {
    expect(encodeBmsonKey(0, 36)).toBeUndefined();
    expect(encodeBmsonKey(BMSON_BASE36_KEY_CAPACITY + 1, 36)).toBeUndefined();
    expect(encodeBmsonKey(BMSON_BASE62_KEY_CAPACITY + 1, 62)).toBeUndefined();
  });
});

describe('resolveBmsonKeyBase', () => {
  test('stays in base 36 while every resource fits in 1,295 keys', () => {
    expect(resolveBmsonKeyBase([0, 1, BMSON_BASE36_KEY_CAPACITY])).toBe(36);
  });

  test('switches to base 62 once any resource needs more than 1,295 keys', () => {
    expect(resolveBmsonKeyBase([3, BMSON_BASE36_KEY_CAPACITY + 1])).toBe(62);
  });
});

describe('countDistinctValues', () => {
  test('counts each value once', () => {
    expect(countDistinctValues([120, 240, 120, 120, 240])).toBe(2);
    expect(countDistinctValues([])).toBe(0);
  });
});

describe('createBmsonValueKeyTable', () => {
  test('gives one key per distinct value, in first-appearance order', () => {
    const { keys, table } = createBmsonValueKeyTable([120, 240, 120, 180, 240], 36);
    expect(keys).toEqual(['01', '02', '01', '03', '02']);
    expect(table).toEqual({ '01': 120, '02': 240, '03': 180 });
  });

  test('keeps every event value intact past 1,295 events when the values repeat', () => {
    const values = Array.from({ length: 2_000 }, (_, index) => (index % 2 === 0 ? 150 : 300));
    const { keys, table } = createBmsonValueKeyTable(values, 36);
    expect(Object.keys(table)).toHaveLength(2);
    expect(keys.map((key) => table[key])).toEqual(values);
  });

  test('maps 1,400 distinct values without collisions in base 62', () => {
    const values = Array.from({ length: 1_400 }, (_, index) => 100 + index);
    const { keys, table } = createBmsonValueKeyTable(values, 62);
    expect(new Set(keys).size).toBe(1_400);
    expect(keys.map((key) => table[key])).toEqual(values);
  });

  test('past the base-62 key space, reuses the key of the nearest kept value rather than overwriting one', () => {
    const values = Array.from({ length: BMSON_BASE62_KEY_CAPACITY + 2 }, (_, index) => index + 1);
    const { keys, table } = createBmsonValueKeyTable(values, 62);
    expect(Object.keys(table)).toHaveLength(BMSON_BASE62_KEY_CAPACITY);
    // Every value inside the key space still resolves to itself.
    expect(keys.slice(0, BMSON_BASE62_KEY_CAPACITY).map((key) => table[key])).toEqual(
      values.slice(0, BMSON_BASE62_KEY_CAPACITY),
    );
    // The two that do not fit fall back to the closest value that did.
    expect(table[keys[BMSON_BASE62_KEY_CAPACITY]!]).toBe(BMSON_BASE62_KEY_CAPACITY);
    expect(table[keys[BMSON_BASE62_KEY_CAPACITY + 1]!]).toBe(BMSON_BASE62_KEY_CAPACITY);
  });
});
