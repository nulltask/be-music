/** Two-character BMS export capacities; bmson's internal resource keys may grow beyond these limits. */
export const BMSON_BASE36_KEY_CAPACITY = 36 * 36 - 1;
export const BMSON_BASE62_KEY_CAPACITY = 62 * 62 - 1;

const BASE62_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * The radix the chart's keys need: base 36 while every resource fits in 1,295 keys, else base 62. The radix is
 * chart-wide (`bms.base`), so one oversized resource moves every key to base 62.
 */
export function resolveBmsonKeyBase(slotCounts: readonly number[]): 36 | 62 {
  for (const count of slotCounts) {
    if (count > BMSON_BASE36_KEY_CAPACITY) {
      return 62;
    }
  }
  return 36;
}

/** A minimum-two-character key for a positive, safe-integer slot. */
export function encodeBmsonKey(slot: number, base: 36 | 62): string | undefined {
  if (!Number.isSafeInteger(slot) || slot < 1) {
    return undefined;
  }
  if (base === 36) {
    return slot.toString(36).toUpperCase().padStart(2, '0');
  }
  let key = '';
  do {
    key = BASE62_DIGITS[slot % 62]! + key;
    slot = Math.floor(slot / 62);
  } while (slot > 0);
  return key.padStart(2, '0');
}

export function countDistinctValues(values: readonly number[]): number {
  return new Set(values).size;
}

export interface BmsonValueKeyTable {
  /** The key for each input value, index for index. */
  keys: string[];
  /** Key → value, ready to merge into the matching resource table. */
  table: Record<string, number>;
}

/** One exact key per distinct value, in first-appearance order; repeated values share a key. */
export function createBmsonValueKeyTable(values: readonly number[], base: 36 | 62): BmsonValueKeyTable {
  const keyByValue = new Map<number, string>();
  const table: Record<string, number> = {};
  const keys: string[] = [];
  for (const value of values) {
    let key = keyByValue.get(value);
    if (key === undefined) {
      key = encodeBmsonKey(keyByValue.size + 1, base)!;
      table[key] = value;
      keyByValue.set(value, key);
    }
    keys.push(key);
  }
  return { keys, table };
}
