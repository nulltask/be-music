import { hasChartPlayOptions, type ChartOptionProgram, type ChartPlayOptionProgram } from '@be-music/chart-model';
import type { BeatorajaCustomJudge } from '../ruleset/custom-judge.ts';
import type { EffectiveBattleMode } from '../core/battle-mode.ts';
import type { ChartPlayVariant } from '@be-music/chart-model';
import type { LR2ExtraLevel } from '../core/lr2-extra-lanes.ts';
import type { ScrollTimelinePoint } from '@be-music/chart-model';
import type { ScrollModifier } from '../core/scroll-modifier.ts';
import type { LongNoteModifier } from '../core/long-note-modifier.ts';
import { resolveReplaySourceChannel } from './source-channel.ts';
import type { MineModifier } from '../core/mine-modifier.ts';
import {
  diffReplayOptions,
  parseReplayOptionState,
  type ReplayOptionState,
  type ReplayOptionChange,
} from './options.ts';
import type { ReplayTempoChange, ReplayViewChange, ReplayViewState } from './view.ts';
import {
  computeChartFingerprint,
  computePlayFingerprint,
  hasControlFlow,
  resolveChart,
  type RandomDraws,
} from '@be-music/chart-model';
import { resolveBMSControlFlowWithDraws } from '@be-music/chart-parser';
import { resolveBMSBase, type BeMusicJSON } from '@be-music/chart-source';
import type { PlayerSummary } from '../core/engine.ts';
import type { PreparedPlaybackChartData } from '../core/bootstrap.ts';
import { resolveChartJudgeRankFacts } from '../ruleset/index.ts';
import { resolveLandmineGaugeEffect } from '../core/landmine.ts';
import { resolve____RankLabel } from '../ruleset/score.ts';
import type { GaugeType, GaugeAutoShift, GaugeShiftBottom } from '../ruleset/gauge-type.ts';
import type { RulesetId } from '../ruleset/definitions.ts';
import packageJSON from '../../package.json' with { type: 'json' };
import {
  BE_MUSIC_REPLAY_FORMAT,
  BE_MUSIC_REPLAY_VERSION,
  type BeMusicReplay,
  type ReplayChart,
  type ReplayCourseStage,
  type ReplayInputAction,
  type ReplayInputEvent,
  type ReplayNote,
  type ReplayPlay,
  type ReplayRecorderInfo,
  type ReplayRulesetResult,
} from './format.ts';

/** Ruleset id used for the engine's own summary cached into `results` at record time. */
export const REPLAY_NATIVE_RULESET_ID = 'be-music/native';

/** `@be-music/player-engine` version stamped into `recorder.engine` of every log this engine records. */
export const REPLAY_ENGINE_VERSION: string = packageJSON.version;
const ENGINE_VERSION = REPLAY_ENGINE_VERSION;

/**
 * Chart data the recorder snapshots — structurally a subset of the engine's `PreparedPlaybackChartData`, so the
 * engine can hand its prepared bundle over verbatim.
 */
export type ReplayRecorderChartData = Pick<
  PreparedPlaybackChartData,
  'notes' | 'landmineNotes' | 'invisibleNotes' | 'activeFreeZoneChannels' | 'scorableNotes' | 'laneDisplayMode'
> &
  Partial<Pick<PreparedPlaybackChartData, 'resolvedChart'>>;

