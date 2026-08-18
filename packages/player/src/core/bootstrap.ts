import { throwIfAborted } from '@be-music/utils/core';
import { normalizeChannel, type BeMusicJson } from '@be-music/json';
import { type GrooveGaugeJudgeKind } from './groove-gauge.ts';
import {
  GAUGE_JUDGE_BAD,
  GAUGE_JUDGE_EMPTY_POOR,
  GAUGE_JUDGE_GOOD,
  GAUGE_JUDGE_GREAT,
  GAUGE_JUDGE_MISS_POOR,
  GAUGE_JUDGE_PGREAT,
  RulesetGauge,
  type GaugeJudgeIndex,
  type RulesetConfig,
} from '../ruleset/index.ts';
import { type PlayerUiSignalBus } from './ui-signal-bus.ts';
import type {
  CreatePlayerUiRuntimeContext,
  PlayerGrooveGaugeSummary,
  PlayerOptions,
  PlayerSummary,
  PlayerUiRuntime,
} from './engine.ts';
import { extractTimedNotes, type TimedLandmineNote, type TimedPlayableNote } from '../playable-notes.ts';
import {
  appendFreeZoneInputChannels,
  createInputTokenToChannelsMap,
  createLaneBindings,
  resolveLaneDisplayMode,
  type LaneBinding,
} from './lane-layout.ts';
import { DEFAULT_IMAGE_RESIZE_ALGORITHM } from '../image-resize-algorithm.ts';
import { type PlayerStateSignals } from '../state-signals.ts';
import { DEFAULT_TUI_NOTE_HEIGHT } from './ui-options.ts';

/**
 * Browser-safe default for `audioBaseDir`. Browsers don't have `process.cwd()`, so a bare reference there
 * `ReferenceError`s the moment any web caller leaves `audioBaseDir` undefined. Falls back to `'.'` (the
 * conventional CWD shorthand). The asset-resolution path below then joins `'.'` against the chart-relative
 * resource paths, which yields the same string the browser caller would have passed; the actual asset bytes
 * land via the asset-source closure inside the host (drag-dropped File handles), not via Node fs reads, so the
 * `baseDir` field is essentially a label here.
 */
function resolveDefaultBaseDir(): string {
  const proc = (globalThis as { process?: { cwd?: () => string } }).process;
  return proc?.cwd?.() ?? '.';
}

export interface PreparedPlaybackChartData {
  notes: TimedPlayableNote[];
  laneSoundNotes: TimedPlayableNote[];
  landmineNotes: TimedLandmineNote[];
  invisibleNotes: TimedPlayableNote[];
  renderNotes: TimedPlayableNote[];
  totalSeconds: number;
  laneBindings: LaneBinding[];
  laneDisplayMode: string;
  activeFreeZoneChannels: ReadonlySet<string>;
  scorableNotes: TimedPlayableNote[];
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>;
}

export interface InitializedPlayerUiRuntime {
  uiRuntime: PlayerUiRuntime | undefined;
  totalSeconds: number;
  uiEnabled: boolean;
  activeStateSignals: PlayerStateSignals | undefined;
}

export function createInitialPlayerSummary(
  ruleset: RulesetConfig,
  totalNotes: number,
): {
  summary: PlayerSummary;
  applyGaugeJudge: (judge: GrooveGaugeJudgeKind) => void;
  applyGaugeDelta: (delta: number) => void;
} {
  const gauge = new RulesetGauge(ruleset.gauge);
  const gaugeSummary: PlayerGrooveGaugeSummary = {
    current: gauge.value,
    max: ruleset.gauge.max,
    clearThreshold: ruleset.gauge.border,
    initial: ruleset.gauge.initial,
    effectiveTotal: ruleset.effectiveTotal,
    cleared: gauge.cleared(),
    // Ruleset-scoped gauge id (`GROOVE` / `NORMAL` / `HARD` / `EX-HARD` / …) so consumers can label the run's
    // clear lamp without inferring from the threshold, which collides between line-ups.
    type: ruleset.gauge.id,
    survival: ruleset.gauge.survival,
    failedMidPlay: false,
  };
  const syncGaugeSummary = (): void => {
    gaugeSummary.current = gauge.value;
    gaugeSummary.cleared = gauge.cleared();
    gaugeSummary.failedMidPlay = gauge.failedMidPlay;
  };

  return {
    summary: {
      total: totalNotes,
      perfect: 0,
      fast: 0,
      slow: 0,
      great: 0,
      good: 0,
      bad: 0,
      poor: 0,
      emptyPoor: 0,
      exScore: 0,
      score: 0,
      gauge: gaugeSummary,
    },
    applyGaugeJudge: (judge: GrooveGaugeJudgeKind): void => {
      gauge.applyJudge(GROOVE_GAUGE_JUDGE_TO_RULESET_INDEX[judge]);
      syncGaugeSummary();
    },
    applyGaugeDelta: (delta: number): void => {
      // Raw deltas (mine damage) bypass the per-judge table, the guts softening, and the TOTAL modifier — every
      // ruleset specifies mine damage directly as a gauge percentage — but still kill a survival gauge that bottoms out.
      gauge.applyRawDelta(delta);
      syncGaugeSummary();
    },
  };
}

