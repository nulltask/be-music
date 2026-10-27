import type { LR2SplitObject } from './lr2-sp-to-dp.ts';

/** A native object for the merges: its chart position decides "the same row", and a PMS mine cannot become BGM. */
export interface LR2MergeObject extends LR2SplitObject {
  position: number;
  mine?: boolean;
}

/**
 * LR2 beta3 SP TO DP on a double-play or nine-key chart: DPtoSP (0x4ae8d0) merges a 10/14KEY chart onto the 1P side
 * and PMStoSP (0x4af080) folds a 9KEY chart onto seven keys, as reconstructed by OpenLR2 (583a3850, `LR2f.cpp`
 * L25091-L25450). Both consume the native object order after LN pairing (a hold's head carries its end; tails are
 * op 50+ and stay put) and return one op per object: a lane op, `1` for a note moved to the background, or `-1` for a
 * PMS mine that could not move (dropped).
 */

/** The minimum gap a merged note keeps from a note on its lane: half a beat at the current BPM, at least 125 ms. */
function minimumGap(bpm: number): number {
  return bpm <= 0 || Math.trunc(30000 / bpm) < 125 ? 125 : Math.trunc(30000 / bpm);
}

/** DPtoSP: each 2P object moves to its 1P lane, or the nearest free one, or to the background. */
export function mergeLR2DPToSP(
  source: readonly LR2MergeObject[],
  options: { initialBPM: number; keymode: 10 | 14 },
): number[] {
  const objects = source.map((object) => ({ ...object }));
  const highest = options.keymode / 2 + 10;
  let mingap = minimumGap(options.initialBPM);
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i]!;
    const op = object.op;
    if (op === 3 || op === 8) {
      mingap = Math.max(125, Math.trunc(30000 / object.value));
      continue;
    }
    if (op < 20 || op > 29) continue;
    const newop = op - 10;
    let sameLane = false;
    let sameTime = false;
    const occupied = Array<boolean>(10).fill(false);
    const scan = (other: LR2MergeObject): void => {
      if (other.op >= 10 && other.op <= 19) occupied[other.op - 10] = true;
      if (other.op === newop) {
        sameLane = true;
        if (other.position === object.position) sameTime = true;
      }
    };
    for (let prev = i - 1; prev >= 0; prev--) {
      scan(objects[prev]!);
      if (object.timeMs - objects[prev]!.timeMs >= mingap) break;
    }
    for (let next = i + 1; next < objects.length; next++) {
      scan(objects[next]!);
      if (objects[next]!.timeMs - object.timeMs >= mingap) break;
    }
    if (op === 20) {
      if (!sameTime) object.op = op - 10;
    } else if (!sameLane) {
      object.op = op - 10;
    } else {
      for (let j = 1; j < 8; j++) {
        // The source keeps these conditions apart: a lane above in range is the only candidate when it is in range.
        if (newop + j >= 11 && newop + j <= highest) {
          if (!occupied[newop + j - 10]) {
            object.op = newop + j;
            break;
          }
        } else if (newop - j >= 11 && newop - j <= highest && !occupied[newop - j - 10]) {
          object.op = newop - j;
          break;
        }
      }
    }
    if (object.op >= 20 && object.op <= 29) object.op = 1;
  }
  return objects.map((object) => object.op);
}