export interface ReplayRecorderPlaySettings {
  /** Absent retains beatoraja-compatible bmson zero-total recovery. */
  bmsonTotalMode?: import('../ruleset/bmson-total.ts').BmsonTotalMode;
  options?: ReplayOptionState;
  mode: 'manual' | 'auto';
  autoScratch: boolean;
  judgeAlgorithm?: 'combo' | 'duration' | 'lowest';
  customJudge?: BeatorajaCustomJudge;
  longNoteModifier?: LongNoteModifier;
  longNoteRate?: number;
  sevenToNinePattern?: import('../core/seven-to-nine.ts').SevenToNinePattern;
  sevenToNineType?: import('../core/seven-to-nine.ts').SevenToNineType;
  sevenToNineThresholdBPM?: number;
  sevenToNineApplied?: boolean;
  battleMode?: EffectiveBattleMode;
  battleSourceVariant?: ChartPlayVariant;
  battleTempo?: number;
  battleAssist1P?: boolean;
  battleAssist2P?: boolean;
  battleChangedObjectCount?: number;
  battleDroppedObjectCount?: number;
  dBattleScratch?: boolean;
  lr2ExtraMode?: boolean;
  lr2ExtraLevel?: LR2ExtraLevel;
  lr2ExtraEffectiveLevel?: LR2ExtraLevel;
  lr2ExtraConvertedObjectCount?: number;
  lr2ExtraTempo?: number;
  extraNoteDepth?: number;
  extraNoteScratch?: boolean;
  /** Actual source conversions, including overwritten additions; independent of record policy. */
  extraNoteChangeCount?: number;
  longNoteModifierChangeCount?: number;
  mineModifier?: MineModifier;
  scrollModifier?: ScrollModifier;
  scrollSection?: number;
  scrollRate?: number;
  scrollModifierTimeline?: ScrollTimelinePoint[];
  scrollModifierChanged?: boolean;
  mineModifierChangeCount?: number;
  autoScratch1P?: boolean;
  autoScratch2P?: boolean;
  /** ANY KEY routed the play's presses (`PlayerOptions.anyKey`). */
  anyKey?: boolean;
  /** The gauge the engine ran (`PlayerOptions.gauge`, else `recordReplay.gauge`); `GROOVE` when neither is set. */
  gauge?: GaugeType;
  randomLane?: { p1?: string; p2?: string };
  dpFlip?: boolean;
  judgeWindowOverrideMs?: number;
  /** Judgment-window ruleset the engine ran (`PlayerOptions.judgeRuleset`). Absent = `'lr2'`. */
  judgeRuleset?: RulesetId;
  /** The play's `#RANDOM` / `#SWITCH` outcomes (`PlayerOptions.randomDraws`). Recorded when non-empty. */
  randomDraws?: RandomDraws;
  /** The play ended the moment its survival gauge emptied (`PlayerOptions.endOnFailure`). Recorded when true. */
  endOnFailure?: boolean;
  gaugeAutoShift?: GaugeAutoShift;
  bottomShiftableGauge?: GaugeShiftBottom;
  /** The course stage the play was (`PlayerOptions.course`). */
  course?: ReplayCourseStage;
  /** The play tempo (`PlayerOptions.speed`). Recorded when it is not 1. */
  tempo?: number;
  /** What the player sees at the start (`PlayerOptions.recordReplay.view`): hi-speed, covers and lift. */
  view?: ReplayViewState;
  native?: Record<string, string | number | boolean | null>;
}

/**
 * Host-declared subset of the recording inputs — the fields the engine cannot know by itself. Passed through
 * `PlayerOptions.recordReplay`. `chartSHA256` is the SHA-256 (lowercase hex) of the source chart FILE bytes;
 * hosts that have the raw file compute it so dropped logs can be matched back to their chart by content. `chartMD5` is
 * the MD5 of the same bytes, the key LR2 and LR2IR use.
 * `sourceChart` is the chart as loaded, before `#RANDOM` / `#SWITCH` resolution and before any lane option; hosts that
 * resolve control flow or rewrite lanes on the chart themselves pass it so the fingerprints describe the chart, not
 * their working copy. Without it the engine uses the chart it was given. `recorder` identifies the host application;
 * the engine version is added by the recorder itself.
 */
export type ReplayRecordingOptions = Pick<
  ReplayRecorderPlaySettings,
  'gauge' | 'randomLane' | 'dpFlip' | 'view' | 'native' | 'options'
> & {
  chartSHA256?: string;
  chartMD5?: string;
  sourceChart?: BeMusicJSON;
  recorder?: Omit<ReplayRecorderInfo, 'engine'>;
};

