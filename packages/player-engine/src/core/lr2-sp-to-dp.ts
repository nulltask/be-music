/** LR2's post-decoder object; heads keep their hold endpoint in the caller, while tails use op 50+. */
export interface LR2SplitObject {
  op: number;
  value: number;
  timeMs: number;
}

interface SoundSide {
  id: number;
  count: number;
  side: -1 | 0 | 1;
}

/**
 * LR2 beta3 SPtoDP (0x4b0250), DPsplit, DPsplitLane and DPsplitLaneScratch.
 * Consume the native order, including op-2 measure markers and non-note rows.
 * Loader families, playback time and the source assists are explicit inputs.
 * Return one op per input object; no random draw, duplication or input mutation.
 */
export function splitLR2SPToDP(
  source: readonly LR2SplitObject[],
  options: { soundFamilies: readonly number[]; playLevel: number; assist1P?: boolean; assist2P?: boolean },
): number[] {
  const objects = source.map((object) => ({ ...object }));
  let previous: SoundSide[] = Array.from({ length: 1296 }, (_, id) => ({ id, count: 0, side: -1 }));
  let repeat = 0;
  let firstSide: 0 | 1 = 0;
  let alternatingSide: 0 | 1 = 0;
  let scratchSide: 0 | 1 = 0;
  const family = (object: LR2SplitObject): number => options.soundFamilies[object.value] ?? 0;
  const key = (op: number): boolean => (op >= 11 && op <= 17) || (op >= 21 && op <= 27);
  const compare = (a: SoundSide, b: SoundSide): number => b.count - a.count || a.id - b.id;
  for (let marker = 0; marker < objects.length; marker++) {
    if (objects[marker]!.op !== 2) continue;
    const start = marker + 1;
    let end = start;
    while (end < objects.length && objects[end]!.op !== 2) end++;
    const counts = Array<number>(8).fill(0);
    const current: SoundSide[] = Array.from({ length: 1296 }, (_, id) => ({ id, count: 0, side: -1 }));
    for (let index = start; index < end; index++) {
      const object = objects[index]!;
      if (object.op < 10 || object.op > 17) continue;
      counts[object.op - 10]!++;
      if (object.op === 10) continue;
      const sound = current[family(object)]!;
      sound.count++;
      sound.side = 0;
    }
    current.sort(compare);
    const a = current[0]!,
      b = current[1]!,
      c = current[2]!;
    const p = previous[0]!,
      q = previous[1]!,
      r = previous[2]!;
    const continuing =
      p.count > 0 &&
      a.count > 0 &&
      ((a.id === p.id && (b.id === q.id || b.id === r.id || c.id === q.id || c.id === r.id)) ||
        (a.id === q.id && b.id === p.id) ||
        (b.id === p.id && q.id === 0));
    repeat = continuing ? repeat + 1 : 0;
    if (repeat === 4) {
      for (const sound of previous) if (sound.side !== -1) sound.side = sound.side === 0 ? 1 : 0;
      repeat = 0;
    }
    const previousById = new Map(previous.map((sound) => [sound.id, sound]));
    const load = [0, 0];
    for (const [index, sound] of current.entries()) {
      if (sound.count === 0) continue;
      const old = previousById.get(sound.id)!;
      if (continuing && old.side !== -1 && index === 0) {
        sound.side = old.side;
      } else if (load[0] === 0 && load[1] === 0) {
        sound.side = firstSide;
        firstSide = firstSide === 0 ? 1 : 0;
      } else sound.side = load[1]! < load[0]! ? 1 : 0;
      load[sound.side]! += sound.count;
    }
    // The next measure remembers the family assignment BEFORE dense/mono/scratch corrections.
    previous = current.map((sound) => ({ ...sound }));
    const currentById = new Map(current.map((sound) => [sound.id, sound]));
    for (let index = start; index < end; index++) {
      const object = objects[index]!;
      if (object.op >= 11 && object.op <= 17 && currentById.get(family(object))!.side === 1) object.op += 10;
    }
    const dominant = current[0]!;
    if (
      dominant.count >= 17 ||
      (dominant.count >= 16 && options.playLevel <= 10) ||
      (dominant.count >= 14 && options.playLevel <= 9) ||
      (dominant.count >= 12 && options.playLevel <= 8)
    ) {
      const lanes = new Set<number>();
      for (let index = start; index < end; index++) {
        const object = objects[index]!;
        if (key(object.op) && family(object) === dominant.id) lanes.add(object.op % 10);
      }
      if (lanes.size > 3) {
        for (let index = start; index < end; index++) {
          const object = objects[index]!;
          if (!key(object.op)) continue;
          object.op = 10 + (object.op % 10);
          if (family(object) === dominant.id) {
            object.op += alternatingSide * 10;
            alternatingSide = alternatingSide === 0 ? 1 : 0;
          }
        }
      }
    }
    let left = 0,
      right = 0,
      scratches = 0;
    for (let index = start; index < end; index++) {
      const op = objects[index]!.op;
      if (op >= 11 && op <= 17) left++;
      else if (op >= 21 && op <= 27) right++;
      else if (op === 10) scratches++;
    }
    if ((left > 0 && right === 0) || (left === 0 && right > 0)) {
      const lanes = new Set<number>();
      let total = 0;
      for (let index = start; index < end; index++) {
        const object = objects[index]!;
        if (object.op >= 21 && object.op <= 27) object.op -= 10;
        if (object.op >= 11 && object.op <= 17) {
          lanes.add(object.op - 10);
          total++;
        }
      }
      if (lanes.size >= 4 || total === 1) {
        for (let index = start; index < end; index++) {
          const object = objects[index]!;
          if (object.op < 11 || object.op > 17) continue;
          object.op += alternatingSide * 10;
          alternatingSide = alternatingSide === 0 ? 1 : 0;
        }
        repeat = 0;
      } else if (lanes.size === 2 || lanes.size === 3) {
        // RightLaneTo2P and Move3rdLaneTo2P both move the highest used lane here.
        let last = 0;
        for (let lane = 1; lane <= 7; lane++) if (counts[lane]! > 0) last = lane;
        for (let index = start; index < end; index++) if (objects[index]!.op === 10 + last) objects[index]!.op += 10;
        if (lanes.size === 2) repeat = 0;
      }
    }
    let lastTime = -1,
      lastScratchTime = -1;
    let pending = -1,
      oldPending = -1;
    // Visiting the following measure marker flushes a pending scratch. There is
    // no invented end-of-array flush when the native stream has no next marker.
    for (let index = start; index < objects.length; index++) {
      const object = objects[index]!;
      if (object.timeMs > lastTime) {
        lastTime = object.timeMs;
        if (pending !== -1) {
          const scratch = objects[pending]!;
          if (lastScratchTime + 500 < scratch.timeMs && (scratches <= 3 || lastScratchTime === -1))
            scratchSide = scratchSide === 0 ? 1 : 0;
          lastScratchTime = scratch.timeMs;
          if (scratchSide === 1) scratch.op += 10;
          if (!(scratchSide === 0 ? options.assist1P : options.assist2P)) {
            const move = (note: LR2SplitObject): void => {
              if (scratchSide === 0 && note.op >= 12 && note.op <= 17) note.op += 10;
              else if (scratchSide === 1 && note.op >= 21 && note.op <= 26) note.op -= 10;
            };
            for (let previous = pending; previous > 0; previous--) {
              const note = objects[previous]!;
              if (note.op === 2 || scratch.timeMs - note.timeMs >= 200) break;
              move(note);
            }
            for (let next = pending; next < objects.length; next++) {
              const note = objects[next]!;
              if (note.op === 2 || note.timeMs - scratch.timeMs >= 200) break;
              move(note);
            }
          }
          pending = -1;
          oldPending = -1;
        }
      }
      if (object.op === 2) break;
      if (object.op === 10) pending = oldPending = index;
      if (key(object.op)) pending = oldPending;
    }
  }
  return objects.map((object) => object.op);
}
