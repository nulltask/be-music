import { duplicateBattleChart } from './battle-chart.ts';
import { applyPracticeRange, resolvePracticeRange } from './practice.ts';
import { isDuplicatedBattleMode, resolveEffectiveBattleMode } from './battle-mode.ts';
import { convertLR2SPToDPChart } from './lr2-sp-to-dp-chart.ts';
import type { BattleMode } from './battle-mode.ts';
import { convertLR2ExtraChart } from './lr2-extra-chart.ts';
import type { LR2ExtraLevel } from './lr2-extra-lanes.ts';
import { addExtraNotes, clampExtraNoteDepth } from './extra-note-modifier.ts';
import { prepareMineModifier, type MineModifier } from './mine-modifier.ts';
import { addScrollChanges, removeScrollChanges, type ScrollModifier } from './scroll-modifier.ts';
import { addLongNotes, clampLongNoteRate, removeLongNoteTails, type LongNoteModifier } from './long-note-modifier.ts';
import { throwIfAborted } from '@be-music/shared-utils/core';
import { resolveChart, type ResolvedChart } from '@be-music/chart-model';
import { normalizeChannel, type BeMusicJSON } from '@be-music/chart-source';
import { type GrooveGaugeJudgmentKind } from './groove-gauge.ts';
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
import { type PlayerGaugeSummary, type PlayerUISignalBus } from './ui-signal-bus.ts';
import type { CreatePlayerUIRuntimeContext, PlayerOptions, PlayerSummary, PlayerUIRuntime } from './engine-types.ts';
import {
  toTimedInvisibleNote,
  toTimedPlayableNote,
  type TimedLandmineNote,
  type TimedPlayableNote,
} from '../playable-notes.ts';
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
export function resolveDefaultBaseDir(): string {
  const proc = (globalThis as { process?: { cwd?: () => string } }).process;
  return proc?.cwd?.() ?? '.';
}

export interface PreparedPlaybackChartData {
  scrollModifierApplied?: ScrollModifier;
  scrollSection?: number;
  scrollRate?: number;
  scrollModifierTimeline?: import('@be-music/chart-model').ScrollTimelinePoint[];
  /** Whether the selected modifier actually changed BPM, STOP or SCROLL; separate from the selected option. */
  scrollModifierChanged?: boolean;
  notes: TimedPlayableNote[];
  laneSoundNotes: TimedPlayableNote[];
  landmineNotes: TimedLandmineNote[];
  sevenToNinePattern?: import('./seven-to-nine.ts').SevenToNinePattern;
  sevenToNineType?: import('./seven-to-nine.ts').SevenToNineType;
  sevenToNineThresholdBPM?: number;
  sevenToNineApplied?: boolean;
  battleMode?: BattleMode;
  dBattleScratch?: boolean;
  /** beatoraja PRACTICE: the range played and the note counts before `PracticeModifier`. */
  practiceStartSeconds?: number;
  practiceEndSeconds?: number;
  practiceSourceNotes?: import('../ruleset/facts.ts').RulesetNoteCounts;
  practiceChangedObjectCount?: number;
  battleSourceVariant?: import('@be-music/chart-model').ChartPlayVariant;
  battleTempo?: number;
  battleAssist1P?: boolean;
  battleAssist2P?: boolean;
  battleChangedObjectCount?: number;
  battleDroppedObjectCount?: number;
  lr2ExtraMode?: boolean;
  lr2ExtraLevel?: LR2ExtraLevel;
  lr2ExtraEffectiveLevel?: LR2ExtraLevel;
  lr2ExtraConvertedObjectCount?: number;
  lr2ExtraTempo?: number;
  extraNoteDepth?: number;
  extraNoteScratch?: boolean;
  extraNoteChangeCount?: number;
  longNoteModifierApplied?: LongNoteModifier;
  longNoteModifierRate?: number;
  longNoteModifierChangeCount?: number;
  /** Number of mines actually changed; selection alone does not imply a source assist. */
  mineModifierChangeCount?: number;
  mineModifierApplied?: MineModifier;
  invisibleNotes: TimedPlayableNote[];
  renderNotes: TimedPlayableNote[];
  totalSeconds: number;
  laneBindings: LaneBinding[];
  laneDisplayMode: string;
  activeFreeZoneChannels: ReadonlySet<string>;
  scorableNotes: TimedPlayableNote[];
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>;
  /**
   * Duplicate notes that lost their lane and position to a note in `notes` but carry a different keysound (see
   * `extractTimedNotes`). Manual play sounds them as background audio. Omitted means none.
   */
  shadowedNotes?: TimedPlayableNote[];
  /** The resolved chart the notes were prepared from (`resolveChart`): its tempo map, triggers and chart facts. */
  resolvedChart: ResolvedChart;
}