export interface ReplayRecorderOptions {
  chartOptions?: ChartOptionProgram;
  /** The chart-authored gameplay options the play ran with; recorded when it forces anything. */
  chartPlayOptions?: ChartPlayOptionProgram;
  /** Resolved chart JSON (post `#RANDOM` control flow) — metadata source. */
  json: BeMusicJSON;
  chart: ReplayRecorderChartData;
  /** SHA-256 (lowercase hex) of the source chart file bytes, when the host computed one. */
  chartSHA256?: string;
  /** MD5 (lowercase hex) of the source chart file bytes, when the host computed one. */
  chartMD5?: string;
  /**
   * The chart file's extension (`PlayerOptions.laneModeExtension`), the fingerprint's lane-mode input. Without it the
   * recorder infers `.pms` from a 9 KEY lane mode.
   */
  laneModeExtension?: string;
  /**
   * The chart before `#RANDOM` / `#SWITCH` resolution and before any lane option — the fingerprint source. Used when
   * `play.randomDraws` were drawn for its control flow; otherwise the fingerprints fall back to {@link json}.
   */
  sourceChart?: BeMusicJSON;
  play: ReplayRecorderPlaySettings;
  /** True when the ruleset the play ran under keeps LR2's money score; the native result then carries `score`. */
  moneyScore?: boolean;
  /** Host application that records the play. `engine` is always overwritten with this package's version. */
  recorder?: Omit<ReplayRecorderInfo, 'engine'>;
  /** Dynamic `#EXRANKxx` changes the engine collected (chart order). */
  dynamicJudgeRankChanges?: ReadonlyArray<{ seconds: number; exRankValue: number }>;
  /** A stitched NONSTOP chart's later stages taking over the judge rank (`PlayerPlaySettings.stageRanks`). */
  stageRanks?: ReadonlyArray<{
    seconds: number;
    rank: number;
    table: 'chart' | 'lr2-nonstop' | 'bmson' | 'bms-exrank';
  }>;
  /** LR2 negative-BPM reversal (chart seconds, #134) — recorded so re-simulations freeze judging at the same point. */
  reversalSeconds?: number;
  /** Clock source for `createdAt` — injectable for tests. Defaults to `Date`. */
  now?: () => Date;
}

export interface ReplayRecorderFinalizeInput {
  summary: PlayerSummary;
  maxCombo?: number;
  aborted?: boolean;
  /** Chart seconds the judge had settled through when the play was aborted. */
  abortedAtSeconds?: number;
  /** The 2P player of a two-player play: its summary, max combo and gauge (recorded as `results.secondPlayer`). */
  secondPlayer?: { summary: PlayerSummary; maxCombo: number; gauge: GaugeType };
}

export interface ReplayRecorder {
  /** Discards recorded data and ignores later input after a practice seek. Finalization is no longer allowed. */
  discard(): void;
  /** Records a press or release; `inferred` marks a release the engine inferred from input without releases. */
  recordInput(
    action: ReplayInputAction,
    timeSeconds: number,
    tokens: readonly string[],
    channels: Iterable<string>,
    inferred?: boolean,
  ): void;
  /** Counts an LR2-style empty POOR — cached into the native result for diagnostics. */
  recordEmptyPoor(): void;
  /** Records a view change (hi-speed, covers, lift) at a chart time. An empty change is dropped. */
  recordViewChange(timeSeconds: number, change: ReplayViewState): void;
  /** Records selected options at the chart clock; repeated values are dropped. */
  recordOptionChange(timeSeconds: number, values: ReplayOptionState): void;
  /** Records a tempo change at a chart time. A change to the tempo already in force is dropped. */
  recordTempoChange(timeSeconds: number, tempo: number): void;
  finalize(input: ReplayRecorderFinalizeInput): BeMusicReplay;
}