/** Engine judge kinds mapped onto the ruleset gauge tables' beatoraja-ordered indices. */
const GROOVE_GAUGE_JUDGE_TO_RULESET_INDEX: Record<GrooveGaugeJudgeKind, GaugeJudgeIndex> = {
  PERFECT: GAUGE_JUDGE_PGREAT,
  GREAT: GAUGE_JUDGE_GREAT,
  GOOD: GAUGE_JUDGE_GOOD,
  BAD: GAUGE_JUDGE_BAD,
  POOR: GAUGE_JUDGE_MISS_POOR,
  EMPTY_POOR: GAUGE_JUDGE_EMPTY_POOR,
};

export function preparePlaybackChartData(
  resolvedJson: BeMusicJson,
  options: Pick<PlayerOptions, 'showInvisibleNotes' | 'laneModeExtension' | 'playVariant'>,
  inferBmsLnTypeWhenMissing: boolean,
  auxiliaryPlaybackEndSeconds: number,
): PreparedPlaybackChartData {
  const extractedNotes = extractTimedNotes(resolvedJson, {
    includeLandmine: true,
    // Invisible 3x/4x objects are not score targets, but they do update the lane's current keysound in manual play.
    // Keep extraction independent from the debug overlay option so audio semantics never depend on rendering settings.
    includeInvisible: true,
    inferBmsLnTypeWhenMissing,
  });
  const notes = extractedNotes.playableNotes;
  const landmineNotes = extractedNotes.landmineNotes;
  const invisibleNotes = extractedNotes.invisibleNotes;
  const laneSoundNotes = [...notes, ...invisibleNotes].sort(compareLaneSoundNotes);
  const renderNotes = notes;
  const totalSeconds = Math.max(
    resolvePlayableNotesTailSeconds(notes),
    landmineNotes.at(-1)?.seconds ?? 0,
    invisibleNotes.at(-1)?.seconds ?? 0,
    auxiliaryPlaybackEndSeconds,
  );
  const channels = collectUniqueNoteChannels(notes, landmineNotes, invisibleNotes);
  const laneModeOptions = {
    player: resolvedJson.bms.player,
    chartExtension: options.laneModeExtension,
    playVariant: options.playVariant,
  };
  const laneBindings = createLaneBindings(channels, laneModeOptions);
  const inputTokenToChannels = createInputTokenToChannelsMap(laneBindings);
  appendFreeZoneInputChannels(inputTokenToChannels, laneBindings, channels);
  const laneDisplayMode = resolveLaneDisplayMode(channels, laneModeOptions);
  const activeFreeZoneChannels = resolveActiveFreeZoneChannels(channels, laneBindings);
  const scorableNotes = notes.filter((note) => !isActiveFreeZoneChannel(note.channel, activeFreeZoneChannels));

  return {
    notes,
    laneSoundNotes,
    landmineNotes,
    invisibleNotes,
    renderNotes,
    totalSeconds,
    laneBindings,
    laneDisplayMode,
    activeFreeZoneChannels,
    scorableNotes,
    inputTokenToChannels,
  };
}