/** PMStoSP: each measure's nine lanes are shifted or compacted onto seven, lanes 8 and 9 moved into gaps. */
export function mergeLR2PMSToSP(source: readonly LR2MergeObject[], options: { initialBPM: number }): number[] {
  const objects = source.map((object) => ({ ...object, mine: object.mine === true }));
  let mingap = minimumGap(options.initialBPM);
  let prev = 0;
  let left = 9;
  let right = 1;
  let measureLaneCount = 0;
  let used = Array<boolean>(10).fill(false);
  const shift = (from: number, to: number, predicate: (op: number) => boolean, delta: number): void => {
    for (let j = from; j < to; j++) if (predicate(objects[j]!.op)) objects[j]!.op += delta;
  };
  for (let i = 0; i < objects.length; i++) {
    const op = objects[i]!.op;
    if (op === 3 || op === 8) {
      mingap = Math.max(125, Math.trunc(30000 / objects[i]!.value));
    } else if (op === 2 && measureLaneCount > 0) {
      const count = used.filter((lane, index) => index >= 1 && index <= 9 && lane).length;
      const firstEmpty = (from: number, to: number): number => {
        for (let lane = from; lane < to; lane++) if (!used[lane]) return lane;
        throw new RangeError('PMS TO SP found no empty lane.');
      };
      if (right <= 7) {
        // Nothing to fold.
      } else if (right === 8 && left >= 2) {
        shift(prev, i, (value) => value >= 12 && value <= 19, -1);
      } else if (right === 9 && left >= 3) {
        shift(prev, i, (value) => value >= 13 && value <= 19, -2);
      } else if (right === 9 && left === 2 && count <= 7) {
        const empty = firstEmpty(2, 9);
        shift(prev, i, (value) => empty + 10 < value && value <= 19, -1);
        shift(prev, i, (value) => value >= 11 && value <= 19, -1);
      } else if (left === 1 && count <= 7) {
        if (right === 8) {
          const empty = firstEmpty(1, 9);
          shift(prev, i, (value) => 10 + empty < value && value <= 19, -1);
        } else {
          const emptyLeft = firstEmpty(1, 9);
          let emptyRight = -1;
          for (let lane = 9; lane > 1; lane--)
            if (!used[lane]) {
              emptyRight = lane;
              break;
            }
          shift(prev, i, (value) => emptyLeft + 10 < value && value <= 19, -1);
          shift(prev, i, (value) => emptyRight + 9 < value && value <= 19, -1);
        }
      } else {
        if (left === 2) shift(prev, i, (value) => value >= 12 && value <= 19, -1);
        for (let j = prev; j < i; j++) {
          const object = objects[j]!;
          if (object.op !== 18 && object.op !== 19) continue;
          const newLane = 14 + (object.op - 18);
          let sameLane = false;
          const occupied = Array<boolean>(10).fill(false);
          const scan = (other: LR2MergeObject): void => {
            if (other.op >= 10 && other.op <= 19) occupied[other.op - 10] = true;
            if (other.op === newLane) sameLane = true;
          };
          for (let x = j - 1; x >= 0; x--) {
            scan(objects[x]!);
            if (object.timeMs - objects[x]!.timeMs >= mingap) break;
          }
          for (let next = j + 1; next < objects.length; next++) {
            scan(objects[next]!);
            if (objects[next]!.timeMs - object.timeMs >= mingap) break;
          }
          if (!sameLane) object.op = newLane;
          else {
            // Every other lane first, then the lanes between; the source's own search.
            let moved = false;
            for (let k = 1; k < 5 && !moved; k++) {
              let lane = newLane + k * 2;
              if (lane >= 11 && lane <= 17) {
                if (!occupied[lane - 10]) {
                  object.op = lane;
                  moved = true;
                }
              } else {
                lane = newLane - k * 2;
                if (lane >= 11 && lane <= 17 && !occupied[lane - 10]) {
                  object.op = lane;
                  moved = true;
                }
              }
            }
            for (let k = 1; k < 5 && !moved; k++) {
              let lane = newLane + k * 2 - 1;
              if (lane >= 11 && lane <= 17) {
                if (!occupied[lane - 10]) {
                  object.op = lane;
                  moved = true;
                }
              } else {
                lane = newLane - k * 2 + 1;
                if (lane >= 11 && lane <= 17 && !occupied[lane - 10]) {
                  object.op = lane;
                  moved = true;
                }
              }
            }
          }
          if (object.op === 18 || object.op === 19) object.op = object.mine ? -1 : 1;
        }
      }
      measureLaneCount = 0;
      prev = i;
      left = 9;
      right = 1;
      used = Array<boolean>(10).fill(false);
    } else if (op === 2) {
      left = 9;
      right = 1;
      prev = i;
      used = Array<boolean>(10).fill(false);
    } else if (op >= 11 && op <= 19) {
      used[op - 10] = true;
      measureLaneCount++;
      left = Math.min(left, op - 10);
      right = Math.max(right, op - 10);
    }
  }
  return objects.map((object) => object.op);
}