export function createReplayRecorder(options: ReplayRecorderOptions): ReplayRecorder {
  const chart = buildReplayChart(options);
  const inputs: ReplayInputEvent[] = [];
  let discarded = false;
  let seq = 0;
  let emptyPoorCount = 0;
  const viewChanges: ReplayViewChange[] = [];
  const initialOptions = options.play.options === undefined ? undefined : parseReplayOptionState(options.play.options);
  let currentOptions = { ...initialOptions };
  const optionChanges: ReplayOptionChange[] = [];
  const tempoChanges: ReplayTempoChange[] = [];
  let currentTempo = options.play.tempo ?? 1;

  return {
    discard: () => {
      discarded = true;
      inputs.length = 0;
      viewChanges.length = 0;
      optionChanges.length = 0;
      tempoChanges.length = 0;
      emptyPoorCount = 0;
    },
    recordInput: (action, timeSeconds, tokens, channels, inferred): void => {
      if (discarded) return;
      const channelList = [...channels];
      if (channelList.length === 0) {
        return;
      }
      const event: ReplayInputEvent = {
        seq: seq++,
        timeUs: secondsToMicroseconds(timeSeconds),
        action,
        channels: channelList,
      };
      if (tokens.length > 0) {
        event.tokens = [...tokens];
      }
      if (inferred === true && action === 'up') {
        event.inferred = true;
      }
      inputs.push(event);
    },
    recordEmptyPoor: (): void => {
      if (discarded) return;
      emptyPoorCount += 1;
    },
    recordOptionChange: (timeSeconds, values): void => {
      if (discarded) return;
      const change = diffReplayOptions(currentOptions, parseReplayOptionState(values));
      if (!change) return;
      const timeUs = secondsToMicroseconds(timeSeconds);
      if (!Number.isSafeInteger(timeUs) || timeUs < (optionChanges.at(-1)?.timeUs ?? 0))
        throw new RangeError('Option changes must use nondecreasing chart times.');
      optionChanges.push({ timeUs, values: change });
      currentOptions = { ...currentOptions, ...change };
    },
    recordViewChange: (timeSeconds, change): void => {
      if (discarded) return;
      const entries = Object.entries(change).filter(([, value]) => value !== undefined);
      if (entries.length === 0) return;
      const recorded: ReplayViewChange = { timeUs: secondsToMicroseconds(timeSeconds), ...change };
      if (change.covers !== undefined) recorded.covers = change.covers.map((cover) => ({ ...cover }));
      viewChanges.push(recorded);
    },
    recordTempoChange: (timeSeconds, tempo): void => {
      if (discarded) return;
      if (!(tempo > 0) || tempo === currentTempo) return;
      currentTempo = tempo;
      tempoChanges.push({ timeUs: secondsToMicroseconds(timeSeconds), tempo });
    },
    finalize: ({ summary, maxCombo, aborted, abortedAtSeconds, secondPlayer }): BeMusicReplay => {
      if (discarded) throw new Error('Cannot finalize a discarded practice replay');
      const play: ReplayPlay = {
        mode: options.play.mode,
        autoScratch: options.play.autoScratch,
        gauge: options.play.gauge ?? 'GROOVE',
      };
      if (secondPlayer !== undefined) play.gauge2P = secondPlayer.gauge;
      if (options.play.randomLane !== undefined) play.randomLane = options.play.randomLane;
      if (options.play.dpFlip !== undefined) play.dpFlip = options.play.dpFlip;
      if (options.play.judgeWindowOverrideMs !== undefined) {
        play.judgeWindowOverrideMs = options.play.judgeWindowOverrideMs;
      }
      if (options.play.judgeRuleset !== undefined) play.judgeRuleset = options.play.judgeRuleset;
      if (options.play.randomDraws !== undefined && options.play.randomDraws.length > 0) {
        play.randomDraws = options.play.randomDraws.map((draw) => ({ ...draw }));
      }
      if (aborted === true) {
        play.aborted = true;
        if (abortedAtSeconds !== undefined) play.abortedAtUs = secondsToMicroseconds(abortedAtSeconds);
      }
      if (options.play.bmsonTotalMode !== undefined) play.bmsonTotalMode = options.play.bmsonTotalMode;
      if (options.play.bottomShiftableGauge !== undefined)
        play.bottomShiftableGauge = options.play.bottomShiftableGauge;
      if (options.play.gaugeAutoShift !== undefined) play.gaugeAutoShift = options.play.gaugeAutoShift;
      if (options.play.endOnFailure === true) play.endOnFailure = true;
      if (options.play.course !== undefined) play.course = structuredClone(options.play.course);
      if (options.play.tempo !== undefined && options.play.tempo !== 1) play.tempo = options.play.tempo;
      if (tempoChanges.length > 0) play.tempoChanges = tempoChanges.map((change) => ({ ...change }));
      if (options.play.view !== undefined) play.view = structuredClone(options.play.view);
      if (options.play.judgeAlgorithm !== undefined) play.judgeAlgorithm = options.play.judgeAlgorithm;
      if (options.play.customJudge !== undefined) play.customJudge = { ...options.play.customJudge };
      if (options.play.scrollModifier !== undefined) play.scrollModifier = options.play.scrollModifier;
      if (options.play.scrollSection !== undefined) play.scrollSection = options.play.scrollSection;
      if (options.play.scrollRate !== undefined) play.scrollRate = options.play.scrollRate;
      if (options.play.scrollModifierTimeline !== undefined)
        play.scrollModifierTimeline = options.play.scrollModifierTimeline.map((point) => ({ ...point }));
      if (options.play.scrollModifierChanged !== undefined)
        play.scrollModifierChanged = options.play.scrollModifierChanged;
      if (options.play.mineModifier !== undefined) play.mineModifier = options.play.mineModifier;
      if (options.play.mineModifierChangeCount !== undefined)
        play.mineModifierChangeCount = options.play.mineModifierChangeCount;
      for (const field of [
        'sevenToNinePattern',
        'sevenToNineType',
        'sevenToNineThresholdBPM',
        'sevenToNineApplied',
        'battleMode',
        'battleSourceVariant',
        'battleTempo',
        'battleAssist1P',
        'battleAssist2P',
        'battleChangedObjectCount',
        'battleDroppedObjectCount',
        'dBattleScratch',
      ] as const)
        if (options.play[field] !== undefined) Object.assign(play, { [field]: options.play[field] });
      for (const field of [
        'lr2ExtraMode',
        'lr2ExtraLevel',
        'lr2ExtraEffectiveLevel',
        'lr2ExtraConvertedObjectCount',
        'lr2ExtraTempo',
      ] as const)
        if (options.play[field] !== undefined) Object.assign(play, { [field]: options.play[field] });
      if (options.play.extraNoteDepth !== undefined) play.extraNoteDepth = options.play.extraNoteDepth;
      if (options.play.extraNoteScratch !== undefined) play.extraNoteScratch = options.play.extraNoteScratch;
      if (options.play.extraNoteChangeCount !== undefined)
        play.extraNoteChangeCount = options.play.extraNoteChangeCount;
      if (options.play.longNoteRate !== undefined) play.longNoteRate = options.play.longNoteRate;
      if (options.play.longNoteModifierChangeCount !== undefined)
        play.longNoteModifierChangeCount = options.play.longNoteModifierChangeCount;
      if (options.play.longNoteModifier !== undefined) play.longNoteModifier = options.play.longNoteModifier;
      if (options.play.autoScratch1P !== undefined) play.autoScratch1P = options.play.autoScratch1P;
      if (options.play.autoScratch2P !== undefined) play.autoScratch2P = options.play.autoScratch2P;
      if (options.play.anyKey === true) play.anyKey = true;
      if (initialOptions !== undefined) play.options = { ...initialOptions };
      if (optionChanges.length > 0) play.optionChanges = structuredClone(optionChanges);
      if (viewChanges.length > 0) play.viewChanges = structuredClone(viewChanges);
      if (options.play.native !== undefined) play.native = options.play.native;

      const createdAt = (options.now?.() ?? new Date()).toISOString();
      return {
        format: BE_MUSIC_REPLAY_FORMAT,
        version: BE_MUSIC_REPLAY_VERSION,
        createdAt,
        recorder: { ...options.recorder, engine: ENGINE_VERSION },
        clock: { unit: 'us', origin: 'chart-zero' },
        chart,
        inputs,
        play,
        results: {
          // Two players share the recorder: each side's empty POORs are its own summary's.
          native: buildNativeResult(
            summary,
            maxCombo,
            secondPlayer === undefined ? emptyPoorCount : summary.emptyPoor,
            play.gauge,
            options.moneyScore === true,
          ),
          ...(secondPlayer !== undefined
            ? {
                secondPlayer: buildNativeResult(
                  secondPlayer.summary,
                  secondPlayer.maxCombo,
                  secondPlayer.summary.emptyPoor,
                  secondPlayer.gauge,
                  options.moneyScore === true,
                ),
              }
            : {}),
        },
      };
    },
  };
}