export interface InitializedPlayerUIRuntime {
  uiRuntime: PlayerUIRuntime | undefined;
  totalSeconds: number;
  uiEnabled: boolean;
  activeStateSignals: PlayerStateSignals | undefined;
}

export function createInitialPlayerSummary(
  ruleset: RulesetConfig,
  totalNotes: number,
): {
  summary: PlayerSummary;
  applyGaugeJudge: (judge: GrooveGaugeJudgmentKind) => void;
  applyGaugeDelta: (delta: number) => void;
  applyGaugeTick: (judge: GaugeJudgeIndex, rate: number) => void;
  /** Empties the gauge for good (LR2's `HP = 0` on leaving a reversed play with notes outstanding). */
  drainGaugeToZero: () => void;
  /** Puts the summary and the gauge back to the play's start, in place (a seek rebuilds the play from there). */
  reset: () => void;
} {
  let gauge = new RulesetGauge(ruleset.gauge, ruleset.gaugeFallback, ruleset.gaugeBank);
  const gaugeSummary: PlayerGaugeSummary = {
    current: gauge.value,
    max: gauge.spec.max,
    clearThreshold: gauge.spec.border,
    initial: gauge.spec.initial,
    effectiveTotal: ruleset.effectiveTotal,
    cleared: gauge.cleared(),
    // Ruleset-scoped gauge id (`GROOVE` / `NORMAL` / `HARD` / `EX-HARD` / …) so consumers can label the run's
    // clear lamp without inferring from the threshold, which collides between line-ups.
    type: gauge.spec.id,
    survival: gauge.spec.survival,
    failedMidPlay: gauge.failedMidPlay,
    ...(gauge.values ? { values: gauge.values } : {}),
  };
  const syncGaugeSummary = (): void => {
    if (gauge.values) gaugeSummary.values = gauge.values;
    gaugeSummary.type = gauge.spec.id;
    gaugeSummary.max = gauge.spec.max;
    gaugeSummary.clearThreshold = gauge.spec.border;
    gaugeSummary.initial = gauge.spec.initial;
    gaugeSummary.survival = gauge.spec.survival;
    gaugeSummary.current = gauge.value;
    gaugeSummary.cleared = gauge.cleared();
    gaugeSummary.failedMidPlay = gauge.failedMidPlay;
  };

  const summary: PlayerSummary = {
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
    combo: 0,
    maxCombo: 0,
    gauge: gaugeSummary,
  };

  return {
    summary,
    applyGaugeJudge: (judge: GrooveGaugeJudgmentKind): void => {
      gauge.applyJudge(GROOVE_GAUGE_JUDGE_TO_RULESET_INDEX[judge]);
      syncGaugeSummary();
    },
    applyGaugeDelta: (delta: number): void => {
      // Raw deltas (mine damage) bypass the per-judge table, the guts softening, and the TOTAL modifier — every
      // ruleset specifies mine damage directly as a gauge percentage — but still kill a survival gauge that bottoms out.
      gauge.applyRawDelta(delta);
      syncGaugeSummary();
    },
    applyGaugeTick: (judge: GaugeJudgeIndex, rate: number): void => {
      gauge.applyJudge(judge, rate);
      syncGaugeSummary();
    },
    drainGaugeToZero: (): void => {
      gauge.drainToZero();
      syncGaugeSummary();
    },
    reset: (): void => {
      gauge = new RulesetGauge(ruleset.gauge, ruleset.gaugeFallback, ruleset.gaugeBank);
      syncGaugeSummary();
      delete summary.minePoor;
      for (const key of ['perfect', 'fast', 'slow', 'great', 'good', 'bad', 'poor', 'emptyPoor', 'exScore'] as const) {
        summary[key] = 0;
      }
      summary.score = 0;
    },
  };
}

