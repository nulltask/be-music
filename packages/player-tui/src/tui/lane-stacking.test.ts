import { describe, expect, test } from 'vitest';
import { findStackableRowIndex } from './lane-stacking.ts';

describe('lane stacking', () => {
  test('prefers rows above the occupied row before checking lower rows', () => {
    const candidates = new Set([4, 6, 3]);
    const resolved = findStackableRowIndex(10, 5, (row) => candidates.has(row));
    expect(resolved).toBe(4);
  });

  test('falls back to lower rows when no upper row is available', () => {
    const candidates = new Set([6, 7]);
    const resolved = findStackableRowIndex(10, 5, (row) => candidates.has(row));
    expect(resolved).toBe(6);
  });

  test('returns undefined when no stackable rows exist', () => {
    const resolved = findStackableRowIndex(10, 5, () => false);
    expect(resolved).toBeUndefined();
  });
});