function buildReplayChart(options: ReplayRecorderOptions): ReplayChart {
  const { json, chart } = options;
  const idBase = resolveBMSBase(json);
  const resolved = chart.resolvedChart ?? resolveChart(json);
  const chartLNMode = resolved.lnMode;
  const notes: ReplayNote[] = [];

  for (const note of chart.notes) {
    const isFreeZone = chart.activeFreeZoneChannels.has(note.channel);
    const hasTail =
      typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds;
    const entry: ReplayNote = {
      id: 0,
      channel: note.channel,
      ...(resolveReplaySourceChannel(note) !== note.channel ? { sourceChannel: resolveReplaySourceChannel(note) } : {}),
      type: isFreeZone ? 'freezone' : hasTail ? 'long' : 'normal',
      timeUs: secondsToMicroseconds(note.seconds),
    };
    if (hasTail) {
      entry.endTimeUs = secondsToMicroseconds(note.endSeconds!);
      if (!isFreeZone) {
        entry.lnMode = note.longNoteMode ?? chartLNMode;
        if (note.generatedLongNote) entry.generatedLongNote = true;
      }
    }
    notes.push(entry);
  }
  for (const mine of chart.landmineNotes) {
    notes.push({
      id: 0,
      channel: mine.channel,
      ...(resolveReplaySourceChannel(mine) !== mine.channel ? { sourceChannel: resolveReplaySourceChannel(mine) } : {}),
      type: 'mine',
      timeUs: secondsToMicroseconds(mine.seconds),
      damage: resolveLandmineGaugeEffect(mine.event, idBase, json.sourceFormat).damage,
      ...(mine.silent ? { silent: true } : {}),
    });
  }
  for (const invisible of chart.invisibleNotes) {
    notes.push({
      id: 0,
      channel: invisible.channel,
      ...(resolveReplaySourceChannel(invisible) !== invisible.channel
        ? { sourceChannel: resolveReplaySourceChannel(invisible) }
        : {}),
      type: 'invisible',
      timeUs: secondsToMicroseconds(invisible.seconds),
    });
  }
  notes.sort(compareReplayNotes);
  for (let index = 0; index < notes.length; index += 1) {
    notes[index]!.id = index;
  }

  const judgeRank: ReplayChart['judgeRank'] = resolveChartJudgeRankFacts(json, resolved);
  const timelineSource = options.dynamicJudgeRankChanges ?? [];
  if (timelineSource.length > 0) {
    judgeRank.timeline = timelineSource.map((change) => ({
      timeUs: secondsToMicroseconds(change.seconds),
      exRankValue: change.exRankValue,
    }));
  }
  if (options.stageRanks !== undefined && options.stageRanks.length > 0) {
    judgeRank.stageRanks = options.stageRanks.map((change) => ({
      timeUs: secondsToMicroseconds(change.seconds),
      rank: change.rank,
      table: change.table,
    }));
  }

  const result: ReplayChart = {
    sourceFormat: json.sourceFormat === 'bmson' ? 'bmson' : 'bms',
    laneMode: chart.laneDisplayMode,
    lnMode: chartLNMode,
    judgeRank,
    noteCount: chart.scorableNotes.length,
    notes,
  };
  if (Number.isFinite(json.metadata.bpm)) result.headerBPM = json.metadata.bpm;
  let minBPM = Infinity;
  let maxBPM = -Infinity;
  for (const { bpm } of resolved.timing.tempoPoints) {
    if (!Number.isFinite(bpm)) continue;
    minBPM = Math.min(minBPM, bpm);
    maxBPM = Math.max(maxBPM, bpm);
  }
  if (minBPM <= maxBPM) result.bpmRange = { min: minBPM, max: maxBPM };
  if (json.bmson.info.totalUnit !== undefined) result.totalUnit = json.bmson.info.totalUnit;
  if (typeof options.reversalSeconds === 'number' && Number.isFinite(options.reversalSeconds)) {
    result.reversalTimeUs = secondsToMicroseconds(options.reversalSeconds);
  }
  if (typeof options.chartSHA256 === 'string' && options.chartSHA256.length > 0) {
    result.sha256 = options.chartSHA256.toLowerCase();
  }
  if (typeof options.chartMD5 === 'string' && options.chartMD5.length > 0) {
    result.md5 = options.chartMD5.toLowerCase();
  }
  const { chartFingerprint, playFingerprint } = computeReplayFingerprints(options);
  if (chartFingerprint !== undefined) result.chartFingerprint = chartFingerprint;
  if (playFingerprint !== undefined) result.playFingerprint = playFingerprint;
  if (typeof json.metadata.title === 'string' && json.metadata.title.length > 0) result.title = json.metadata.title;
  if (typeof json.metadata.subtitle === 'string' && json.metadata.subtitle.length > 0) {
    result.subtitle = json.metadata.subtitle;
  }
  if (typeof json.metadata.artist === 'string' && json.metadata.artist.length > 0) result.artist = json.metadata.artist;
  if (typeof json.metadata.genre === 'string' && json.metadata.genre.length > 0) result.genre = json.metadata.genre;
  const playLevel = json.metadata.playLevel;
  if (
    (typeof playLevel === 'number' && Number.isFinite(playLevel)) ||
    (typeof playLevel === 'string' && playLevel !== '')
  ) {
    result.playLevel = String(playLevel);
  }
  if (typeof json.metadata.difficulty === 'number' && Number.isFinite(json.metadata.difficulty)) {
    result.difficulty = json.metadata.difficulty;
  }
  if (resolved.total.value !== undefined) {
    result.total = resolved.total.value;
  }
  if (
    options.chartOptions &&
    (Object.keys(options.chartOptions.initial).length > 0 || options.chartOptions.cues.length > 0)
  )
    result.chartOptions = structuredClone(options.chartOptions);
  if (hasChartPlayOptions(options.chartPlayOptions))
    result.chartPlayOptions = structuredClone(options.chartPlayOptions);
  return result;
}

