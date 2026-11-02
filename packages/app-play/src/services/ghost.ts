// The replay ghost's play options (the Debug Menu's Replay / ghost folder) and its sources. "Ghost" picks the replay a
// ghost plays: none (OFF), the player's own best on the chart (the replay slot keeping the highest EX score, which the
// default auto-save rule of slot 1 keeps up to date), one replay slot, the Leaderboard's top run on the chart, or a
// replay file the player picked. "Ghost mode" picks how it shows: a second playfield, a pacemaker alone, or a pacemaker
// with the recorded inputs over the player's own lanes. Whether a play can show the pick is worked out here, so the
// Debug Menu can say why not, and the play route asks for a ghost only where it shows.

import type { GhostPresentationMode, GhostSource } from '@be-music/player-browser/host';
import type { ChartPlayVariant } from '@be-music/chart-model';
import type { BeMusicReplay } from '@be-music/player-engine/replay';
import {
  replaySlotTargetOfReplay,
  type ReplaySlotList,
  type ReplaySlotRecord,
  type ReplaySlotStore,
  type ReplaySlotTarget,
} from './replay-slots.ts';

/** The "Ghost" option: which replay a ghost plays, or none. */
export const GHOST_SOURCES = [
  'OFF',
  'OWN_BEST',
  'REPLAY_SLOT_1',
  'REPLAY_SLOT_2',
  'REPLAY_SLOT_3',
  'REPLAY_SLOT_4',
  'LEADERBOARD_TOP',
  'REPLAY_FILE',
] as const;
export type GhostSourceSetting = (typeof GHOST_SOURCES)[number];

/** The "Ghost mode" option: how the ghost shows (see `GhostPresentationMode`). */
export const GHOST_MODES = ['PLAYFIELD', 'PACEMAKER', 'LANE_OVERLAY'] as const;
export type GhostModeSetting = (typeof GHOST_MODES)[number];

const PRESENTATION_MODES: Readonly<Record<GhostModeSetting, GhostPresentationMode>> = {
  PLAYFIELD: 'side-playfield',
  PACEMAKER: 'pacemaker',
  LANE_OVERLAY: 'lane-overlay',
};

/** The play session's presentation mode for a "Ghost mode" setting. */
export function toGhostPresentationMode(mode: GhostModeSetting): GhostPresentationMode {
  return PRESENTATION_MODES[mode];
}

/** The replay slot (0-based) a "Ghost" setting names, or `undefined` for another source. */
export function ghostReplaySlotOf(source: GhostSourceSetting): number | undefined {
  const match = /^REPLAY_SLOT_(\d)$/.exec(source);
  return match === null ? undefined : Number(match[1]) - 1;
}

/** Whether a mode draws a field of its own, which only the built-in family has room for. */
export function ghostModeDrawsOnPlayfield(mode: GhostModeSetting): boolean {
  return mode !== 'PACEMAKER';
}

/** The play variants a second playfield has room beside: the single-play 5 / 7 KEY charts, whose 2P side it takes. */
const SIDE_PLAYFIELD_VARIANTS: ReadonlySet<ChartPlayVariant> = new Set(['5', '7']);

/** What decides whether a play can show the picked ghost. */
export interface GhostAvailabilityInput {
  /** How the ghost would show. */
  readonly mode: GhostModeSetting;
  /** The family drawing the play: only the built-in one has room for a field of the ghost's own. */
  readonly family: 'built-in' | 'lr2' | 'beatoraja';
  /** The chart's play variant; absent for a course bar or a folder. */
  readonly playVariant?: ChartPlayVariant;
  /** A replay plays back instead of the player. */
  readonly replay?: boolean;
  /** A course stage or a NONSTOP run. */
  readonly course?: boolean;
  /** A battle mode (LR2 BATTLE, SP TO DP, ...) other than OFF: the chart becomes a double-play one. */
  readonly battle?: boolean;
  /** Whether the picked source holds a replay of the chart; `undefined` when that is only known once read. */
  readonly hasReplay?: boolean;
}

/** Why a play cannot show the picked ghost; `undefined` when it can. */
export type GhostUnavailableReason = 'family' | 'replay' | 'course' | 'chart' | 'no-replay';

/** Why a play described by `input` cannot show the picked ghost, or `undefined` when it can. */
export function resolveGhostUnavailableReason(input: GhostAvailabilityInput): GhostUnavailableReason | undefined {
  if (input.family !== 'built-in' && ghostModeDrawsOnPlayfield(input.mode)) return 'family';
  if (input.replay === true) return 'replay';
  if (input.course === true) return 'course';
  if (input.playVariant === undefined) return 'chart';
  if (input.mode === 'PLAYFIELD' && (input.battle === true || !SIDE_PLAYFIELD_VARIANTS.has(input.playVariant)))
    return 'chart';
  if (input.hasReplay === false) return 'no-replay';
  return undefined;
}

/** What the Debug Menu says of a ghost the bar under the cursor cannot show. */
export const GHOST_UNAVAILABLE_LABELS: Readonly<Record<GhostUnavailableReason, string>> = {
  family: 'Built-in skins only',
  replay: 'Not in a replay',
  course: 'Not on a course',
  chart: 'Not on this chart',
  'no-replay': 'No replay kept',
};

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
    label: 'MY GHOST',
    async load() {
      const best = selectOwnBestReplaySlot(store.slots(target));
      if (best === undefined) return undefined;
      const payload = await store.read(target, best.slot);
      return payload?.kind === 'chart' ? payload.replay : undefined;
    },
  };
}

