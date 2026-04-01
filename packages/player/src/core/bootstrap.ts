import { throwIfAborted } from '@be-music/utils';
import { normalizeChannel, type BeMusicJson } from '@be-music/json';
import {
  createGrooveGaugeState,
  applyGrooveGaugeJudge,
  isGrooveGaugeCleared,
  type GrooveGaugeJudgeKind,
} from './groove-gauge.ts';
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
} from '../manual-input.ts';
import { type PlayerStateSignals } from '../state-signals.ts';

export interface PreparedPlaybackChartData {
  notes: TimedPlayableNote[];
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
  totalNotes: number,
  totalValue: number | undefined,
): {
  summary: PlayerSummary;
  applyGaugeJudge: (judge: GrooveGaugeJudgeKind) => void;
  applyGaugeDelta: (delta: number) => void;
} {
  const grooveGauge = createGrooveGaugeState(totalNotes, totalValue);
  const gaugeSummary: PlayerGrooveGaugeSummary = {
    current: grooveGauge.current,
    max: grooveGauge.max,
    clearThreshold: grooveGauge.clearThreshold,
    initial: grooveGauge.initial,
    effectiveTotal: grooveGauge.effectiveTotal,
    cleared: isGrooveGaugeCleared(grooveGauge),
  };
  const syncGrooveGaugeSummary = (): void => {
    gaugeSummary.current = grooveGauge.current;
    gaugeSummary.max = grooveGauge.max;
    gaugeSummary.clearThreshold = grooveGauge.clearThreshold;
    gaugeSummary.initial = grooveGauge.initial;
    gaugeSummary.effectiveTotal = grooveGauge.effectiveTotal;
    gaugeSummary.cleared = isGrooveGaugeCleared(grooveGauge);
  };

  return {
    summary: {
      total: grooveGauge.noteCount,
      perfect: 0,
      fast: 0,
      slow: 0,
      great: 0,
      good: 0,
      bad: 0,
      poor: 0,
      exScore: 0,
      score: 0,
      gauge: gaugeSummary,
    },
    applyGaugeJudge: (judge: GrooveGaugeJudgeKind): void => {
      applyGrooveGaugeJudge(grooveGauge, judge);
      syncGrooveGaugeSummary();
    },
    applyGaugeDelta: (delta: number): void => {
      if (!Number.isFinite(delta) || delta === 0) {
        return;
      }
      grooveGauge.current = Math.max(grooveGauge.min, Math.min(grooveGauge.max, grooveGauge.current + delta));
      syncGrooveGaugeSummary();
    },
  };
}

export function preparePlaybackChartData(
  resolvedJson: BeMusicJson,
  options: Pick<PlayerOptions, 'showInvisibleNotes' | 'laneModeExtension'>,
  inferBmsLnTypeWhenMissing: boolean,
  auxiliaryPlaybackEndSeconds: number,
): PreparedPlaybackChartData {
  const extractedNotes = extractTimedNotes(resolvedJson, {
    includeLandmine: true,
    includeInvisible: Boolean(options.showInvisibleNotes),
    inferBmsLnTypeWhenMissing,
  });
  const notes = extractedNotes.playableNotes;
  const landmineNotes = extractedNotes.landmineNotes;
  const invisibleNotes = extractedNotes.invisibleNotes;
  const renderNotes = notes;
  const totalSeconds = Math.max(
    resolvePlayableNotesTailSeconds(notes),
    landmineNotes.at(-1)?.seconds ?? 0,
    invisibleNotes.at(-1)?.seconds ?? 0,
    auxiliaryPlaybackEndSeconds,
  );
  const channels = collectUniqueNoteChannels(notes, landmineNotes, invisibleNotes);
  const laneModeOptions = { player: resolvedJson.bms.player, chartExtension: options.laneModeExtension };
  const laneBindings = createLaneBindings(channels, laneModeOptions);
  const inputTokenToChannels = createInputTokenToChannelsMap(laneBindings);
  appendFreeZoneInputChannels(inputTokenToChannels, laneBindings, channels);
  const laneDisplayMode = resolveLaneDisplayMode(channels, laneModeOptions);
  const activeFreeZoneChannels = resolveActiveFreeZoneChannels(channels, laneBindings);
  const scorableNotes = notes.filter((note) => !isActiveFreeZoneChannel(note.channel, activeFreeZoneChannels));

  return {
    notes,
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
    judgeWindowMs,
    highSpeed,
    videoBgaStreaming: options.videoBgaStreaming,
    showLaneChannels: Boolean(options.debugActiveAudio),
    randomPatternSummary,
    stateSignals,
    uiSignals,
    baseDir: options.audioBaseDir ?? process.cwd(),
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