/**
 * Chart and play fingerprints (`bmfp0:…`) of the play. Their lane-mode input is the chart's extension, which the
 * engine passes as `laneModeExtension`; without it, a 9 KEY play stands in for `.pms` (it is 9 KEY exactly when the
 * chart is `.pms` or its content says so).
 *
 * The source chart rebuilds both whatever the host did to its working copy (a DP flip baked into the chart JSON, the
 * control flow resolved away), provided `play.randomDraws` were drawn for its control flow. Without a usable source the
 * engine's chart gives the play fingerprint, and the chart fingerprint only when the play has no draws — a chart with
 * control flow has none to resolve there, so its chart fingerprint is unknown and omitted. A failure only drops a
 * field — it must never break recording.
 */
function computeReplayFingerprints(options: ReplayRecorderOptions): {
  chartFingerprint?: string;
  playFingerprint?: string;
} {
  const chartPath =
    options.laneModeExtension ?? (options.chart.laneDisplayMode.startsWith('9 KEY') ? '.pms' : undefined);
  const draws = options.play.randomDraws ?? [];
  const source = options.sourceChart;
  const played = source !== undefined ? tryResolveSource(source, draws) : undefined;
  if (source !== undefined && played !== undefined) {
    return {
      chartFingerprint: tryFingerprint(() => computeChartFingerprint(source, { chartPath })),
      playFingerprint: tryFingerprint(() => computePlayFingerprint(played, { chartPath })),
    };
  }
  const playFingerprint = tryFingerprint(() => computePlayFingerprint(options.json, { chartPath }));
  return draws.length === 0 ? { chartFingerprint: playFingerprint, playFingerprint } : { playFingerprint };
}