/** Engine judge kinds mapped onto the ruleset gauge tables' beatoraja-ordered indices. */
const GROOVE_GAUGE_JUDGE_TO_RULESET_INDEX: Record<GrooveGaugeJudgmentKind, GaugeJudgeIndex> = {
  PERFECT: GAUGE_JUDGE_PGREAT,
  GREAT: GAUGE_JUDGE_GREAT,
  GOOD: GAUGE_JUDGE_GOOD,
  BAD: GAUGE_JUDGE_BAD,
  POOR: GAUGE_JUDGE_MISS_POOR,
  EMPTY_POOR: GAUGE_JUDGE_EMPTY_POOR,
};

/**
 * Prepares a play from a resolved chart (`resolveChart` in `@be-music/chart-model`): fresh mutable note arrays for the engine
 * and the renderer, the lane bindings for the chart's play variant, and the scorable notes (FREE ZONE columns the
 * layout does not bind are left out).
 */
export function preparePlaybackChart(
  resolved: ResolvedChart,
  options: Pick<
    PlayerOptions,
    | 'laneModeExtension'
    | 'longNoteModifier'
    | 'battleMode'
    | 'dBattleScratch'
    | 'practice'
    | 'judgeRuleset'
    | 'autoScratch'
    | 'autoScratch1P'
    | 'autoScratch2P'
    | 'lr2ExtraMode'
    | 'lr2ExtraLevel'
    | 'course'
    | 'speed'
    | 'extraNoteDepth'
    | 'extraNoteScratch'
    | 'longNoteRate'
    | 'longNoteModifierPlacements'
    | 'mineModifier'
    | 'mineModifierPlacements'
    | 'scrollModifier'
    | 'scrollSection'
    | 'scrollRate'
    | 'scrollModifierTimeline'
  > = {},
  auxiliaryPlaybackEndSeconds = 0,
  random?: () => number,
): PreparedPlaybackChartData {
  const lr2ExtraMode = options.lr2ExtraMode === true && options.course === undefined;
  const lr2Extra = lr2ExtraMode
    ? convertLR2ExtraChart(resolved, { level: options.lr2ExtraLevel ?? 0, tempo: options.speed })
    : undefined;
  resolved = lr2Extra?.chart ?? resolved;
  const battleSourceVariant = resolved.playVariant;
  const battleMode = resolveEffectiveBattleMode(
    options.battleMode ?? 'OFF',
    options.judgeRuleset ?? 'lr2',
    battleSourceVariant,
    options.course !== undefined,
  );
  const battleAssist1P = options.autoScratch1P ?? options.autoScratch ?? false;
  const battleAssist2P = options.autoScratch2P ?? options.autoScratch ?? false;
  const battle =
    battleMode === 'SP-TO-DP'
      ? convertLR2SPToDPChart(resolved, {
          tempo: options.speed,
          assist1P: battleAssist1P,
          assist2P: battleAssist2P,
        })
      : undefined;
  resolved = battle?.chart ?? resolved;
  const scrollAddition =
    options.scrollModifier === 'ADD'
      ? addScrollChanges(resolved, {
          section: options.scrollSection,
          rate: options.scrollRate,
          timeline: options.scrollModifierTimeline,
          random,
        })
      : undefined;
  const scrollResult =
    scrollAddition ?? (options.scrollModifier === 'REMOVE' ? removeScrollChanges(resolved) : undefined);
  resolved = scrollResult?.chart ?? resolved;
  let playVariant = resolved.playVariant;
  const notes = resolved.notes.map(toTimedPlayableNote);
  const longMode = options.longNoteModifier ?? 'OFF';
  const longChanges =
    longMode === 'ADD_LN' || longMode === 'ADD_CN' || longMode === 'ADD_HCN' || longMode === 'ADD_ALL'
      ? addLongNotes(resolved, notes, longMode, {
          rate: options.longNoteRate,
          random,
          laneModeExtension: options.laneModeExtension,
          placements: options.longNoteModifierPlacements,
        })
      : removeLongNoteTails(notes, longMode, resolved.lnMode);
  // Invisible 3x/4x objects are not score targets, but they do update the lane's current keysound in manual play.
  // They are always prepared, independently of the debug overlay option, so audio never depends on rendering settings.
  const mineResult = prepareMineModifier(resolved, options.mineModifier ?? 'OFF', {
    notes,
    laneModeExtension: options.laneModeExtension,
    random,
    placements: options.mineModifierPlacements,
  });
  const landmineNotes = mineResult.mines;
  const extraResult = addExtraNotes(resolved, notes, landmineNotes, {
    depth: options.extraNoteDepth,
    scratch: options.extraNoteScratch,
    laneModeExtension: options.laneModeExtension,
  });
  resolved = extraResult.chart;
  const invisibleNotes = resolved.invisibleNotes.map(toTimedInvisibleNote);
  const dBattleScratch = battleMode === 'D-BATTLE' && options.dBattleScratch === true;
  const duplicateBattle = isDuplicatedBattleMode(battleMode, battleSourceVariant)
    ? duplicateBattleChart(resolved, notes, landmineNotes, invisibleNotes, {
        // LR2 copies only 1x/3x/5x cells (D-BATTLE, BATTLE); That-Which-Must-Not-Be-Named gives both players one chart.
        duplicateMines: !(
          battleMode === 'D-BATTLE' ||
          (battleMode === 'TWO-PLAYER' && options.judgeRuleset !== '____')
        ),
        backgroundScratch: battleMode === 'BATTLE-AS' || (battleMode === 'D-BATTLE' && !dBattleScratch),
        backgroundMineSample: battleMode === 'D-BATTLE',
      })
    : undefined;
  resolved = duplicateBattle?.chart ?? resolved;
  playVariant = resolved.playVariant;
  let totalSeconds = Math.max(resolved.lastNoteSeconds, auxiliaryPlaybackEndSeconds);
  for (const note of notes) totalSeconds = Math.max(totalSeconds, note.endSeconds ?? note.seconds);
  for (const mine of landmineNotes) totalSeconds = Math.max(totalSeconds, mine.seconds);
  const practiceRange =
    options.practice !== undefined
      ? resolvePracticeRange(
          options.practice,
          Math.floor(Math.max(totalSeconds, resolved.sampleTriggers.at(-1)?.seconds ?? 0) * 1000),
        )
      : undefined;
  const practice = practiceRange ? applyPracticeRange(resolved, notes, landmineNotes, practiceRange) : undefined;
  resolved = practice?.chart ?? resolved;
  // The source plays a practice range until 1000 ms past its end, as an ordinary play runs past its last note.
  if (practiceRange) totalSeconds = (practiceRange.endMs + 1000) / 1000;
  const laneSoundNotes = [...notes, ...invisibleNotes].sort(compareLaneSoundNotes);
  const renderNotes = notes;
  const channels = collectUniqueNoteChannels(notes, landmineNotes, invisibleNotes);
  const laneModeOptions = {
    player: resolved.source.bms.player,
    chartExtension: options.laneModeExtension,
    playVariant,
  };
  const laneBindings = createLaneBindings(channels, laneModeOptions);
  const inputTokenToChannels = createInputTokenToChannelsMap(laneBindings);
  appendFreeZoneInputChannels(inputTokenToChannels, laneBindings, channels);
  const laneDisplayMode = resolveLaneDisplayMode(channels, laneModeOptions);
  const activeFreeZoneChannels = resolveActiveFreeZoneChannels(channels, laneBindings);
  const scorableNotes = notes.filter((note) => !isActiveFreeZoneChannel(note.channel, activeFreeZoneChannels));

  return {
    ...(options.battleMode !== undefined
      ? {
          battleMode,
          battleSourceVariant,
          battleTempo: options.speed ?? 1,
          battleAssist1P,
          battleAssist2P,
          battleChangedObjectCount: duplicateBattle?.changedObjectCount ?? battle?.changedObjectCount ?? 0,
          battleDroppedObjectCount: battle?.droppedObjectCount ?? 0,
          ...(battleMode === 'D-BATTLE' ? { dBattleScratch } : {}),
        }
      : {}),
    ...(practiceRange && practice
      ? {
          practiceStartSeconds: practiceRange.startMs / 1000,
          practiceEndSeconds: practiceRange.endMs / 1000,
          practiceSourceNotes: practice.sourceNotes,
          practiceChangedObjectCount: practice.changedObjectCount,
        }
      : {}),
    ...(options.lr2ExtraMode !== undefined
      ? {
          lr2ExtraMode,
          lr2ExtraLevel: options.lr2ExtraLevel ?? 0,
          lr2ExtraEffectiveLevel: lr2Extra?.level ?? options.lr2ExtraLevel ?? 0,
          lr2ExtraConvertedObjectCount: lr2Extra?.changes ?? 0,
          lr2ExtraTempo: options.speed ?? 1,
        }
      : {}),
    ...(options.extraNoteDepth !== undefined || options.extraNoteScratch !== undefined
      ? {
          extraNoteDepth: clampExtraNoteDepth(options.extraNoteDepth ?? 0),
          extraNoteScratch: options.extraNoteScratch ?? false,
          extraNoteChangeCount: extraResult.changes,
        }
      : {}),
    notes,
    ...(options.longNoteModifier !== undefined
      ? {
          longNoteModifierApplied: longMode,
          longNoteModifierChangeCount: longChanges,
          longNoteModifierRate: clampLongNoteRate(options.longNoteRate ?? 1),
        }
      : {}),
    laneSoundNotes,
    landmineNotes,
    ...(options.mineModifier !== undefined
      ? { mineModifierChangeCount: mineResult.changes, mineModifierApplied: options.mineModifier }
      : {}),
    invisibleNotes,
    renderNotes,
    totalSeconds,
    laneBindings,
    laneDisplayMode,
    activeFreeZoneChannels,
    scorableNotes,
    inputTokenToChannels,
    shadowedNotes: resolved.shadowedNotes.map(toTimedPlayableNote),
    resolvedChart: resolved,
    ...(scrollAddition
      ? {
          scrollSection: scrollAddition.section,
          scrollRate: scrollAddition.rate,
          scrollModifierTimeline: scrollAddition.timeline,
        }
      : {}),
    ...(options.scrollModifier !== undefined
      ? { scrollModifierApplied: options.scrollModifier, scrollModifierChanged: scrollResult?.changed ?? false }
      : {}),
  };
}

