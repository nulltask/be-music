/**
 * The replay slots a chart or a course has (beatoraja's four replays per chart): which hold a replay, which the select
 * screen has picked, and how a result screen shows each one.
 */

/** How many replay slots a chart, or a course, has (beatoraja's `MusicSelector.REPLAY`). */
export const REPLAY_SLOT_COUNT = 4;

/**
 * A slot on a result screen, as beatoraja's `AbstractResult.ReplayStatus`: empty, holding a replay saved before, or
 * saved by this result.
 */
export type ReplaySlotState = 'none' | 'exists' | 'saved';

/**
 * The slot the select screen picks when the cursor lands on a bar (beatoraja's `RESET_REPLAY`): the first that holds a
 * replay, or `-1` when none does.
 */
export function firstReplaySlot(exists: readonly boolean[]): number {
  for (let slot = 0; slot < REPLAY_SLOT_COUNT; slot += 1) {
    if (exists[slot] === true) return slot;
  }
  return -1;
}

/**
 * The next (`step` 1) or previous (`step` −1) slot after `selected` that holds a replay, going round (beatoraja's
 * `NEXT_REPLAY` / `PREV_REPLAY`); `selected` itself when no other one does.
 */
export function stepReplaySlot(exists: readonly boolean[], selected: number, step: 1 | -1): number {
  for (let offset = 1; offset < REPLAY_SLOT_COUNT; offset += 1) {
    const slot = (((selected + step * offset) % REPLAY_SLOT_COUNT) + REPLAY_SLOT_COUNT) % REPLAY_SLOT_COUNT;
    if (exists[slot] === true) return slot;
  }
  return selected;
}