/** The source chart resolved with the play's draws, or `undefined` when they were not drawn for its control flow. */
function tryResolveSource(source: BeMusicJSON, draws: RandomDraws): BeMusicJSON | undefined {
  if (!hasControlFlow(source)) {
    return draws.length === 0 ? source : undefined;
  }
  try {
    return resolveBMSControlFlowWithDraws(source, draws);
  } catch {
    return undefined;
  }
}

function tryFingerprint(compute: () => string): string | undefined {
  try {
    return compute();
  } catch {
    return undefined;
  }
}

function buildNativeResult(
  summary: PlayerSummary,
  maxCombo: number | undefined,
  emptyPoorCount: number,
  declaredGauge: GaugeType,
  moneyScore: boolean,
): ReplayRulesetResult {
  // Reported the way the simulators report a ruleset result: the judgment count as `noteCount`, the DJ LEVEL, a money
  // score only where the ruleset has one, and the mid-play death flag.
  const result: ReplayRulesetResult = {
    ruleset: REPLAY_NATIVE_RULESET_ID,
    judge: {
      pgreat: summary.perfect,
      great: summary.great,
      good: summary.good,
      bad: summary.bad,
      poor: summary.poor,
      emptyPoor: emptyPoorCount,
    },
    fast: summary.fast,
    slow: summary.slow,
    exScore: summary.exScore,
    noteCount: summary.total,
    maxCombo: maxCombo ?? 0,
    djLevel: resolve____RankLabel(summary.exScore, summary.total),
    gauge: {
      type: summary.gauge?.type ?? declaredGauge,
      ...(summary.gauge?.values ? { values: { ...summary.gauge.values } } : {}),
      final:
        summary.gauge?.max === 100
          ? summary.gauge.current
          : summary.gauge !== undefined && summary.gauge.max > 0
            ? (summary.gauge.current / summary.gauge.max) * 100
            : 0,
      cleared: summary.gauge?.cleared ?? false,
    },
  };
  if (summary.minePoor !== undefined) result.minePoor = summary.minePoor;
  if (summary.fullCombo !== undefined) result.fullCombo = summary.fullCombo;

  if (summary.gauge?.failedMidPlay === true) {
    result.gauge.failedMidPlay = true;
  }
  if (moneyScore) {
    result.score = summary.score;
  }
  if (summary.course !== undefined) {
    result.course = { combo: summary.course.combo, maxCombo: summary.course.maxCombo };
  }
  return result;
}

function compareReplayNotes(left: ReplayNote, right: ReplayNote): number {
  if (left.timeUs !== right.timeUs) {
    return left.timeUs - right.timeUs;
  }
  if (left.channel !== right.channel) {
    return left.channel < right.channel ? -1 : 1;
  }
  if (left.type !== right.type) {
    return left.type < right.type ? -1 : 1;
  }
  return 0;
}

function secondsToMicroseconds(seconds: number): number {
  return Math.round(seconds * 1_000_000);
}