/**
 * Resolves `resolvedJSON` (a chart without control flow) with `resolveChart` and prepares it with
 * {@link preparePlaybackChart}. The play variant is the host-declared one, else the shared `resolveChartPlayVariant`
 * rule over the chart's events and `laneModeExtension`.
 */
export function preparePlaybackChartData(
  resolvedJSON: BeMusicJSON,
  options: Pick<PlayerOptions, 'showInvisibleNotes' | 'laneModeExtension' | 'playVariant'>,
  inferBmsLNTypeWhenMissing: boolean,
  auxiliaryPlaybackEndSeconds: number,
): PreparedPlaybackChartData {
  return preparePlaybackChart(
    resolveChart(resolvedJSON, {
      chartPath: options.laneModeExtension,
      playVariant: options.playVariant,
      inferBmsLNTypeWhenMissing,
    }),
    options,
    auxiliaryPlaybackEndSeconds,
  );
}

export async function initializePlayerUIRuntime({
  options,
  resolvedJSON,
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
  resolvedJSON: BeMusicJSON;
  mode: CreatePlayerUIRuntimeContext['mode'];
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  judgeWindowMs: number;
  highSpeed: number;
  randomPatternSummary: string | undefined;
  stateSignals: PlayerStateSignals;
  uiSignals: PlayerUISignalBus;
  totalSeconds: number;
  onLoadProgress: (ratio: number, message: string, detail?: string) => void;
}): Promise<InitializedPlayerUIRuntime> {
  throwIfAborted(options.signal);
  onLoadProgress(0.18, 'Preparing BGA...');
  const uiRuntime = await options.createUIRuntime?.({
    json: resolvedJSON,
    mode,
    laneDisplayMode,
    laneBindings,
    speed,
    uiFPS: options.uiFPS,
    tuiVisibleNotesLimit: options.tuiVisibleNotesLimit,
    tuiNoteHeight: options.tuiNoteHeight ?? DEFAULT_TUI_NOTE_HEIGHT,
    judgeWindowMs,
    highSpeed,
    imageResizeAlgorithm: options.imageResizeAlgorithm ?? DEFAULT_IMAGE_RESIZE_ALGORITHM,
    videoBGAStreaming: options.videoBGAStreaming,
    keyBoundBGACues: options.keyBoundBGACues,
    showLaneChannels: Boolean(options.debugActiveAudio),
    randomPatternSummary,
    stateSignals,
    uiSignals,
    baseDir: options.audioBaseDir ?? resolveDefaultBaseDir(),
    loadSignal: options.signal,
    onBGALoadProgress: (progress) => {
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
