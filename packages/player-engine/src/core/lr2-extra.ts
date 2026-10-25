import {
  resolveLR2ExtraLevel,
  resolveLR2ExtraSoundLanes,
  type LR2ExtraLaneObject,
  type LR2ExtraLevel,
} from './lr2-extra-lanes.ts';

export interface LR2ExtraObject extends LR2ExtraLaneObject {
  /** LR2's realTiming, in playback milliseconds (already divided by the selected tempo). */
  timeMs: number;
  /** LR2's converted bmsTiming, used for its end-of-chart cutoff. */
  position: number;
}

/**
 * Executable-backed MakeExtraChart (beta3 100201, 0x4add90), after LN decoding.
 * Its caller has reset every head's endpoint to its start; tails remain op 50+.
 * Inputs retain their source indices; output ops are the actual conversion, not a
 * separately generated interpretation of the finished chart. No input is mutated.
 */
export function applyLR2Extra(
  source: readonly LR2ExtraObject[],
  options: {
    keyMode: 5 | 7 | 9 | 10 | 14;
    level: LR2ExtraLevel;
    initialBPM: number;
    soundFamilies: readonly number[];
  },
): { ops: number[]; level: LR2ExtraLevel; changes: number } {
  const objects = source.map((object, index) => ({ ...object, index }));
  // The original comparator truncates a nonzero time difference to a C int.
  objects.sort((a, b) => (a.timeMs === b.timeMs ? a.op - b.op : Math.trunc(a.timeMs - b.timeMs)));
  let normalObjectCount = 0;
  let endPosition = 0;
  let changes = 0;
  for (const object of objects) {
    if (object.op >= 10 && object.op <= 30) {
      normalObjectCount++;
      endPosition = object.position;
    }
    if (options.keyMode >= 10 && (object.op === 10 || object.op === 20)) {
      object.op = 1;
      changes++;
    }
  }
  const level = resolveLR2ExtraLevel(options.level, normalObjectCount);
  const soundLanes = resolveLR2ExtraSoundLanes(objects, options.keyMode, options.soundFamilies);
  let minimumGap =
    options.initialBPM > 0 ? Math.max(125, Math.trunc([60000, 45000, 30000][level]! / options.initialBPM)) : 125;
  const occupied = Array<number>(20).fill(0);
  let rowStart = 0;
  let rowTime = 0;
  let alternate = false;
  const isNormal = (op: number): boolean => op >= 10 && op < 30;
  const isFree = (lane: number): boolean => {
    // The beta3 DP search can address beyond this array into native stack locals.
    // Do not silently turn such a read into a different placement policy.
    // Slot 21 aliases the current fallback direction (0x4ae56c), always +1/-1.
    if (lane === 21) return false;
    if (lane < 0 || lane >= occupied.length) throw new RangeError('LR2 EXTRA addressed outside its native lane table.');
    return occupied[lane] === 0;
  };
  const place = (object: (typeof objects)[number], lane: number): void => {
    occupied[lane] = 2;
    object.op = lane + 10;
    changes++;
  };
  for (let index = 0; index < objects.length; index++) {
    const object = objects[index]!;
    if (object.timeMs === rowTime) {
      if (isNormal(object.op)) occupied[object.op - 10] = 2;
      if (object.op === 3 || object.op === 8) minimumGap = Math.max(125, Math.trunc(30000 / object.value));
    } else {
      // Only surrounding ordinary objects reserve neighbouring rows; LN ops and
      // hidden objects do not acquire an invented hold reservation.
      for (let previous = rowStart - 1; previous >= 0; previous--) {
        const note = objects[previous]!;
        if (rowTime - note.timeMs >= minimumGap) break;
        if (isNormal(note.op) && occupied[note.op - 10] === 0) occupied[note.op - 10] = 1;
      }
      for (let next = index; next < objects.length; next++) {
        const note = objects[next]!;
        if (note.timeMs - rowTime >= minimumGap) break;
        if (isNormal(note.op) && occupied[note.op - 10] === 0) occupied[note.op - 10] = 1;
      }
      for (let previous = rowStart; previous < index; previous++) {
        const background = objects[previous]!;
        if (background.op !== 1 || background.position < 0) continue;
        let lane = soundLanes[background.value] ?? -1;
        if (lane < 0 || lane >= 20) continue;
        if (options.keyMode === 10 || options.keyMode === 14) {
          lane = (lane % 10) + (alternate ? 0 : 10);
          alternate = !alternate;
        }
        if (isFree(lane) && lane % 10 <= options.keyMode % 10) {
          place(background, lane);
        } else if (lane !== 0 && lane !== 10) {
          const direction = background.value % 2 === 0 ? -1 : 1;
          if (options.keyMode < 10) {
            for (let distance = 1; distance <= options.keyMode; distance++) {
              const next = lane + distance * direction,
                previous = lane - distance * direction;
              if (next >= 1 && next <= options.keyMode && isFree(next)) {
                place(background, next);
                break;
              }
              if (previous >= 1 && previous <= options.keyMode && isFree(previous)) {
                place(background, previous);
                break;
              }
            }
          } else {
            for (let distance = 1; distance <= options.keyMode / 2; distance++) {
              const gap = distance * direction;
              const candidates = [lane + gap, lane - gap];
              lane += lane <= 10 ? 10 : -10;
              candidates.push(lane + gap, lane - gap);
              const available = candidates.find(
                (candidate) => candidate % 10 >= 1 && candidate % 10 <= options.keyMode / 2 && isFree(candidate),
              );
              if (available !== undefined) {
                place(background, available);
                break;
              }
            }
          }
        }
      }
      occupied.fill(0);
      rowTime = object.timeMs;
      rowStart = index;
    }
    // No final row flush: the original only converts a row when it encounters
    // another timestamp, and stops after the first object beyond the last tap.
    if (object.position > endPosition) break;
  }
  const ops = Array<number>(source.length);
  for (const object of objects) ops[object.index] = object.op;
  return { ops, level, changes };
}
