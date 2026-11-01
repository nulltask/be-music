// The replay ghost's play option (`Ghost: OFF / Own best`, the Debug Menu's play options) and its source: the replay of
// the player's own best on the chart, read from the replay slots (the slot keeping the highest EX score, which the
// default auto-save rule of slot 1 keeps up to date). Whether a play can show one is worked out here, so the Debug Menu
// greys the option out where it would do nothing and the play route asks for a ghost only where it shows.

import type { GhostSource } from '@be-music/player-browser/host';
import type { ChartPlayVariant } from '@be-music/chart-model';
import type { ReplaySlotList, ReplaySlotRecord, ReplaySlotStore, ReplaySlotTarget } from './replay-slots.ts';

/** The ghost play option: none, or the player's own best on the chart. */
export const GHOST_MODES = ['OFF', 'OWN_BEST'] as const;
export type GhostMode = (typeof GHOST_MODES)[number];

/** The play variants a ghost field has room beside: the single-play 5 / 7 KEY charts, whose 2P side it takes. */
const GHOST_PLAY_VARIANTS: ReadonlySet<ChartPlayVariant> = new Set(['5', '7']);

/** What decides whether a play can show a ghost. */
export interface GhostAvailabilityInput {
  /** The family drawing the play: only the built-in one has a second field to draw it in. */
  readonly family: 'built-in' | 'lr2' | 'beatoraja';
  /** The chart's play variant; absent for a course bar or a folder. */
  readonly playVariant?: ChartPlayVariant;
  /** A replay plays back instead of the player. */
  readonly replay?: boolean;
  /** A course stage or a NONSTOP run. */
  readonly course?: boolean;
  /** A battle mode (LR2 BATTLE, SP TO DP, ...) other than OFF: the chart becomes a double-play one. */
  readonly battle?: boolean;
  /** Whether a replay of the player's best on the chart is kept. */
  readonly hasBestReplay: boolean;
}

/** Why a play cannot show a ghost; `undefined` when it can. */
export type GhostUnavailableReason = 'family' | 'replay' | 'course' | 'chart' | 'no-replay';

/** Why a play described by `input` cannot show a ghost, or `undefined` when it can. */
export function resolveGhostUnavailableReason(input: GhostAvailabilityInput): GhostUnavailableReason | undefined {
  if (input.family !== 'built-in') return 'family';
  if (input.replay === true) return 'replay';
  if (input.course === true) return 'course';
  if (input.battle === true || input.playVariant === undefined || !GHOST_PLAY_VARIANTS.has(input.playVariant))
    return 'chart';
  if (!input.hasBestReplay) return 'no-replay';
  return undefined;
}

/** The slot keeping the player's best: the highest EX score, the latest save among equals; `undefined` when empty. */
export function selectOwnBestReplaySlot(slots: ReplaySlotList): ReplaySlotRecord | undefined {
  let best: ReplaySlotRecord | undefined;
  for (const record of slots) {
    if (record === undefined || record.target.kind !== 'chart') continue;
    if (
      best === undefined ||
      record.exScore > best.exScore ||
      (record.exScore === best.exScore && record.savedAt > best.savedAt)
    )
      best = record;
  }
  return best;
}

/** The ghost source of the player's own best on the chart `target` names, read from `store` when the play loads. */
export function createOwnBestGhostSource(
  store: Pick<ReplaySlotStore, 'slots' | 'read'>,
  target: ReplaySlotTarget,
): GhostSource {
  return {
    kind: 'own-best',
    async load() {
      const best = selectOwnBestReplaySlot(store.slots(target));
      if (best === undefined) return undefined;
      const payload = await store.read(target, best.slot);
      return payload?.kind === 'chart' ? payload.replay : undefined;
    },
  };
}