/** The ghost source of replay slot `slot` (0-based) of the chart `target` names. */
export function createReplaySlotGhostSource(
  store: Pick<ReplaySlotStore, 'read'>,
  target: ReplaySlotTarget,
  slot: number,
): GhostSource {
  return {
    kind: 'replay-slot',
    label: `SLOT ${slot + 1}`,
    async load() {
      const payload = await store.read(target, slot);
      return payload?.kind === 'chart' ? payload.replay : undefined;
    },
  };
}

/** The ghost source of the Leaderboard's top run on the chart, fetched by `fetchTopReplay` when the play loads. */
export function createLeaderboardGhostSource(fetchTopReplay: () => Promise<BeMusicReplay | undefined>): GhostSource {
  return { kind: 'leaderboard', label: 'TOP', load: fetchTopReplay };
}

/**
 * The replay file the player picked as a ghost (Debug Menu → Replay / ghost → "Ghost replay file…"), held for this
 * visit only. It is the ghost of the chart it was recorded on, wherever "Ghost" is REPLAY FILE.
 */
export class GhostReplayFile {
  private picked: { readonly replay: BeMusicReplay; readonly name: string; readonly target?: string } | undefined;

  /** The picked file's name, for the menu; `undefined` before one is picked. */
  public get name(): string | undefined {
    return this.picked?.name;
  }

  public set(replay: BeMusicReplay, name: string): void {
    const target = replaySlotTargetOfReplay(replay)?.id;
    this.picked = { replay, name, ...(target !== undefined ? { target } : {}) };
  }

  public clear(): void {
    this.picked = undefined;
  }

  /** The picked replay when it was recorded on the chart `target` names. */
  public replayFor(target: ReplaySlotTarget | undefined): BeMusicReplay | undefined {
    if (this.picked === undefined || target === undefined || this.picked.target !== target.id) return undefined;
    return this.picked.replay;
  }
}

/** The ghost source of the picked replay file, for the chart `target` names. */
export function createReplayFileGhostSource(
  file: Pick<GhostReplayFile, 'replayFor'>,
  target: ReplaySlotTarget,
): GhostSource {
  return { kind: 'replay-file', label: 'FILE', load: () => Promise.resolve(file.replayFor(target)) };
}

/** Where the ghost sources read from. */
export interface GhostSourceDeps {
  /** The replay slots the own best and a slot are read from. */
  readonly replays?: Pick<ReplaySlotStore, 'slots' | 'read'>;
  /** Fetches the Leaderboard's top run on a chart, by its chart fingerprint. */
  readonly fetchLeaderboardTopReplay?: (chartFingerprint: string) => Promise<BeMusicReplay | undefined>;
  /** The picked replay file. */
  readonly replayFile?: Pick<GhostReplayFile, 'replayFor'>;
}

/** The ghost source a "Ghost" setting names for the chart `target` names, or `undefined` when there is none to read. */
export function createGhostSource(
  setting: GhostSourceSetting,
  target: ReplaySlotTarget,
  deps: GhostSourceDeps,
): GhostSource | undefined {
  if (setting === 'OFF') return undefined;
  if (setting === 'OWN_BEST') return deps.replays && createOwnBestGhostSource(deps.replays, target);
  const slot = ghostReplaySlotOf(setting);
  if (slot !== undefined) return deps.replays && createReplaySlotGhostSource(deps.replays, target, slot);
  if (setting === 'REPLAY_FILE') return deps.replayFile && createReplayFileGhostSource(deps.replayFile, target);
  // The Leaderboard keys charts by their chart fingerprint; a chart with only a file hash is not on it.
  const fetchTop = deps.fetchLeaderboardTopReplay;
  if (fetchTop === undefined || target.id.startsWith('sha256:')) return undefined;
  return createLeaderboardGhostSource(() => fetchTop(target.id));
}

/**
 * Whether the source a "Ghost" setting names holds a replay of the chart, as far as is known without reading it:
 * `exists` lists which replay slots of the chart are kept. A Leaderboard run is only known once fetched (`undefined`).
 */
export function ghostSourceHasReplay(
  setting: Exclude<GhostSourceSetting, 'OFF'>,
  exists: readonly boolean[],
  replayFile: boolean,
): boolean | undefined {
  if (setting === 'OWN_BEST') return exists.some(Boolean);
  const slot = ghostReplaySlotOf(setting);
  if (slot !== undefined) return exists[slot] === true;
  if (setting === 'REPLAY_FILE') return replayFile;
  return undefined;
}

/** What the select screen knows of the bar under the cursor, for whether a ghost would show on it. */
export interface GhostBarFacts extends Omit<GhostAvailabilityInput, 'mode' | 'hasReplay'> {
  /** The bar's chart as the replay slots and the ghost sources name it; absent for a course or a folder. */
  readonly target?: ReplaySlotTarget;
  /** Which replay slots of the chart are kept. */
  readonly slotsKept: readonly boolean[];
}

/**
 * What the Debug Menu's "Ghost status" row says for the picked source and mode on the bar `facts` describe: `OFF`, why
 * the bar would show no ghost, or `READY` (a Leaderboard run is only known once fetched, so it reads `READY` too).
 */
export function resolveGhostStatus(
  source: GhostSourceSetting,
  mode: GhostModeSetting,
  facts: GhostBarFacts | undefined,
  replayFile: Pick<GhostReplayFile, 'replayFor'>,
): string {
  if (source === 'OFF') return 'OFF';
  if (facts === undefined) return '-';
  const hasReplay = ghostSourceHasReplay(source, facts.slotsKept, replayFile.replayFor(facts.target) !== undefined);
  const reason = resolveGhostUnavailableReason({
    ...facts,
    mode,
    ...(hasReplay !== undefined ? { hasReplay } : {}),
  });
  return reason === undefined ? 'READY' : GHOST_UNAVAILABLE_LABELS[reason];
}
