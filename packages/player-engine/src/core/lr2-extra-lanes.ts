/** LR2 beta3's selected EXTRA level: automatic minimum, middle minimum, or highest. */
export type LR2ExtraLevel = 0 | 1 | 2;

/** MakeExtraChart 0x4ade2b..0x4ade69: raise the selected minimum using the pre-conversion object count. */
export function resolveLR2ExtraLevel(selected: LR2ExtraLevel, normalObjectCount: number): LR2ExtraLevel {
  if (selected === 2 || normalObjectCount >= (selected === 0 ? 1200 : 1000)) return 2;
  return selected === 1 || normalObjectCount >= 1000 ? 1 : 0;
}

/** Raw LR2 op/value, after LN decoding and before lane options. Sound ids use the original 36² table. */
export interface LR2ExtraLaneObject {
  op: number;
  value: number;
}

/**
 * MakeExtraChart 0x4ade6c..0x4ae13a: each sound prefers its most-used normal lane,
 * breaking ties toward the lowest lane. An unused sound inherits from the preceding
 * sound id only if its loader family was used on a normal lane. Families are the
 * loader's first-two-byte filename groups, supplied by the source adapter.
 *
 * DP scratch ops must already have become background ops, as in the executable's
 * first pass. The op 30 object contributes to its initial note count but has no
 * lane in this 20-cell table; LN tail ops 50..69 do not participate.
 */
export function resolveLR2ExtraSoundLanes(
  objects: readonly LR2ExtraLaneObject[],
  keyMode: 5 | 7 | 9 | 10 | 14,
  soundFamilies: readonly number[],
): number[] {
  const counts = new Map<number, number[]>();
  for (const { op, value } of objects) {
    if (op < 10 || op >= 30 || !Number.isInteger(value) || value < 0 || value >= 1296) continue;
    const lanes = counts.get(value) ?? Array<number>(20).fill(0);
    lanes[op - 10]!++;
    counts.set(value, lanes);
  }
  const preferred = Array<number>(1296).fill(-1);
  const usedFamilies = new Set<number>();
  for (let sound = 0; sound < 1296; sound++) {
    const lanes = counts.get(sound);
    if (!lanes) continue;
    let maximum = 0;
    for (let lane = 0; lane < 20; lane++) {
      if (lanes[lane]! <= maximum) continue;
      preferred[sound] = lane;
      maximum = lanes[lane]!;
      usedFamilies.add(soundFamilies[sound] ?? 0);
    }
  }
  for (let sound = 1; sound < 1296; sound++) {
    if (preferred[sound] !== -1 || !usedFamilies.has(soundFamilies[sound] ?? 0)) continue;
    const previous = preferred[sound - 1]!;
    if (previous < 1) {
      preferred[sound] = 7;
      continue;
    }
    const next =
      keyMode === 7 || keyMode === 14
        ? [3, 4, 5, 6, 7, 3, 2][previous - 1]
        : keyMode === 5 || keyMode === 10
          ? [3, 4, 5, 1, 2][previous - 1]
          : [3, 5, 7, 9, 2, 4, 6, 8, 1][previous - 1];
    if (next !== undefined) preferred[sound] = next;
  }
  return preferred;
}
