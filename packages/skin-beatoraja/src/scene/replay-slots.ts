import type { ReplaySlotState } from '@be-music/player-scene-model';
import { BEATORAJA_BUTTON, BEATORAJA_REPLAY_SLOT_OP } from '../runtime-ids.ts';

/** The replay buttons, by slot: `replay1`-`replay4` of beatoraja's `EventFactory` (19, 316-318). */
const REPLAY_BUTTONS: readonly number[] = [
  BEATORAJA_BUTTON.REPLAY,
  BEATORAJA_BUTTON.REPLAY2,
  BEATORAJA_BUTTON.REPLAY3,
  BEATORAJA_BUTTON.REPLAY4,
];

/**
 * The replay slot (0-3) a skin button names: on the select screen it plays that slot, on a result screen it saves into
 * it (beatoraja's `getReplayEventConsumer`). `undefined` for any other button.
 */
export function beatorajaReplayButtonSlot(act: number): number | undefined {
  const slot = REPLAY_BUTTONS.indexOf(act);
  return slot >= 0 ? slot : undefined;
}

/**
 * The ops a result screen lights for its replay slots (beatoraja's `createReplayProperty` on an `AbstractResult`): one
 * of none / exists / saved per slot.
 */
export function resolveBeatorajaResultReplayOps(slots: readonly ReplaySlotState[]): number[] {
  const ops: number[] = [];
  slots.slice(0, 4).forEach((state, slot) => ops.push(BEATORAJA_REPLAY_SLOT_OP[state][slot]!));
  return ops;
}

/**
 * The ops the select screen lights for a chart or course bar's replay slots (beatoraja's `createReplayProperty` on a
 * `SelectableBar`): none or exists per slot, and the slot picked for REPLAY (`OPTION_SELECT_REPLAYDATA`, none when
 * `selected` is −1).
 */
export function resolveBeatorajaSelectReplayOps(exists: readonly boolean[], selected: number): number[] {
  const ops: number[] = [];
  for (let slot = 0; slot < 4; slot += 1) {
    ops.push((exists[slot] === true ? BEATORAJA_REPLAY_SLOT_OP.exists : BEATORAJA_REPLAY_SLOT_OP.none)[slot]!);
  }
  const picked = BEATORAJA_REPLAY_SLOT_OP.selected[selected];
  if (picked !== undefined) ops.push(picked);
  return ops;
}
