import { intToBase36 } from '@be-music/chart-source';

/**
 * bmson has no object IDs: its BPM / STOP changes and sound channels are plain lists. The IR keys them like BMS, with
 * 2-char object IDs into `resources.wav` / `resources.bpm` / `resources.stop` (and `bms.scroll`), so the parser hands
 * out those keys itself. A 2-char key holds slots `01`..`ZZ` (1,295) in base 36 and `01`..`zz` (3,843) in the
 * beatoraja base-62 extension; past that a key would wrap round onto an earlier slot and overwrite its value.
 */
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

/** The 2-char key for a 1-based slot, or `undefined` when the slot is outside the radix's key space. */
export function encodeBmsonKey(slot: number, base: 36 | 62): string | undefined {
  const capacity = base === 62 ? BMSON_BASE62_KEY_CAPACITY : BMSON_BASE36_KEY_CAPACITY;
  if (!Number.isInteger(slot) || slot < 1 || slot > capacity) {
    return undefined;
  }
  if (base === 36) {
    return intToBase36(slot, 2);
  }
  return BASE62_DIGITS[Math.floor(slot / 62)]! + BASE62_DIGITS[slot % 62]!;
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

/**
 * One key per distinct value, in first-appearance order, so repeating values share a key and a chart with thousands of
 * BPM / STOP / SCROLL events usually needs only a handful. Values past the key space — more distinct values than
 * 2-char keys, which no known chart has — take the key of the nearest value that got one, so they bend to a close
 * value instead of overwriting another event's.
 */
export function createBmsonValueKeyTable(values: readonly number[], base: 36 | 62): BmsonValueKeyTable {
  const ownKeyByValue = new Map<number, string>();
  const keyByValue = new Map<number, string>();
  const table: Record<string, number> = {};
  const keys: string[] = [];
  for (const value of values) {
    let key = keyByValue.get(value);
    if (key === undefined) {
      const ownKey = encodeBmsonKey(ownKeyByValue.size + 1, base);
      if (ownKey !== undefined) {
        ownKeyByValue.set(value, ownKey);
        table[ownKey] = value;
        key = ownKey;
      } else {
        key = findNearestValueKey(ownKeyByValue, value) ?? '00';
      }
      keyByValue.set(value, key);
    }
    keys.push(key);
  }
  return { keys, table };
}

function findNearestValueKey(keyByValue: ReadonlyMap<number, string>, value: number): string | undefined {
  let nearestKey: string | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const [candidate, key] of keyByValue) {
    const distance = Math.abs(candidate - value);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestKey = key;
    }
  }
  return nearestKey;
}