export async function initializePlayerUiRuntime({
  options,
  resolvedJson,
  mode,
  laneDisplayMode,
  laneBindings,
  speed,
  judgeWindowMs,
  highSpeed,
  randomPatternSummary,
  stateSignals,
  uiSignals,
  totalSeconds,
  onLoadProgress,
}: {
  options: PlayerOptions;
  resolvedJson: BeMusicJson;
  mode: CreatePlayerUiRuntimeContext['mode'];
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  judgeWindowMs: number;
  highSpeed: number;
  randomPatternSummary: string | undefined;
  stateSignals: PlayerStateSignals;
  uiSignals: PlayerUiSignalBus;
  totalSeconds: number;
  onLoadProgress: (ratio: number, message: string, detail?: string) => void;
}): Promise<InitializedPlayerUiRuntime> {
  throwIfAborted(options.signal);
  onLoadProgress(0.18, 'Preparing BGA...');
  const uiRuntime = await options.createUiRuntime?.({
    json: resolvedJson,
    mode,
    laneDisplayMode,
    laneBindings,
    speed,
    uiFps: options.uiFps,
    tuiVisibleNotesLimit: options.tuiVisibleNotesLimit,
    tuiNoteHeight: options.tuiNoteHeight ?? DEFAULT_TUI_NOTE_HEIGHT,
    judgeWindowMs,
    highSpeed,
    imageResizeAlgorithm: options.imageResizeAlgorithm ?? DEFAULT_IMAGE_RESIZE_ALGORITHM,
    videoBgaStreaming: options.videoBgaStreaming,
    showLaneChannels: Boolean(options.debugActiveAudio),
    randomPatternSummary,
    stateSignals,
    uiSignals,
    baseDir: options.audioBaseDir ?? resolveDefaultBaseDir(),
    loadSignal: options.signal,
    onBgaLoadProgress: (progress) => {
      onLoadProgress(0.18 + progress.ratio * 0.12, 'Preparing BGA...', progress.detail);
    },
  });
  throwIfAborted(options.signal);
  const updatedTotalSeconds = Math.max(totalSeconds, uiRuntime?.playbackEndSeconds ?? 0);
  const uiEnabled = Boolean(uiRuntime?.tuiEnabled);

  return {
    uiRuntime,
    totalSeconds: updatedTotalSeconds,
    uiEnabled,
    activeStateSignals: uiEnabled ? stateSignals : undefined,
  };
}

function resolvePlayableNotesTailSeconds(notes: ReadonlyArray<TimedPlayableNote>): number {
  let tailSeconds = 0;
  for (const note of notes) {
    const endSeconds =
      typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds
        ? note.endSeconds
        : note.seconds;
    if (endSeconds > tailSeconds) {
      tailSeconds = endSeconds;
    }
  }
  return tailSeconds;
}

function compareLaneSoundNotes(left: TimedPlayableNote, right: TimedPlayableNote): number {
  if (left.seconds !== right.seconds) {
    return left.seconds - right.seconds;
  }
  const leftSourceChannel = normalizeChannel(left.event.channel);
  const rightSourceChannel = normalizeChannel(right.event.channel);
  if (leftSourceChannel !== rightSourceChannel) {
    return leftSourceChannel < rightSourceChannel ? -1 : 1;
  }
  if (left.event.value !== right.event.value) {
    return left.event.value < right.event.value ? -1 : 1;
  }
  return 0;
}

function collectUniqueNoteChannels(
  notes: ReadonlyArray<TimedPlayableNote>,
  landmineNotes: ReadonlyArray<TimedLandmineNote>,
  invisibleNotes: ReadonlyArray<TimedPlayableNote>,
): string[] {
  const seen = new Set<string>();
  const channels: string[] = [];
  const collect = (channel: string): void => {
    if (!seen.has(channel)) {
      seen.add(channel);
      channels.push(channel);
    }
  };
  for (const note of notes) {
    collect(note.channel);
  }
  for (const landmine of landmineNotes) {
    collect(landmine.channel);
  }
  for (const invisible of invisibleNotes) {
    collect(invisible.channel);
  }
  return channels;
}

function resolveActiveFreeZoneChannels(
  channels: ReadonlyArray<string>,
  laneBindings: ReadonlyArray<LaneBinding>,
): ReadonlySet<string> {
  const existingChannels = new Set(channels.map((channel) => normalizeChannel(channel)));
  const boundChannels = new Set(laneBindings.map((binding) => normalizeChannel(binding.channel)));
  const activeFreeZoneChannels = new Set<string>();

  if (existingChannels.has('17') && boundChannels.has('16') && !boundChannels.has('17')) {
    activeFreeZoneChannels.add('17');
  }
  if (existingChannels.has('27') && boundChannels.has('26') && !boundChannels.has('27')) {
    activeFreeZoneChannels.add('27');
  }

  return activeFreeZoneChannels;
}

function isActiveFreeZoneChannel(channel: string, activeFreeZoneChannels: ReadonlySet<string>): boolean {
  return activeFreeZoneChannels.has(normalizeChannel(channel));
}
