import {
  collectLnobjEndEvents,
  createBeatResolver,
  isBmsBgmVolumeChangeChannel,
  isBmsDynamicVolumeChangeChannel,
  isBmsKeyVolumeChangeChannel,
  isPlayLaneSoundChannel,
  parseBmsDynamicVolumeGain,
  sortEvents,
} from '@be-music/chart';
import { basename } from 'node:path';
import { setImmediate as delayImmediate, setTimeout as delay } from 'node:timers/promises';
import { floatToInt16, throwIfAborted, type LogEntry, type LogLevel } from '@be-music/utils';
import { type BeMusicEvent, type BeMusicJson, normalizeChannel, normalizeObjectKey } from '@be-music/json';
import { resolveBmsControlFlow } from '@be-music/parser';
import {
  type RenderResult,
  type RenderSampleLoadProgress,
  type TimedSampleTrigger,
  type TimingResolver,
  collectSampleTriggers,
  createTimingResolver,
  renderSingleSample,
  renderJson,
} from '@be-music/audio-renderer';
import { createPlayerStateSignals, type PlayerStateSignals } from '../state-signals.ts';
import { findBestCandidate, findLaneSoundCandidate } from '../judging.ts';
import { type LaneBinding } from '../manual-input.ts';
import { type LongNoteMode, type TimedLandmineNote, type TimedPlayableNote } from '../playable-notes.ts';
import { formatSeconds, resolveAltModifierLabel, resolveChartVolWavGain } from '../utils.ts';
import { createNodeAudioSink, type AudioSink } from '../audio-sink.ts';
import {
  applyHighSpeedControlAction,
  resolveHighSpeedControlActionFromLaneChannels,
  resolveHighSpeedMultiplier,
  type HighSpeedControlAction,
} from './high-speed-control.ts';
import { createPlayerUiSignalBus, type PlayerUiSignalBus } from './ui-signal-bus.ts';
import { createPlayerInputSignalBus, type PlayerInputSignalBus } from './input-signal-bus.ts';
import {
  IIDX_EX_SCORE_PER_PGREAT,
  IIDX_SCORE_MAX,
  applyJudgeToSummary,
  createScoreTracker,
  type JudgeKind,
} from './scoring.ts';
import { type GrooveGaugeJudgeKind } from './groove-gauge.ts';
import { resolveBmsJudgeWindowsMsForPercent, resolveJudgeWindowsMs } from './judge-window.ts';
import {
  createBeatAtSecondsResolverFromTimingResolver,
  createBpmTimeline,
  createScrollTimeline,
  createSpeedTimeline,
  createStopBeatWindows,
} from './timeline.ts';
import { createInitialPlayerSummary, initializePlayerUiRuntime, preparePlaybackChartData } from './bootstrap.ts';

export interface PlayerUiRuntime {
  readonly tuiEnabled: boolean;
  readonly playbackEndSeconds?: number;
  start: () => void;
  stop: () => void | Promise<void>;
  dispose: () => void | Promise<void>;
  triggerPoor: (seconds: number) => void;
  clearPoor: () => void;
}

export interface PlayerInputRuntime {
  start: () => void;
  stop: () => void;
}

export interface CreatePlayerUiRuntimeContext {
  json: BeMusicJson;
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  uiFps?: number;
  judgeWindowMs: number;
  highSpeed: number;
  videoBgaStreaming?: boolean;
  showLaneChannels: boolean;
  randomPatternSummary?: string;
  stateSignals: PlayerStateSignals;
  uiSignals: PlayerUiSignalBus;
  baseDir: string;
  loadSignal?: AbortSignal;
  onBgaLoadProgress: (progress: { ratio: number; detail?: string }) => void;
}

export interface CreatePlayerInputRuntimeContext {
  mode: 'auto' | 'manual';
  inputSignals: PlayerInputSignalBus;
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>;
}

export interface PlayerOptions {
  auto?: boolean;
  autoScratch?: boolean;
  inferBmsLnTypeWhenMissing?: boolean;
  showInvisibleNotes?: boolean;
  compressor?: boolean;
  compressorThresholdDb?: number;
  compressorRatio?: number;
  compressorAttackMs?: number;
  compressorReleaseMs?: number;
  compressorMakeupDb?: number;
  limiter?: boolean;
  limiterCeilingDb?: number;
  limiterReleaseMs?: number;
  speed?: number;
  uiFps?: number;
  highSpeed?: number;
  judgeWindowMs?: number;
  debugActiveAudio?: boolean;
  leadInMs?: number;
  audio?: boolean;
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
  audioBaseDir?: string;
  audioTailSeconds?: number;
  audioOffsetMs?: number;
  audioHeadPaddingMs?: number;
  audioLeadMs?: number;
  audioLeadMaxMs?: number;
  audioLeadStepUpMs?: number;
  audioLeadStepDownMs?: number;
  tui?: boolean;
  videoBgaStreaming?: boolean;
  signal?: AbortSignal;
  onLoadProgress?: (progress: PlayerLoadProgress) => void;
  onLoadComplete?: () => void;
  onHighSpeedChange?: (highSpeed: number) => void;
  laneModeExtension?: string;
  createUiRuntime?: (context: CreatePlayerUiRuntimeContext) => Promise<PlayerUiRuntime | undefined>;
  createInputRuntime?: (context: CreatePlayerInputRuntimeContext) => PlayerInputRuntime | undefined;
  onResolvedChart?: (json: BeMusicJson) => void;
  onLog?: (entry: LogEntry) => void;
  writeOutput?: (text: string) => void;
}

export interface PlayerSummary {
  total: number;
  perfect: number;
  fast: number;
  slow: number;
  great: number;
  good: number;
  bad: number;
  poor: number;
  exScore: number;
  score: number;
  gauge?: PlayerGrooveGaugeSummary;
}

export interface PlayerGrooveGaugeSummary {
  current: number;
  max: number;
  clearThreshold: number;
  initial: number;
  effectiveTotal: number;
  cleared: boolean;
}

export interface PlayerLoadProgress {
  ratio: number;
  message: string;
  detail?: string;
  audioStatus?: PlayerLoadComponentStatus;
  graphicsStatus?: PlayerLoadComponentStatus;
}

export interface PlayerLoadComponentStatus {
  state: 'pending' | 'ready' | 'disabled';
  message: string;
  detail?: string;
}

export type PlayerInterruptReason = 'escape' | 'ctrl-c' | 'restart';

export class PlayerInterruptedError extends Error {
  readonly reason: PlayerInterruptReason;

  readonly exitCode: number;

  constructor(reason: PlayerInterruptReason) {
    super(`Player interrupted: ${reason}`);
    this.reason = reason;
    this.exitCode = reason === 'ctrl-c' ? 130 : 0;
  }
}

interface AudioSession {
  start: () => void;
  finish: () => Promise<void>;
  dispose: () => Promise<void>;
  chartStartDelayMs: number;
  backendLabel: string;
  pause: () => void;
  resume: () => void;
  getActiveAudioFiles?: () => string[];
  getActiveAudioVoiceCount?: () => number;
  triggerEvent?: (event: BeMusicEvent) => void;
  stopChannel?: (channel: string) => void;
}

export interface RandomPatternSelection {
  index: number;
  current: number;
  total: number;
}

interface ControlFlowResolutionResult {
  resolvedJson: BeMusicJson;
  randomPatterns: RandomPatternSelection[];
}

interface AudioLeadTuning {
  baseLeadMs: number;
  maxLeadMs: number;
  stepUpMs: number;
  stepDownMs: number;
}

interface OutputDynamicsConfig {
  compressorEnabled: boolean;
  compressorThresholdLinear: number;
  compressorInvRatioMinusOne: number;
  compressorAttackCoef: number;
  compressorReleaseCoef: number;
  compressorMakeupGain: number;
  limiterEnabled: boolean;
  limiterCeilingLinear: number;
  limiterReleaseCoef: number;
}

interface PlaybackClock {
  nowMs: () => number;
  isPaused: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
}

interface PlayableNotePlayback {
  offsetSeconds: number;
  durationSeconds?: number;
  sliceId?: string;
}

interface RealtimeAudioTrigger {
  event: BeMusicEvent;
  seconds: number;
  channel: string;
}

type LoggedBgaLayer = 'base' | 'poor' | 'layer' | 'layer2';

interface LoggedBgaCue {
  seconds: number;
  key?: string;
  resourcePath?: string;
  layer: LoggedBgaLayer;
}

interface NoTuiScheduledPlaybackEvent {
  seconds: number;
  order: number;
  text: string;
}

type RuntimeEventFieldValue = string | number | boolean;

type RuntimeEventField = readonly [key: string, value: RuntimeEventFieldValue | undefined];

interface NoTuiPlaybackEventTracer {
  flushUntil: (seconds: number) => void;
  logPoorTriggered: (seconds: number) => void;
  logPoorCleared: (seconds: number) => void;
}

interface NoTuiPlaybackStateLogger {
  logGaugeChange: (
    seconds: number,
    params: {
      reason: string;
      judge?: string;
      delta?: number;
    },
  ) => void;
  logComboChange: (
    seconds: number,
    params: {
      value: number;
      reason: string;
      judge?: string;
      channel?: string;
    },
  ) => void;
  logLongNoteState: (
    seconds: number,
    params: {
      channel: string;
      state: 'start' | 'release' | 'break' | 'complete';
      mode: 1 | 2 | 3;
      event: BeMusicEvent;
      resources: Readonly<Record<string, string>>;
      endSeconds?: number;
    },
  ) => void;
  logResult: (seconds: number, params: { reason: string; summary: PlayerSummary }) => void;
}

interface TimedManualJudge {
  kind: JudgeKind;
  signedDeltaMs: number;
}

interface ActiveLongNoteState {
  endSeconds: number;
  note: TimedPlayableNote;
  mode: 1 | 2 | 3;
  headJudge: TimedManualJudge;
  gaugeDrainCursorSeconds: number;
  audioStopped: boolean;
}

interface PendingAutoLongNoteState {
  endSeconds: number;
  note: TimedPlayableNote;
}

const AUTO_AUDIO_CHUNK_FRAMES = 256;
const MANUAL_AUDIO_CHUNK_FRAMES = 256;
const MANUAL_AUDIO_TARGET_LEAD_MS = 10;
const AUTO_AUDIO_TARGET_LEAD_MS = MANUAL_AUDIO_TARGET_LEAD_MS;
const TUI_FRAME_INTERVAL_MS = 1000 / 60;
const LONG_NOTE_INITIAL_HOLD_GRACE_MS = 380;
const LONG_NOTE_REPEAT_HOLD_GRACE_MS = 120;
const HELL_CHARGE_GAUGE_DRAIN_PER_SECOND = 6;
const IIDX_BAD_WINDOW_MS = 250;
const PAUSE_POLL_INTERVAL_MS = 16;
const AUDIO_TARGET_LEAD_MAX_MS = 32;
const AUDIO_TARGET_LEAD_STEP_UP_MS = 1.5;
const AUDIO_TARGET_LEAD_STEP_DOWN_MS = 0.5;
const DEBUG_ACTIVE_AUDIO_FALLBACK_SECONDS = 0.18;
const DEBUG_ACTIVE_AUDIO_SAMPLE_RATE = 44_100;
const RUNTIME_AUDIO_SAMPLE_RATE = 44_100;
const REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS = 1e-6;
const DEFAULT_COMPRESSOR_THRESHOLD_DB = -12;
const DEFAULT_COMPRESSOR_RATIO = 2.5;
const DEFAULT_COMPRESSOR_ATTACK_MS = 8;
const DEFAULT_COMPRESSOR_RELEASE_MS = 120;
const DEFAULT_COMPRESSOR_MAKEUP_DB = 0;
const DEFAULT_LIMITER_CEILING_DB = -0.3;
const DEFAULT_LIMITER_RELEASE_MS = 80;
const BGA_BASE_CHANNEL = '04';
const BGA_POOR_CHANNEL = '06';
const BGA_LAYER_CHANNEL = '07';
const BGA_LAYER2_CHANNEL = '0A';

export { applyHighSpeedControlAction, resolveHighSpeedControlActionFromLaneChannels, type HighSpeedControlAction };
export { resolveJudgeWindowsMs };

export function applyFastSlowForJudge(
  summary: Pick<PlayerSummary, 'fast' | 'slow'>,
  judge: 'PERFECT' | 'GREAT' | 'GOOD',
  signedDeltaMs: number,
): void {
  if (judge === 'GREAT' || judge === 'GOOD') {
    if (signedDeltaMs < 0) {
      summary.fast += 1;
    } else if (signedDeltaMs > 0) {
      summary.slow += 1;
    }
  }
}

function resolveManualJudgeKind(
  signedDeltaMs: number,
  judgeWindows: ReturnType<typeof resolveJudgeWindowsMs>,
  badWindowMs: number,
): JudgeKind {
  const deltaMs = Math.abs(signedDeltaMs);
  if (deltaMs <= judgeWindows.pgreat) {
    return 'PERFECT';
  }
  if (deltaMs <= judgeWindows.great) {
    return 'GREAT';
  }
  if (deltaMs <= judgeWindows.good) {
    return 'GOOD';
  }
  if (deltaMs <= badWindowMs) {
    return 'BAD';
  }
  return 'POOR';
}

function resolveManualTimedJudge(
  signedDeltaMs: number,
  judgeWindows: ReturnType<typeof resolveJudgeWindowsMs>,
  badWindowMs: number,
): TimedManualJudge {
  return {
    kind: resolveManualJudgeKind(signedDeltaMs, judgeWindows, badWindowMs),
    signedDeltaMs,
  };
}

function resolveJudgeSeverity(judge: JudgeKind): number {
  switch (judge) {
    case 'PERFECT':
      return 0;
    case 'GREAT':
      return 1;
    case 'GOOD':
      return 2;
    case 'BAD':
      return 3;
    case 'POOR':
      return 4;
  }
}

function combineLongNoteJudges(head: TimedManualJudge, tail: TimedManualJudge): TimedManualJudge {
  const headSeverity = resolveJudgeSeverity(head.kind);
  const tailSeverity = resolveJudgeSeverity(tail.kind);
  if (headSeverity > tailSeverity) {
    return head;
  }
  if (tailSeverity > headSeverity) {
    return tail;
  }
  return Math.abs(head.signedDeltaMs) >= Math.abs(tail.signedDeltaMs) ? head : tail;
}

function resolveLongNoteEndSeconds(note: TimedPlayableNote): number | undefined {
  if (typeof note.endSeconds !== 'number' || !Number.isFinite(note.endSeconds) || note.endSeconds <= note.seconds) {
    return undefined;
  }
  return note.endSeconds;
}

function resolvePlayableLongNoteMode(note: TimedPlayableNote): LongNoteMode | undefined {
  if (resolveLongNoteEndSeconds(note) === undefined) {
    return undefined;
  }
  return note.longNoteMode ?? 2;
}

function insertPendingAutoLongNote(
  pendingNotes: PendingAutoLongNoteState[],
  note: TimedPlayableNote,
  endSeconds: number,
): void {
  let insertIndex = pendingNotes.length;
  while (insertIndex > 0 && pendingNotes[insertIndex - 1]!.endSeconds > endSeconds) {
    insertIndex -= 1;
  }
  pendingNotes.splice(insertIndex, 0, { endSeconds, note });
}

export {
  extractInvisiblePlayableNotes,
  extractLandmineNotes,
  extractPlayableNotes,
  extractTimedNotes,
} from '../playable-notes.ts';

function reportLoadProgress(
  options: PlayerOptions,
  ratio: number,
  message: string,
  detail?: string,
  componentStatuses?: Partial<Pick<PlayerLoadProgress, 'audioStatus' | 'graphicsStatus'>>,
): void {
  const listener = options.onLoadProgress;
  if (!listener) {
    return;
  }
  const normalizedRatio = Math.max(0, Math.min(1, ratio));
  listener({
    ratio: normalizedRatio,
    message,
    detail,
    ...componentStatuses,
  });
}

function createTrackedPromise<T>(task: Promise<T>): TrackedPromise<T> {
  let state: TrackedPromiseState<T> = { status: 'pending' };
  const promise = task.then(
    (value) => {
      state = { status: 'fulfilled', value };
      return value;
    },
    (reason) => {
      state = { status: 'rejected', reason };
      throw reason;
    },
  );
  return {
    promise,
    getState: () => state,
  };
}

function createPlaybackPreparationProgressReporter(options: PlayerOptions): PlaybackPreparationProgressReporter {
  let uiRatio = 0;
  let audioRatio = 0;
  let audioStatus: PlayerLoadComponentStatus = createPendingLoadComponentStatus('Waiting for audio setup...');
  let graphicsStatus: PlayerLoadComponentStatus = createPendingLoadComponentStatus('Waiting for graphics setup...');

  const emit = (message: string, detail?: string): void => {
    reportLoadProgress(
      options,
      PLAYBACK_PREPARATION_BASE_RATIO +
        uiRatio * PLAYBACK_PREPARATION_UI_RATIO_WEIGHT +
        audioRatio * PLAYBACK_PREPARATION_AUDIO_RATIO_WEIGHT,
      message,
      detail,
      {
        audioStatus,
        graphicsStatus,
      },
    );
  };

  return {
    reportUiProgress: (ratio, message, detail) => {
      uiRatio = Math.max(0, Math.min(1, ratio));
      graphicsStatus = createPendingLoadComponentStatus(message, detail);
      emit(message, detail);
    },
    reportAudioProgress: (progress) => {
      audioRatio = Math.max(0, Math.min(1, progress.ratio));
      audioStatus = resolveAudioLoadComponentStatus(progress);
      emit(progress.message, progress.detail);
    },
    markUiReady: (enabled) => {
      graphicsStatus = enabled
        ? createReadyLoadComponentStatus('Ready')
        : createDisabledLoadComponentStatus('Disabled');
    },
    markAudioReady: (audioSession, audioRequested) => {
      if (audioRequested === false) {
        audioStatus = createDisabledLoadComponentStatus('Disabled');
        return;
      }
      audioStatus = audioSession
        ? createReadyLoadComponentStatus('Ready')
        : createDisabledLoadComponentStatus('Unavailable');
    },
  };
}

function createPendingLoadComponentStatus(message: string, detail?: string): PlayerLoadComponentStatus {
  return {
    state: 'pending',
    message,
    detail,
  };
}

function createReadyLoadComponentStatus(message: string): PlayerLoadComponentStatus {
  return {
    state: 'ready',
    message,
  };
}

function createDisabledLoadComponentStatus(message: string): PlayerLoadComponentStatus {
  return {
    state: 'disabled',
    message,
  };
}

function resolveAudioLoadComponentStatus(progress: AudioSessionLoadProgress): PlayerLoadComponentStatus {
  if (progress.message === 'Audio ready.') {
    return createReadyLoadComponentStatus('Ready');
  }
  if (progress.message === 'Audio disabled; skipping audio setup.') {
    return createDisabledLoadComponentStatus('Disabled');
  }
  if (progress.message === 'node-web-audio-api is unavailable; continuing without audio.') {
    return createDisabledLoadComponentStatus('Unavailable');
  }
  return createPendingLoadComponentStatus(progress.message, progress.detail);
}

function resolveOutputWriter(options: PlayerOptions): (text: string) => void {
  if (typeof options.writeOutput === 'function') {
    return options.writeOutput;
  }
  const stdout = (globalThis as { process?: { stdout?: { write?: (value: string) => unknown } } }).process?.stdout;
  if (stdout && typeof stdout.write === 'function') {
    const write = stdout.write.bind(stdout);
    return (text: string): void => {
      write(text);
    };
  }
  return (): void => undefined;
}

function emitPlayerLog(
  options: PlayerOptions,
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>,
): void {
  options.onLog?.({
    source: 'engine',
    level,
    event,
    fields: {
      emittedAtUnixMs: Date.now(),
      emittedAtMonotonicMs: performance.now(),
      ...fields,
    },
  });
}

function writeRealtimeTriggeredEventLog(
  writeOutput: (text: string) => void,
  trigger: Pick<TimedSampleTrigger, 'seconds' | 'channel' | 'sampleKey' | 'event'>,
  resourcePath?: string,
  source = 'realtime',
): void {
  const normalizedResourcePath = typeof resourcePath === 'string' ? normalizeLoggedResourcePath(resourcePath) : undefined;
  writeRuntimeEventLog(writeOutput, 'sample-trigger', [
    ['time', formatSeconds(trigger.seconds)],
    ['source', source],
    ['channel', normalizeChannel(trigger.channel)],
    ['value', trigger.event.value],
    ['sample', trigger.sampleKey],
    ['asset', normalizedResourcePath],
    ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
  ]);
}

function writeRuntimeEventLog(
  writeOutput: (text: string) => void,
  kind: string,
  fields: readonly RuntimeEventField[],
): void {
  const orderedFields = orderRuntimeEventFields(fields);
  let line = 'EVENT';
  const timeField = orderedFields.find(([key]) => key === 'time');
  if (timeField && timeField[1] !== undefined) {
    line += ` time:${String(timeField[1])}`;
  }
  line += ` kind:${kind}`;
  for (const [key, value] of orderedFields) {
    if (value === undefined) {
      continue;
    }
    if (key === 'time') {
      continue;
    }
    line += ` ${key}:${String(value)}`;
  }
  writeOutput(`${line}\n`);
}

function resolveEventResourceInfo(
  resources: Readonly<Record<string, string>>,
  event: Pick<BeMusicEvent, 'value'>,
): { sampleKey: string; resourcePath?: string } {
  const sampleKey = normalizeObjectKey(event.value);
  return {
    sampleKey,
    resourcePath: resources[sampleKey],
  };
}

function writePlayableSampleTriggerEventLog(
  writeOutput: (text: string) => void,
  event: BeMusicEvent,
  seconds: number,
  resources: Readonly<Record<string, string>>,
  source: 'auto-note' | 'auto-scratch' | 'manual-note' | 'lane-fallback',
  channel?: string,
): void {
  const { sampleKey, resourcePath } = resolveEventResourceInfo(resources, event);
  writeRealtimeTriggeredEventLog(
    writeOutput,
    {
      seconds,
      channel: channel ?? event.channel,
      sampleKey,
      event,
    },
    resourcePath,
    source,
  );
}

function writeSampleStopEventLog(
  writeOutput: (text: string) => void,
  channel: string,
  seconds: number,
  reason: 'long-note-release' | 'long-note-break',
  event?: BeMusicEvent,
  resources?: Readonly<Record<string, string>>,
): void {
  const resourceInfo = event && resources ? resolveEventResourceInfo(resources, event) : undefined;
  const normalizedResourcePath =
    typeof resourceInfo?.resourcePath === 'string' ? normalizeLoggedResourcePath(resourceInfo.resourcePath) : undefined;
  writeRuntimeEventLog(writeOutput, 'sample-stop', [
    ['time', formatSeconds(seconds)],
    ['channel', normalizeChannel(channel)],
    ['reason', reason],
    ['sample', resourceInfo?.sampleKey],
    ['asset', normalizedResourcePath],
    ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
  ]);
}

function createNoTuiPlaybackStateLogger(params: {
  writeOutput: (text: string) => void;
  summary: PlayerSummary;
}): NoTuiPlaybackStateLogger {
  const { writeOutput, summary } = params;

  return {
    logGaugeChange: (seconds, logParams): void => {
      const gauge = summary.gauge;
      if (!gauge) {
        return;
      }
      writeRuntimeEventLog(writeOutput, 'gauge-change', [
        ['time', formatSeconds(seconds)],
        ['value', formatLoggedNumericValue(gauge.current)],
        ['max', formatLoggedNumericValue(gauge.max)],
        ['delta', logParams.delta === undefined ? undefined : formatLoggedNumericValue(logParams.delta)],
        ['reason', logParams.reason],
        ['judge', logParams.judge],
        ['cleared', gauge.cleared],
      ]);
    },
    logComboChange: (seconds, logParams): void => {
      writeRuntimeEventLog(writeOutput, 'combo-change', [
        ['time', formatSeconds(seconds)],
        ['value', logParams.value],
        ['reason', logParams.reason],
        ['judge', logParams.judge],
        ['channel', logParams.channel ? normalizeChannel(logParams.channel) : undefined],
      ]);
    },
    logLongNoteState: (seconds, logParams): void => {
      const { sampleKey, resourcePath } = resolveEventResourceInfo(logParams.resources, logParams.event);
      const normalizedResourcePath =
        typeof resourcePath === 'string' ? normalizeLoggedResourcePath(resourcePath) : undefined;
      writeRuntimeEventLog(writeOutput, 'long-note', [
        ['time', formatSeconds(seconds)],
        ['channel', normalizeChannel(logParams.channel)],
        ['state', logParams.state],
        ['mode', logParams.mode],
        ['sample', sampleKey],
        ['asset', normalizedResourcePath],
        ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
        ['end', logParams.endSeconds === undefined ? undefined : formatSeconds(logParams.endSeconds)],
      ]);
    },
    logResult: (seconds, logParams): void => {
      const gauge = logParams.summary.gauge;
      writeRuntimeEventLog(writeOutput, 'result', [
        ['time', formatSeconds(seconds)],
        ['reason', logParams.reason],
        ['total', logParams.summary.total],
        ['perfect', logParams.summary.perfect],
        ['great', logParams.summary.great],
        ['good', logParams.summary.good],
        ['bad', logParams.summary.bad],
        ['poor', logParams.summary.poor],
        ['fast', logParams.summary.fast],
        ['slow', logParams.summary.slow],
        ['exScore', logParams.summary.exScore],
        ['score', logParams.summary.score],
        ['gauge', gauge ? formatLoggedNumericValue(gauge.current) : undefined],
        ['gaugeMax', gauge ? formatLoggedNumericValue(gauge.max) : undefined],
        ['gaugeCleared', gauge?.cleared],
      ]);
    },
  };
}

function createNoopPlaybackStateLogger(): NoTuiPlaybackStateLogger {
  return {
    logGaugeChange: () => undefined,
    logComboChange: () => undefined,
    logLongNoteState: () => undefined,
    logResult: () => undefined,
  };
}

function writeRealtimeVolumeEventLog(
  writeOutput: (text: string) => void,
  seconds: number,
  event: BeMusicEvent,
): void {
  const normalizedChannel = normalizeChannel(event.channel);
  const target =
    isBmsKeyVolumeChangeChannel(normalizedChannel)
      ? 'key'
      : isBmsBgmVolumeChangeChannel(normalizedChannel)
        ? 'bgm'
        : 'master';
  writeRuntimeEventLog(writeOutput, 'volume-change', [
    ['time', formatSeconds(seconds)],
    ['target', target],
    ['channel', normalizedChannel],
    ['value', event.value],
  ]);
}

function formatLoggedNumericValue(value: number, maximumFractionDigits = 3): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const rounded = value.toFixed(maximumFractionDigits);
  return rounded.replace(/(?:\.0+|(\.\d*?[1-9])0+)$/, '$1');
}

function normalizeLoggedResourcePath(resourcePath: string): string {
  return resourcePath.replaceAll('\\', '/');
}

function resolveLoggedLongNoteMode(note: TimedPlayableNote): 1 | 2 | 3 {
  const mode = resolvePlayableLongNoteMode(note);
  return mode === 2 || mode === 3 ? mode : 1;
}

function resolveLoggedMeasureLengthTimeline(
  json: BeMusicJson,
  resolver: TimingResolver,
  beatResolver: ReturnType<typeof createBeatResolver>,
): Array<{ measure: number; length: number; seconds: number }> {
  const measureLengths = new Map<number, number>();
  let maxMeasure = 0;
  for (const event of json.events) {
    if (event.measure > maxMeasure) {
      maxMeasure = event.measure;
    }
  }
  for (const measure of json.measures) {
    const index = Math.max(0, Math.floor(measure.index));
    if (index > maxMeasure) {
      maxMeasure = index;
    }
    if (!Number.isFinite(measure.length) || measure.length <= 0) {
      continue;
    }
    measureLengths.set(index, measure.length);
  }

  const timeline: Array<{ measure: number; length: number; seconds: number }> = [];
  let previousLength = 1;
  for (let measure = 0; measure <= maxMeasure; measure += 1) {
    const length = measureLengths.get(measure) ?? 1;
    if (measure > 0 && Math.abs(length - previousLength) < 1e-9) {
      previousLength = length;
      continue;
    }
    const seconds = resolver.beatToSeconds(beatResolver.measureToBeat(measure, 0));
    if (!Number.isFinite(seconds)) {
      previousLength = length;
      continue;
    }
    timeline.push({
      measure,
      length,
      seconds: Math.max(0, seconds),
    });
    previousLength = length;
  }

  return timeline;
}

function buildLoggedBgaCueTimeline(
  sortedEvents: readonly BeMusicEvent[],
  resolver: TimingResolver,
  resources: Record<string, string>,
  channel: string,
  layer: LoggedBgaLayer,
): LoggedBgaCue[] {
  const normalizedChannel = normalizeChannel(channel);
  const timeline: LoggedBgaCue[] = [];
  for (const event of sortedEvents) {
    if (normalizeChannel(event.channel) !== normalizedChannel) {
      continue;
    }
    const key = normalizeObjectKey(event.value);
    const normalizedKey = key === '00' ? undefined : key;
    timeline.push({
      seconds: Math.max(0, resolver.eventToSeconds(event)),
      key: normalizedKey,
      resourcePath: normalizedKey ? resources[normalizedKey] : undefined,
      layer,
    });
  }
  return timeline;
}

function findActiveLoggedBgaCue(timeline: readonly LoggedBgaCue[], seconds: number): LoggedBgaCue | undefined {
  let low = 0;
  let high = timeline.length - 1;
  let answer = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (timeline[mid]!.seconds <= seconds) {
      answer = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return answer >= 0 ? timeline[answer] : undefined;
}

function formatLoggedBgaCueText(cue: LoggedBgaCue): string {
  if (!cue.key) {
    return createRuntimeEventLine('bga-cue', [
      ['time', formatSeconds(cue.seconds)],
      ['layer', cue.layer],
      ['state', 'clear'],
    ]);
  }
  const normalizedResourcePath = cue.resourcePath ? normalizeLoggedResourcePath(cue.resourcePath) : undefined;
  return createRuntimeEventLine('bga-cue', [
    ['time', formatSeconds(cue.seconds)],
    ['layer', cue.layer],
    ['key', cue.key],
    ['asset', normalizedResourcePath],
    ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
  ]);
}

function createRuntimeEventLine(kind: string, fields: readonly RuntimeEventField[]): string {
  const orderedFields = orderRuntimeEventFields(fields);
  let line = 'EVENT';
  const timeField = orderedFields.find(([key]) => key === 'time');
  if (timeField && timeField[1] !== undefined) {
    line += ` time:${String(timeField[1])}`;
  }
  line += ` kind:${kind}`;
  for (const [key, value] of orderedFields) {
    if (value === undefined) {
      continue;
    }
    if (key === 'time') {
      continue;
    }
    line += ` ${key}:${String(value)}`;
  }
  return `${line}\n`;
}

function orderRuntimeEventFields(fields: readonly RuntimeEventField[]): RuntimeEventField[] {
  const timeFields: RuntimeEventField[] = [];
  const otherFields: RuntimeEventField[] = [];
  for (const field of fields) {
    if (field[0] === 'time') {
      timeFields.push(field);
      continue;
    }
    otherFields.push(field);
  }
  return [...timeFields, ...otherFields];
}

function createNoopPlaybackEventTracer(): NoTuiPlaybackEventTracer {
  return {
    flushUntil: () => undefined,
    logPoorTriggered: () => undefined,
    logPoorCleared: () => undefined,
  };
}

function createNoTuiPlaybackEventTracer(params: {
  json: BeMusicJson;
  resolver: TimingResolver;
  writeOutput: (text: string) => void;
  judgeWindowMs?: number;
}): NoTuiPlaybackEventTracer {
  const { json, resolver, writeOutput, judgeWindowMs } = params;
  const beatResolver = createBeatResolver(json);
  const sortedEvents = sortEvents(json.events);
  const scheduledEvents: NoTuiScheduledPlaybackEvent[] = [];
  let nextOrder = 0;
  const pushScheduledEvent = (seconds: number, text: string): void => {
    if (!Number.isFinite(seconds)) {
      return;
    }
    scheduledEvents.push({
      seconds: Math.max(0, seconds),
      order: nextOrder,
      text,
    });
    nextOrder += 1;
  };

  for (const point of resolveLoggedMeasureLengthTimeline(json, resolver, beatResolver)) {
    pushScheduledEvent(
      point.seconds,
      createRuntimeEventLine('measure-length-change', [
        ['time', formatSeconds(point.seconds)],
        ['measure', point.measure],
        ['length', formatLoggedNumericValue(point.length)],
      ]),
    );
  }

  for (const point of createBpmTimeline(json, resolver)) {
    pushScheduledEvent(
      point.seconds,
      createRuntimeEventLine('bpm-change', [
        ['time', formatSeconds(point.seconds)],
        ['value', formatLoggedNumericValue(point.bpm)],
      ]),
    );
  }

  for (const point of createScrollTimeline(json, beatResolver)) {
    const seconds = resolver.beatToSeconds(point.beat);
    pushScheduledEvent(
      seconds,
      createRuntimeEventLine('scroll-change', [
        ['time', formatSeconds(seconds)],
        ['value', formatLoggedNumericValue(point.speed)],
      ]),
    );
  }

  for (const point of createSpeedTimeline(json, beatResolver)) {
    const seconds = resolver.beatToSeconds(point.beat);
    pushScheduledEvent(
      seconds,
      createRuntimeEventLine('speed-change', [
        ['time', formatSeconds(seconds)],
        ['value', formatLoggedNumericValue(point.speed)],
      ]),
    );
  }

  for (const window of createStopBeatWindows(resolver)) {
    pushScheduledEvent(
      window.startSeconds,
      createRuntimeEventLine('stop', [
        ['time', formatSeconds(window.startSeconds)],
        ['state', 'start'],
        ['duration', `${formatLoggedNumericValue(window.durationSeconds)}s`],
      ]),
    );
    pushScheduledEvent(
      window.endSeconds,
      createRuntimeEventLine('stop', [
        ['time', formatSeconds(window.endSeconds)],
        ['state', 'end'],
      ]),
    );
  }

  for (const change of collectDynamicBmsJudgeRankChanges(json, resolver)) {
    const badWindow = resolveBmsJudgeWindowsMsForPercent(change.rankPercent, judgeWindowMs).bad;
    pushScheduledEvent(
      change.seconds,
      createRuntimeEventLine('judge-rank-change', [
        ['time', formatSeconds(change.seconds)],
        ['rank', formatLoggedNumericValue(change.rankPercent)],
        ['bad', `${formatLoggedNumericValue(badWindow)}ms`],
      ]),
    );
  }

  const baseBgaTimeline = buildLoggedBgaCueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_BASE_CHANNEL,
    'base',
  );
  const poorBgaTimeline = buildLoggedBgaCueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_POOR_CHANNEL,
    'poor',
  );
  const layerBgaTimeline = buildLoggedBgaCueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_LAYER_CHANNEL,
    'layer',
  );
  const layer2BgaTimeline = buildLoggedBgaCueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_LAYER2_CHANNEL,
    'layer2',
  );

  for (const cue of [...baseBgaTimeline, ...poorBgaTimeline, ...layerBgaTimeline, ...layer2BgaTimeline]) {
    pushScheduledEvent(cue.seconds, formatLoggedBgaCueText(cue));
  }

  scheduledEvents.sort((left, right) => left.seconds - right.seconds || left.order - right.order);

  const shouldUsePoorBmp00Fallback =
    typeof json.bms.poorBga !== 'string' &&
    typeof json.resources.bmp['00'] === 'string' &&
    json.resources.bmp['00'].length > 0;
  const poorFallbackKey = shouldUsePoorBmp00Fallback ? '00' : undefined;
  const poorFallbackResourcePath = poorFallbackKey ? json.resources.bmp[poorFallbackKey] : undefined;
  const poorFallbackUntilSeconds = poorBgaTimeline[0]?.seconds ?? Number.POSITIVE_INFINITY;
  let cursor = 0;
  let poorActive = false;

  const resolvePoorCueAt = (seconds: number): LoggedBgaCue | undefined => {
    const activeCue = findActiveLoggedBgaCue(poorBgaTimeline, seconds);
    if (activeCue?.key) {
      return activeCue;
    }
    if (poorFallbackKey && seconds < poorFallbackUntilSeconds) {
      return {
        seconds,
        key: poorFallbackKey,
        resourcePath: poorFallbackResourcePath,
        layer: 'poor',
      };
    }
    return undefined;
  };

  return {
    flushUntil: (seconds) => {
      const safeSeconds = Math.max(0, seconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
      while (cursor < scheduledEvents.length) {
        const scheduledEvent = scheduledEvents[cursor]!;
        if (scheduledEvent.seconds > safeSeconds) {
          break;
        }
        writeOutput(scheduledEvent.text);
        cursor += 1;
      }
    },
    logPoorTriggered: (seconds) => {
      const cue = resolvePoorCueAt(seconds);
      const normalizedResourcePath =
        typeof cue?.resourcePath === 'string' ? normalizeLoggedResourcePath(cue.resourcePath) : undefined;
      poorActive = true;
      writeOutput(
        createRuntimeEventLine('bga-poor', [
          ['time', formatSeconds(seconds)],
          ['state', 'trigger'],
          ['key', cue?.key],
          ['asset', normalizedResourcePath],
          ['file', normalizedResourcePath ? basename(normalizedResourcePath) : undefined],
        ]),
      );
    },
    logPoorCleared: (seconds) => {
      if (!poorActive) {
        return;
      }
      poorActive = false;
      writeOutput(
        createRuntimeEventLine('bga-poor', [
          ['time', formatSeconds(seconds)],
          ['state', 'clear'],
        ]),
      );
    },
  };
}

interface AudioSessionLoadProgress {
  ratio: number;
  message: string;
  detail?: string;
}

interface PlaybackPreparationProgressReporter {
  reportUiProgress: (ratio: number, message: string, detail?: string) => void;
  reportAudioProgress: (progress: AudioSessionLoadProgress) => void;
  markUiReady: (enabled: boolean) => void;
  markAudioReady: (audioSession: AudioSession | undefined, audioRequested: boolean | undefined) => void;
}

type TrackedPromiseState<T> =
  | { status: 'pending' }
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown };

interface TrackedPromise<T> {
  promise: Promise<T>;
  getState: () => TrackedPromiseState<T>;
}

const PLAYBACK_PREPARATION_BASE_RATIO = 0.18;
const PLAYBACK_PREPARATION_UI_RATIO_WEIGHT = 0.12;
const PLAYBACK_PREPARATION_AUDIO_RATIO_WEIGHT = 0.68;
const PREPARED_UI_RUNTIME_SETTLE_TIMEOUT_MS = 300;

function formatSampleLoadDetail(progress: RenderSampleLoadProgress): string {
  if (typeof progress.resolvedPath === 'string' && progress.resolvedPath.length > 0) {
    return basename(progress.resolvedPath);
  }
  if (typeof progress.samplePath === 'string' && progress.samplePath.length > 0) {
    return progress.samplePath;
  }
  return `#WAV${progress.sampleKey}`;
}

async function disposePreparedUiRuntime(
  initializedUiRuntime: Awaited<ReturnType<typeof initializePlayerUiRuntime>>,
): Promise<void> {
  await settleMaybeAsyncWithTimeout(initializedUiRuntime.uiRuntime?.stop(), PREPARED_UI_RUNTIME_SETTLE_TIMEOUT_MS);
  await settleMaybeAsyncWithTimeout(initializedUiRuntime.uiRuntime?.dispose(), PREPARED_UI_RUNTIME_SETTLE_TIMEOUT_MS);
}

async function cleanupFailedPlaybackPreparation(
  uiInitialization: TrackedPromise<Awaited<ReturnType<typeof initializePlayerUiRuntime>>>,
  audioInitialization: TrackedPromise<AudioSession | undefined>,
): Promise<void> {
  const uiState = uiInitialization.getState();
  if (uiState.status === 'fulfilled') {
    await disposePreparedUiRuntime(uiState.value);
  } else if (uiState.status === 'pending') {
    void uiInitialization.promise.then(disposePreparedUiRuntime).catch(() => undefined);
  }

  const audioState = audioInitialization.getState();
  if (audioState.status === 'fulfilled') {
    await disposeAudioSessionSafely(audioState.value);
  } else if (audioState.status === 'pending') {
    void audioInitialization.promise
      .then((audioSession) => disposeAudioSessionSafely(audioSession))
      .catch(() => undefined);
  }
}

async function initializePlaybackRuntimeResources(params: {
  resolvedJson: BeMusicJson;
  options: PlayerOptions;
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
  audioMode: 'auto' | 'manual';
}): Promise<
  Awaited<ReturnType<typeof initializePlayerUiRuntime>> & {
    audioSession: AudioSession | undefined;
  }
> {
  const progressReporter = createPlaybackPreparationProgressReporter(params.options);
  const uiInitialization = createTrackedPromise(
    initializePlayerUiRuntime({
      options: params.options,
      resolvedJson: params.resolvedJson,
      mode: params.mode,
      laneDisplayMode: params.laneDisplayMode,
      laneBindings: params.laneBindings,
      speed: params.speed,
      judgeWindowMs: params.judgeWindowMs,
      highSpeed: params.highSpeed,
      randomPatternSummary: params.randomPatternSummary,
      stateSignals: params.stateSignals,
      uiSignals: params.uiSignals,
      totalSeconds: params.totalSeconds,
      onLoadProgress: progressReporter.reportUiProgress,
    }).then((initializedUiRuntime) => {
      progressReporter.markUiReady(initializedUiRuntime.uiEnabled);
      return initializedUiRuntime;
    }),
  );
  const audioInitialization = createTrackedPromise(
    createAudioSessionIfEnabled(
      params.resolvedJson,
      params.options,
      params.audioMode,
      progressReporter.reportAudioProgress,
    ).then((audioSession) => {
      progressReporter.markAudioReady(audioSession, params.options.audio);
      return audioSession;
    }),
  );

  try {
    const [uiInitResult, audioSession] = await Promise.all([uiInitialization.promise, audioInitialization.promise]);
    return {
      ...uiInitResult,
      audioSession,
    };
  } catch (error) {
    await cleanupFailedPlaybackPreparation(uiInitialization, audioInitialization);
    throw error;
  }
}

export function resolveBmsControlFlowForPlayback(
  json: BeMusicJson,
  randomSource: () => number = Math.random,
): ControlFlowResolutionResult {
  const randomPatterns: RandomPatternSelection[] = [];
  const runtimeRandomSequence: number[] = [];

  for (const entry of json.bms.controlFlow) {
    if (entry.kind !== 'directive') {
      continue;
    }
    if (entry.command === 'RANDOM') {
      const total = parsePositiveInteger(entry.value) ?? 1;
      const randomValue = randomSource();
      runtimeRandomSequence.push(randomValue);
      randomPatterns.push({
        index: randomPatterns.length + 1,
        current: generateControlFlowRandomValue(total, randomValue),
        total,
      });
      continue;
    }
    if (entry.command === 'SETRANDOM') {
      const fixedValue = parsePositiveInteger(entry.value) ?? 1;
      randomPatterns.push({
        index: randomPatterns.length + 1,
        current: fixedValue,
        total: fixedValue,
      });
      continue;
    }
    if (entry.command === 'SWITCH') {
      runtimeRandomSequence.push(randomSource());
    }
  }

  let randomDrawIndex = 0;
  const resolvedJson = resolveBmsControlFlow(json, {
    random: () => {
      const replayValue = runtimeRandomSequence[randomDrawIndex];
      if (typeof replayValue === 'number') {
        randomDrawIndex += 1;
        return replayValue;
      }
      return randomSource();
    },
  });

  return {
    resolvedJson,
    randomPatterns,
  };
}

export function formatRandomPatternSummary(randomPatterns: ReadonlyArray<RandomPatternSelection>): string | undefined {
  const count = randomPatterns.length;
  if (count === 0) {
    return undefined;
  }
  if (count === 1) {
    const only = randomPatterns[0];
    return `RANDOM ${only.current}/${only.total}`;
  }

  let summary = 'RANDOM ';
  for (let index = 0; index < count; index += 1) {
    const pattern = randomPatterns[index]!;
    if (index > 0) {
      summary += '  ';
    }
    summary += `#${pattern.index} ${pattern.current}/${pattern.total}`;
  }
  return summary;
}

interface DynamicBmsJudgeRankChange {
  seconds: number;
  rankPercent: number;
}

interface TimedAudioVolumeEvent {
  event: BeMusicEvent;
  seconds: number;
}

function collectDynamicBmsJudgeRankChanges(
  json: BeMusicJson,
  resolver: TimingResolver = createTimingResolver(json),
): DynamicBmsJudgeRankChange[] {
  if (json.sourceFormat !== 'bms') {
    return [];
  }
  const changes: DynamicBmsJudgeRankChange[] = [];
  for (const event of sortEvents(json.events)) {
    if (normalizeChannel(event.channel) !== 'A0') {
      continue;
    }
    const raw = json.bms.exRank[normalizeObjectKey(event.value)];
    const parsed = Number.parseFloat(raw ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }
    changes.push({
      seconds: resolver.eventToSeconds(event),
      rankPercent: parsed,
    });
  }
  return changes;
}

function collectRealtimeAudioVolumeEvents(
  json: BeMusicJson,
  resolver: TimingResolver = createTimingResolver(json),
): TimedAudioVolumeEvent[] {
  if (json.sourceFormat !== 'bms') {
    return [];
  }
  const events: TimedAudioVolumeEvent[] = [];
  for (const event of sortEvents(json.events)) {
    if (!isBmsDynamicVolumeChangeChannel(event.channel)) {
      continue;
    }
    if (parseBmsDynamicVolumeGain(event.value) === undefined) {
      continue;
    }
    events.push({
      event,
      seconds: Math.max(0, resolver.eventToSeconds(event)),
    });
  }
  return events;
}

function parsePositiveInteger(value?: string): number | undefined {
  if (typeof value !== 'string' || value.length === 0) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  const normalized = Math.floor(parsed);
  if (normalized <= 0) {
    return undefined;
  }
  return normalized;
}

function generateControlFlowRandomValue(total: number, randomValue: number): number {
  const safeTotal = Math.max(1, Math.floor(total));
  if (safeTotal <= 1) {
    return 1;
  }
  const clamped = Number.isFinite(randomValue) ? Math.max(0, Math.min(0.999999999, randomValue)) : 0;
  return Math.floor(clamped * safeTotal) + 1;
}

export async function autoPlay(json: BeMusicJson, options: PlayerOptions = {}): Promise<PlayerSummary> {
  throwIfAborted(options.signal);
  const writeOutput = resolveOutputWriter(options);
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const controlFlowResolution = resolveBmsControlFlowForPlayback(json);
  const resolvedJson = controlFlowResolution.resolvedJson;
  options.onResolvedChart?.(resolvedJson);
  const randomPatternSummary = formatRandomPatternSummary(controlFlowResolution.randomPatterns);
  const inferBmsLnTypeWhenMissing = Boolean(options.inferBmsLnTypeWhenMissing);
  const speed = options.speed ?? 1;
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const timingResolver = createTimingResolver(resolvedJson);
  const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(timingResolver);
  const realtimeAudioVolumeEvents = collectRealtimeAudioVolumeEvents(resolvedJson, timingResolver);
  const realtimeAudioTriggers = collectRealtimeAudioTriggers(
    resolvedJson,
    inferBmsLnTypeWhenMissing,
    (channel) => !isInvisiblePlayLaneSoundChannel(channel),
    timingResolver,
  );
  const realtimeAudioEndSeconds =
    options.audio === false
      ? 0
      : Math.max(realtimeAudioTriggers.at(-1)?.seconds ?? 0, realtimeAudioVolumeEvents.at(-1)?.seconds ?? 0);
  const playbackChart = preparePlaybackChartData(
    resolvedJson,
    {
      showInvisibleNotes: options.showInvisibleNotes,
      laneModeExtension: options.laneModeExtension,
    },
    inferBmsLnTypeWhenMissing,
    realtimeAudioEndSeconds,
  );
  const {
    notes,
    landmineNotes,
    invisibleNotes,
    renderNotes,
    laneBindings,
    laneDisplayMode,
    activeFreeZoneChannels,
    scorableNotes,
    inputTokenToChannels,
  } = playbackChart;
  let { totalSeconds } = playbackChart;
  const keyMap = new Map(laneBindings.map((binding) => [binding.channel, binding.keyLabel]));
  const { summary, applyGaugeJudge } = createInitialPlayerSummary(scorableNotes.length, resolvedJson.metadata.total);
  const scoreTracker = createScoreTracker();
  let combo = 0;
  let interruptedReason: PlayerInterruptReason | undefined;
  let highSpeed = resolveHighSpeedMultiplier(options.highSpeed);
  const stateSignals = createPlayerStateSignals(highSpeed);
  const uiSignals = createPlayerUiSignalBus({
    currentBeat: 0,
    currentSeconds: 0,
    totalSeconds,
    summary,
    notes: renderNotes,
  });
  const inputSignals = createPlayerInputSignalBus();
  const {
    uiRuntime,
    totalSeconds: playbackTotalSeconds,
    uiEnabled,
    activeStateSignals,
    audioSession,
  } = await initializePlaybackRuntimeResources({
    resolvedJson,
    options,
    mode: 'AUTO',
    laneDisplayMode,
    laneBindings,
    speed,
    judgeWindowMs: 0,
    highSpeed,
    randomPatternSummary,
    stateSignals,
    uiSignals,
    totalSeconds,
    audioMode: 'auto',
  });
  totalSeconds = playbackTotalSeconds;

  const inputRuntime = options.createInputRuntime?.({
    mode: 'auto',
    inputSignals,
    inputTokenToChannels,
  });
  const playbackEventTracer = uiEnabled
    ? createNoopPlaybackEventTracer()
    : createNoTuiPlaybackEventTracer({
        json: resolvedJson,
        resolver: timingResolver,
        writeOutput,
      });
  const playbackStateLogger = uiEnabled ? createNoopPlaybackStateLogger() : createNoTuiPlaybackStateLogger({ writeOutput, summary });
  const applyLoggedGaugeJudge = (seconds: number, judge: GrooveGaugeJudgeKind, reason = 'judge'): void => {
    const previousGauge = summary.gauge?.current;
    applyGaugeJudge(judge);
    const nextGauge = summary.gauge?.current;
    playbackStateLogger.logGaugeChange(seconds, {
      reason,
      judge,
      delta: previousGauge !== undefined && nextGauge !== undefined ? nextGauge - previousGauge : undefined,
    });
  };
  const setLoggedCombo = (seconds: number, value: number, reason: string, judge?: string, channel?: string): void => {
    combo = value;
    playbackStateLogger.logComboChange(seconds, {
      value,
      reason,
      judge,
      channel,
    });
  };

  throwIfAborted(options.signal);
  const audioBackendLabel = resolveAudioBackendLabel(options, audioSession);
  const autoDebugAudioEstimator = options.debugActiveAudio
    ? await createDebugActiveAudioEstimator(resolvedJson, {
        baseDir: options.audioBaseDir,
        inferBmsLnTypeWhenMissing,
        signal: options.signal,
      })
    : undefined;
  throwIfAborted(options.signal);
  reportLoadProgress(options, 1, 'Ready');
  options.onLoadComplete?.();
  emitPlayerLog(options, 'info', 'playback.prepared', {
    mode: 'auto',
    uiEnabled,
    audioEnabled: audioSession !== undefined,
    totalSeconds,
  });
  const resolveDebugActiveAudioState = (
    nowSeconds: number,
  ): { activeAudioFiles?: string[]; activeAudioVoiceCount?: number } => {
    if (options.debugActiveAudio !== true) {
      return {};
    }
    const sessionVoiceCount = audioSession?.getActiveAudioVoiceCount?.() ?? 0;
    const sessionFiles = audioSession?.getActiveAudioFiles?.() ?? [];
    if (sessionVoiceCount > 0 || sessionFiles.length > 0) {
      return {
        activeAudioFiles: sessionFiles,
        activeAudioVoiceCount: sessionVoiceCount,
      };
    }
    const estimated = autoDebugAudioEstimator?.resolve(nowSeconds);
    return {
      activeAudioFiles: estimated?.activeAudioFiles ?? [],
      activeAudioVoiceCount: estimated?.activeAudioVoiceCount ?? 0,
    };
  };
  const highSpeedModifierLabel = resolveAltModifierLabel();
  const publishUiFrame = (seconds: number, beat: number): void => {
    if (!uiEnabled) {
      return;
    }
    const debugState = resolveDebugActiveAudioState(seconds);
    uiSignals.publishFrame({
      currentBeat: beat,
      currentSeconds: seconds,
      totalSeconds,
      summary,
      notes: renderNotes,
      audioBackend: audioBackendLabel,
      activeAudioFiles: debugState.activeAudioFiles,
      activeAudioVoiceCount: debugState.activeAudioVoiceCount,
    });
  };

  if (!uiEnabled) {
    writeOutput('Auto play start\n');
    writeOutput(`Lane mode: ${laneDisplayMode}\n`);
    if (randomPatternSummary) {
      writeOutput(`${randomPatternSummary}\n`);
    }
    printLaneMap(writeOutput, laneBindings);
    writeOutput('Press Space to pause/resume. Press Shift+R to restart.\n');
    writeOutput('Press Ctrl+C or Esc to quit.\n');
    writeOutput(`Press ${highSpeedModifierLabel}+odd lane key to decrease HIGH-SPEED.\n`);
    writeOutput(`Press ${highSpeedModifierLabel}+even lane key to increase HIGH-SPEED.\n`);
  } else {
    emitPlayerLog(options, 'info', 'ui.start', {
      mode: 'auto',
    });
    uiRuntime?.start();
    activeStateSignals?.publishJudgeCombo('READY', 0);
    publishUiFrame(0, 0);
    emitPlayerLog(options, 'debug', 'ui.initial-frame.published', {
      mode: 'auto',
      seconds: 0,
      beat: 0,
    });
  }

  let playbackClock: PlaybackClock | undefined;
  let realtimeAudioVolumeEventIndex = 0;
  let realtimeAudioTriggerIndex = 0;
  const pendingAutoLongNotes: PendingAutoLongNoteState[] = [];

  const togglePause = (): void => {
    if (!playbackClock) {
      return;
    }
    if (playbackClock.isPaused()) {
      if (!playbackClock.resume()) {
        return;
      }
      audioSession?.resume();
      activeStateSignals?.setPaused(false);
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'playback-state', [
          ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
          ['state', 'resume'],
        ]);
      }
      return;
    }

    if (!playbackClock.pause()) {
      return;
    }
    audioSession?.pause();
    activeStateSignals?.setPaused(true);
    if (!uiEnabled) {
      writeRuntimeEventLog(writeOutput, 'playback-state', [
        ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
        ['state', 'pause'],
      ]);
    }
  };
  const consumeInputCommands = (): void => {
    const commands = inputSignals.drainCommands();
    for (const command of commands) {
      if (interruptedReason) {
        continue;
      }
      if (command.kind === 'interrupt') {
        if (!uiEnabled && playbackClock) {
          writeRuntimeEventLog(writeOutput, 'interrupt', [
            ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
            ['reason', command.reason],
          ]);
        }
        interruptedReason = command.reason;
        continue;
      }
      if (command.kind === 'toggle-pause') {
        togglePause();
        continue;
      }
      if (command.kind === 'high-speed') {
        const nextHighSpeed = applyHighSpeedControlAction(highSpeed, command.action);
        if (nextHighSpeed !== highSpeed) {
          highSpeed = nextHighSpeed;
          activeStateSignals?.setHighSpeed(highSpeed);
          options.onHighSpeedChange?.(highSpeed);
        }
        if (!uiEnabled) {
          writeRuntimeEventLog(writeOutput, 'high-speed-change', [
            ['time', formatSeconds(playbackClock ? elapsedMsToGameSeconds(playbackClock.nowMs(), speed) : 0)],
            ['value', `x${highSpeed.toFixed(1)}`],
          ]);
        }
      }
    }
  };

  const triggerRealtimeAudioVolumeEvents = (referenceSeconds: number): void => {
    const triggerEvent = audioSession?.triggerEvent;
    if (!triggerEvent) {
      return;
    }
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (realtimeAudioVolumeEventIndex < realtimeAudioVolumeEvents.length) {
      const volumeEvent = realtimeAudioVolumeEvents[realtimeAudioVolumeEventIndex]!;
      if (volumeEvent.seconds > safeReferenceSeconds) {
        break;
      }
      if (!uiEnabled) {
        writeRealtimeVolumeEventLog(writeOutput, volumeEvent.seconds, volumeEvent.event);
      }
      triggerEvent(volumeEvent.event);
      realtimeAudioVolumeEventIndex += 1;
    }
  };

  const triggerRealtimeAudioEvents = (referenceSeconds: number): void => {
    const triggerEvent = audioSession?.triggerEvent;
    if (!triggerEvent) {
      return;
    }
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (realtimeAudioTriggerIndex < realtimeAudioTriggers.length) {
      const trigger = realtimeAudioTriggers[realtimeAudioTriggerIndex]!;
      if (trigger.seconds > safeReferenceSeconds) {
        break;
      }
      if (!uiEnabled) {
        writeRealtimeTriggeredEventLog(writeOutput, trigger, resolvedJson.resources.wav[trigger.sampleKey], 'realtime');
      }
      triggerEvent(trigger.event);
      realtimeAudioTriggerIndex += 1;
    }
  };

  const applyAutoPerfectJudge = (note: TimedPlayableNote, judgeSeconds: number): void => {
    applyJudgeToSummary(summary, 'PERFECT', scoreTracker);
    applyLoggedGaugeJudge(judgeSeconds, 'PERFECT');
    setLoggedCombo(judgeSeconds, combo + 1, 'judge', 'PERFECT', note.channel);

    const key = resolveNoteKeyLabel(note.channel, keyMap);
    if (!uiEnabled) {
      writeRuntimeEventLog(writeOutput, 'auto-judge', [
        ['time', formatSeconds(judgeSeconds)],
        ['result', 'PERFECT'],
        ['channel', note.channel],
        ['key', key],
      ]);
      return;
    }
    activeStateSignals?.publishJudgeCombo('PERFECT', combo, note.channel);
    publishUiFrame(judgeSeconds, beatAtSeconds(judgeSeconds));
  };

  const drainPendingAutoLongNotes = (referenceSeconds: number): void => {
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (pendingAutoLongNotes.length > 0) {
      const pending = pendingAutoLongNotes[0]!;
      if (pending.endSeconds > safeReferenceSeconds) {
        break;
      }
      pendingAutoLongNotes.shift();
      playbackStateLogger.logLongNoteState(pending.endSeconds, {
        channel: pending.note.channel,
        state: 'complete',
        mode: resolveLoggedLongNoteMode(pending.note),
        event: pending.note.event,
        resources: resolvedJson.resources.wav,
        endSeconds: pending.endSeconds,
      });
      applyAutoPerfectJudge(pending.note, pending.endSeconds);
    }
  };

  inputRuntime?.start();

  try {
    await delay(leadInMs);
    consumeInputCommands();
    if (!interruptedReason) {
      emitPlayerLog(options, 'info', 'audio.start', {
        mode: 'auto',
      });
      audioSession?.start();
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'playback-start', [
          ['time', formatSeconds(0)],
          ['mode', 'auto'],
        ]);
      }

      const chartClock = createPlaybackClock(
        performance.now() + audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0),
      );
      playbackClock = chartClock;
      playbackEventTracer.flushUntil(0);
      const badWindowSeconds = IIDX_BAD_WINDOW_MS / 1000;
      let landmineExpireCursor = 0;
      let invisibleExpireCursor = 0;

      const markExpiredLandmines = (referenceSeconds: number): void => {
        while (landmineExpireCursor < landmineNotes.length) {
          const landmine = landmineNotes[landmineExpireCursor]!;
          if (landmine.judged) {
            landmineExpireCursor += 1;
            continue;
          }
          if (referenceSeconds - landmine.seconds <= badWindowSeconds) {
            break;
          }
          landmine.judged = true;
          landmineExpireCursor += 1;
        }
      };
      const markExpiredInvisibleNotes = (referenceSeconds: number): void => {
        while (invisibleExpireCursor < invisibleNotes.length) {
          const invisible = invisibleNotes[invisibleExpireCursor]!;
          if (invisible.judged) {
            invisibleExpireCursor += 1;
            continue;
          }
          if (referenceSeconds - invisible.seconds <= badWindowSeconds) {
            break;
          }
          invisible.judged = true;
          invisibleExpireCursor += 1;
        }
      };

      const renderUntil = async (targetMs: number): Promise<void> => {
        while (true) {
          consumeInputCommands();
          if (interruptedReason) {
            return;
          }
          const nowMs = chartClock.nowMs();
          if (nowMs >= targetMs) {
            const nowSec = elapsedMsToGameSeconds(nowMs, speed);
            playbackEventTracer.flushUntil(nowSec);
            triggerRealtimeAudioVolumeEvents(nowSec);
            triggerRealtimeAudioEvents(nowSec);
            drainPendingAutoLongNotes(nowSec);
            return;
          }
          if (chartClock.isPaused()) {
            await waitPrecise(PAUSE_POLL_INTERVAL_MS);
            continue;
          }
          const nowSec = elapsedMsToGameSeconds(nowMs, speed);
          playbackEventTracer.flushUntil(nowSec);
          triggerRealtimeAudioVolumeEvents(nowSec);
          triggerRealtimeAudioEvents(nowSec);
          drainPendingAutoLongNotes(nowSec);
          markExpiredLandmines(nowSec);
          markExpiredInvisibleNotes(nowSec);
          const nowBeat = beatAtSeconds(nowSec);
          publishUiFrame(nowSec, nowBeat);
          await waitPrecise(Math.max(1, Math.min(TUI_FRAME_INTERVAL_MS, targetMs - nowMs)));
        }
      };

      for (const note of scorableNotes) {
        if (interruptedReason) {
          break;
        }
        const scheduledMs = (note.seconds * 1000) / speed;
        await renderUntil(scheduledMs);
        if (interruptedReason) {
          break;
        }

        note.judged = true;
        if (!uiEnabled) {
          writePlayableSampleTriggerEventLog(
            writeOutput,
            note.event,
            note.seconds,
            resolvedJson.resources.wav,
            'auto-note',
            note.channel,
          );
        }
        audioSession?.triggerEvent?.(note.event);
        const endSeconds = resolveLongNoteEndSeconds(note);
        if (uiEnabled) {
          uiSignals.pushCommand({ kind: 'flash-lane', channel: note.channel });
        }
        if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
          note.visibleUntilBeat = note.endBeat;
          if (uiEnabled) {
            uiSignals.pushCommand({ kind: 'hold-lane-until-beat', channel: note.channel, beat: note.endBeat });
          }
        }
        if (endSeconds !== undefined) {
          playbackStateLogger.logLongNoteState(note.seconds, {
            channel: note.channel,
            state: 'start',
            mode: resolveLoggedLongNoteMode(note),
            event: note.event,
            resources: resolvedJson.resources.wav,
            endSeconds,
          });
          insertPendingAutoLongNote(pendingAutoLongNotes, note, endSeconds);
          if (uiEnabled) {
            publishUiFrame(note.seconds, note.beat);
          }
        } else {
          applyAutoPerfectJudge(note, note.seconds);
        }

        markExpiredLandmines(note.seconds);
        markExpiredInvisibleNotes(note.seconds);
      }

      if (!interruptedReason) {
        const totalScheduledMs = (totalSeconds * 1000) / speed;
        await renderUntil(totalScheduledMs);
        playbackEventTracer.flushUntil(totalSeconds);
        drainPendingAutoLongNotes(totalSeconds);
        markExpiredLandmines(totalSeconds + badWindowSeconds);
        markExpiredInvisibleNotes(totalSeconds + badWindowSeconds);
        for (const landmine of landmineNotes) {
          landmine.judged = true;
        }
        for (const invisible of invisibleNotes) {
          invisible.judged = true;
        }
        publishUiFrame(totalSeconds, beatAtSeconds(totalSeconds));
      }
    }
  } finally {
    if (interruptedReason) {
      await disposeAudioSessionSafely(audioSession);
    } else {
      await finalizeAudioSessionSafely(audioSession);
    }
    inputRuntime?.stop();
    await settleMaybeAsyncWithTimeout(uiRuntime?.stop(), 300);
    await settleMaybeAsyncWithTimeout(uiRuntime?.dispose(), 300);
  }

  if (interruptedReason === 'ctrl-c') {
    throw new PlayerInterruptedError(interruptedReason);
  }
  if (interruptedReason === 'restart') {
    throw new PlayerInterruptedError(interruptedReason);
  }

  if (!uiEnabled) {
    writeRuntimeEventLog(writeOutput, 'playback-end', [
      ['time', formatSeconds(totalSeconds)],
      ['reason', 'complete'],
    ]);
    playbackStateLogger.logResult(totalSeconds, {
      reason: 'complete',
      summary,
    });
  }
  writeOutput(renderSummary(summary));
  return summary;
}

export async function manualPlay(json: BeMusicJson, options: PlayerOptions = {}): Promise<PlayerSummary> {
  throwIfAborted(options.signal);
  const writeOutput = resolveOutputWriter(options);
  reportLoadProgress(options, 0.02, 'Resolving chart...');
  const controlFlowResolution = resolveBmsControlFlowForPlayback(json);
  const resolvedJson = controlFlowResolution.resolvedJson;
  options.onResolvedChart?.(resolvedJson);
  const randomPatternSummary = formatRandomPatternSummary(controlFlowResolution.randomPatterns);
  const inferBmsLnTypeWhenMissing = Boolean(options.inferBmsLnTypeWhenMissing);
  const autoScratchEnabled = options.autoScratch === true;
  const speed = options.speed ?? 1;
  let judgeWindows = resolveJudgeWindowsMs(resolvedJson, options.judgeWindowMs);
  let badWindowMs = judgeWindows.bad;
  let badWindowSeconds = badWindowMs / 1000;
  const timingResolver = createTimingResolver(resolvedJson);
  const dynamicJudgeRankChanges = collectDynamicBmsJudgeRankChanges(resolvedJson, timingResolver);
  const realtimeAudioVolumeEvents = collectRealtimeAudioVolumeEvents(resolvedJson, timingResolver);
  let dynamicJudgeRankCursor = 0;
  let maxBadWindowMs = badWindowMs;
  for (const change of dynamicJudgeRankChanges) {
    const dynamicBadWindowMs = resolveBmsJudgeWindowsMsForPercent(change.rankPercent, options.judgeWindowMs).bad;
    if (dynamicBadWindowMs > maxBadWindowMs) {
      maxBadWindowMs = dynamicBadWindowMs;
    }
  }
  const leadInMs = options.leadInMs ?? 1500;
  const audioOffsetMs = options.audioOffsetMs ?? 0;
  const beatAtSeconds = createBeatAtSecondsResolverFromTimingResolver(timingResolver);
  const nonPlayableRealtimeAudioTriggers = collectRealtimeAudioTriggers(
    resolvedJson,
    inferBmsLnTypeWhenMissing,
    (channel) => !isPlayLaneSoundChannel(channel),
    timingResolver,
  );
  const nonPlayableRealtimeAudioEndSeconds =
    options.audio === false
      ? 0
      : Math.max(nonPlayableRealtimeAudioTriggers.at(-1)?.seconds ?? 0, realtimeAudioVolumeEvents.at(-1)?.seconds ?? 0);
  const playbackChart = preparePlaybackChartData(
    resolvedJson,
    {
      showInvisibleNotes: options.showInvisibleNotes,
      laneModeExtension: options.laneModeExtension,
    },
    inferBmsLnTypeWhenMissing,
    nonPlayableRealtimeAudioEndSeconds,
  );
  const {
    notes,
    landmineNotes,
    invisibleNotes,
    renderNotes,
    laneBindings,
    laneDisplayMode,
    activeFreeZoneChannels,
    scorableNotes,
    inputTokenToChannels,
  } = playbackChart;
  let { totalSeconds } = playbackChart;
  const scratchPlayableChannels = new Set(
    laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel),
  );

  const { summary, applyGaugeJudge, applyGaugeDelta } = createInitialPlayerSummary(
    scorableNotes.length,
    resolvedJson.metadata.total,
  );
  const scoreTracker = createScoreTracker();
  let combo = 0;
  let highSpeed = resolveHighSpeedMultiplier(options.highSpeed);
  const stateSignals = createPlayerStateSignals(highSpeed);
  const uiSignals = createPlayerUiSignalBus({
    currentBeat: 0,
    currentSeconds: 0,
    totalSeconds,
    summary,
    notes: renderNotes,
  });
  const inputSignals = createPlayerInputSignalBus();
  const {
    uiRuntime,
    totalSeconds: playbackTotalSeconds,
    uiEnabled,
    activeStateSignals,
    audioSession,
  } = await initializePlaybackRuntimeResources({
    resolvedJson,
    options,
    mode: autoScratchEnabled ? 'AUTO SCRATCH' : 'MANUAL',
    laneDisplayMode,
    laneBindings,
    speed,
    judgeWindowMs: badWindowMs,
    highSpeed,
    randomPatternSummary,
    stateSignals,
    uiSignals,
    totalSeconds,
    audioMode: 'manual',
  });
  totalSeconds = playbackTotalSeconds;

  const inputRuntime = options.createInputRuntime?.({
    mode: 'manual',
    inputSignals,
    inputTokenToChannels,
  });
  const playbackEventTracer = uiEnabled
    ? createNoopPlaybackEventTracer()
    : createNoTuiPlaybackEventTracer({
        json: resolvedJson,
        resolver: timingResolver,
        writeOutput,
        judgeWindowMs: options.judgeWindowMs,
      });
  const playbackStateLogger = uiEnabled ? createNoopPlaybackStateLogger() : createNoTuiPlaybackStateLogger({ writeOutput, summary });
  const applyLoggedGaugeJudge = (seconds: number, judge: GrooveGaugeJudgeKind, reason = 'judge'): void => {
    const previousGauge = summary.gauge?.current;
    applyGaugeJudge(judge);
    const nextGauge = summary.gauge?.current;
    playbackStateLogger.logGaugeChange(seconds, {
      reason,
      judge,
      delta: previousGauge !== undefined && nextGauge !== undefined ? nextGauge - previousGauge : undefined,
    });
  };
  const applyLoggedGaugeDelta = (seconds: number, delta: number, reason: string): void => {
    const previousGauge = summary.gauge?.current;
    applyGaugeDelta(delta);
    const nextGauge = summary.gauge?.current;
    if (previousGauge === nextGauge) {
      return;
    }
    playbackStateLogger.logGaugeChange(seconds, {
      reason,
      delta: previousGauge !== undefined && nextGauge !== undefined ? nextGauge - previousGauge : undefined,
    });
  };
  const setLoggedCombo = (seconds: number, value: number, reason: string, judge?: string, channel?: string): void => {
    combo = value;
    playbackStateLogger.logComboChange(seconds, {
      value,
      reason,
      judge,
      channel,
    });
  };

  throwIfAborted(options.signal);
  const audioBackendLabel = resolveAudioBackendLabel(options, audioSession);
  reportLoadProgress(options, 1, 'Ready');
  options.onLoadComplete?.();
  emitPlayerLog(options, 'info', 'playback.prepared', {
    mode: 'manual',
    uiEnabled,
    audioEnabled: audioSession !== undefined,
    totalSeconds,
  });
  const resolveDebugActiveAudioState = (): { activeAudioFiles?: string[]; activeAudioVoiceCount?: number } => {
    if (options.debugActiveAudio !== true) {
      return {};
    }
    return {
      activeAudioFiles: audioSession?.getActiveAudioFiles?.() ?? [],
      activeAudioVoiceCount: audioSession?.getActiveAudioVoiceCount?.() ?? 0,
    };
  };
  const highSpeedModifierLabel = resolveAltModifierLabel();
  const publishUiFrame = (seconds: number, beat: number): void => {
    if (!uiEnabled) {
      return;
    }
    const debugState = resolveDebugActiveAudioState();
    uiSignals.publishFrame({
      currentBeat: beat,
      currentSeconds: seconds,
      totalSeconds,
      summary,
      notes: renderNotes,
      audioBackend: audioBackendLabel,
      activeAudioFiles: debugState.activeAudioFiles,
      activeAudioVoiceCount: debugState.activeAudioVoiceCount,
    });
  };

  if (!uiEnabled) {
    writeOutput('Manual play start\n');
    writeOutput(`Lane mode: ${laneDisplayMode}\n`);
    if (randomPatternSummary) {
      writeOutput(`${randomPatternSummary}\n`);
    }
    if (autoScratchEnabled) {
      writeOutput('Mode: AUTO SCRATCH (16ch/26ch only)\n');
    }
    writeOutput(
      `Judge window: PGREAT<=${judgeWindows.pgreat.toFixed(2)}ms GREAT<=${judgeWindows.great.toFixed(2)}ms GOOD<=${judgeWindows.good.toFixed(2)}ms BAD<=${Math.round(badWindowMs)}ms\n`,
    );
    writeOutput('Press Space to pause/resume.\n');
    writeOutput('Press Shift+R to restart.\n');
    writeOutput(`Press ${highSpeedModifierLabel}+odd lane key to decrease HIGH-SPEED.\n`);
    writeOutput(`Press ${highSpeedModifierLabel}+even lane key to increase HIGH-SPEED.\n`);
    writeOutput('Press Ctrl+C to quit.\n');
    writeOutput('Press Esc to stop and open result.\n');
    printLaneMap(writeOutput, laneBindings);
  } else {
    emitPlayerLog(options, 'info', 'ui.start', {
      mode: 'manual',
    });
    uiRuntime?.start();
    activeStateSignals?.publishJudgeCombo('READY', 0);
    publishUiFrame(0, 0);
    emitPlayerLog(options, 'debug', 'ui.initial-frame.published', {
      mode: 'manual',
      seconds: 0,
      beat: 0,
    });
  }

  await delay(leadInMs);
  inputRuntime?.start();
  emitPlayerLog(options, 'info', 'audio.start', {
    mode: 'manual',
  });
  audioSession?.start();
  if (!uiEnabled) {
    writeRuntimeEventLog(writeOutput, 'playback-start', [
      ['time', formatSeconds(0)],
      ['mode', autoScratchEnabled ? 'auto-scratch' : 'manual'],
    ]);
  }

  const playbackClock = createPlaybackClock(performance.now() + audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0));
  playbackEventTracer.flushUntil(0);
  const horizon = (totalSeconds * 1000) / speed + leadInMs + maxBadWindowMs + 1000;
  let interruptedReason: PlayerInterruptReason | undefined;
  const longHoldUntilMsByChannel = new Map<string, number>();
  const activeLongNotesByChannel = new Map<string, ActiveLongNoteState>();
  const longNoteSuppressUntilSecondsByChannel = new Map<string, number>();
  const activeKittyPressedChannels = new Set<string>();
  const autoScratchNotes = autoScratchEnabled
    ? scorableNotes.filter((note) => scratchPlayableChannels.has(note.channel))
    : [];
  let autoScratchCursor = 0;
  let scorableMissCursor = 0;
  let landmineExpireCursor = 0;
  let invisibleExpireCursor = 0;
  let realtimeAudioVolumeEventIndex = 0;
  let remainingScorableNotes = scorableNotes.length;
  let remainingLandmineNotes = landmineNotes.length;
  let remainingInvisibleNotes = invisibleNotes.length;
  let nonPlayableRealtimeAudioTriggerIndex = 0;
  const pendingAutoScratchLongNotes: PendingAutoLongNoteState[] = [];

  const markScorableJudged = (note: TimedPlayableNote): boolean => {
    if (note.judged) {
      return false;
    }
    note.judged = true;
    remainingScorableNotes -= 1;
    return true;
  };

  const markLandmineJudged = (note: TimedLandmineNote): boolean => {
    if (note.judged) {
      return false;
    }
    note.judged = true;
    remainingLandmineNotes -= 1;
    return true;
  };

  const markInvisibleJudged = (note: TimedPlayableNote): boolean => {
    if (note.judged) {
      return false;
    }
    note.judged = true;
    remainingInvisibleNotes -= 1;
    return true;
  };

  const markExpiredLandmines = (referenceSeconds: number): void => {
    while (landmineExpireCursor < landmineNotes.length) {
      const landmine = landmineNotes[landmineExpireCursor]!;
      if (landmine.judged) {
        landmineExpireCursor += 1;
        continue;
      }
      if (referenceSeconds - landmine.seconds <= badWindowSeconds) {
        break;
      }
      markLandmineJudged(landmine);
      landmineExpireCursor += 1;
    }
  };

  const markExpiredInvisibleNotes = (referenceSeconds: number): void => {
    while (invisibleExpireCursor < invisibleNotes.length) {
      const invisible = invisibleNotes[invisibleExpireCursor]!;
      if (invisible.judged) {
        invisibleExpireCursor += 1;
        continue;
      }
      if (referenceSeconds - invisible.seconds <= badWindowSeconds) {
        break;
      }
      markInvisibleJudged(invisible);
      invisibleExpireCursor += 1;
    }
  };

  const advanceDynamicJudgeRankChanges = (referenceSeconds: number): void => {
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (dynamicJudgeRankCursor < dynamicJudgeRankChanges.length) {
      const change = dynamicJudgeRankChanges[dynamicJudgeRankCursor]!;
      if (change.seconds > safeReferenceSeconds) {
        break;
      }
      judgeWindows = resolveBmsJudgeWindowsMsForPercent(change.rankPercent, options.judgeWindowMs);
      badWindowMs = judgeWindows.bad;
      badWindowSeconds = badWindowMs / 1000;
      dynamicJudgeRankCursor += 1;
    }
  };

  const applyAutoScratchJudgements = (referenceSeconds: number): void => {
    if (!autoScratchEnabled) {
      return;
    }
    while (autoScratchCursor < autoScratchNotes.length) {
      const note = autoScratchNotes[autoScratchCursor]!;
      if (note.judged) {
        autoScratchCursor += 1;
        continue;
      }
      if (referenceSeconds < note.seconds) {
        break;
      }
      autoScratchCursor += 1;
      if (!markScorableJudged(note)) {
        continue;
      }
      if (!uiEnabled) {
        writePlayableSampleTriggerEventLog(
          writeOutput,
          note.event,
          note.seconds,
          resolvedJson.resources.wav,
          'auto-scratch',
          note.channel,
        );
      }
      audioSession?.triggerEvent?.(note.event);
      const endSeconds = resolveLongNoteEndSeconds(note);
      if (uiEnabled) {
        uiSignals.pushCommand({ kind: 'flash-lane', channel: note.channel });
      }
      if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
        note.visibleUntilBeat = note.endBeat;
        if (uiEnabled) {
          uiSignals.pushCommand({ kind: 'hold-lane-until-beat', channel: note.channel, beat: note.endBeat });
        }
      }
      if (endSeconds !== undefined) {
        playbackStateLogger.logLongNoteState(note.seconds, {
          channel: note.channel,
          state: 'start',
          mode: resolveLoggedLongNoteMode(note),
          event: note.event,
          resources: resolvedJson.resources.wav,
          endSeconds,
        });
        insertPendingAutoLongNote(pendingAutoScratchLongNotes, note, endSeconds);
        continue;
      }
      applyJudgeToSummary(summary, 'PERFECT', scoreTracker);
      applyLoggedGaugeJudge(referenceSeconds, 'PERFECT');
      uiSignals.pushCommand({ kind: 'clear-poor-bga' });
      setLoggedCombo(referenceSeconds, combo + 1, 'judge', 'PERFECT', note.channel);
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'auto-judge', [
          ['time', formatSeconds(referenceSeconds)],
          ['result', 'PERFECT'],
          ['channel', note.channel],
        ]);
      }
      activeStateSignals?.publishJudgeCombo('PERFECT', combo, note.channel);
      if (!uiEnabled) {
        playbackEventTracer.logPoorCleared(referenceSeconds);
      }
    }
  };

  const drainPendingAutoScratchLongNotes = (referenceSeconds: number): void => {
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (pendingAutoScratchLongNotes.length > 0) {
      const pending = pendingAutoScratchLongNotes[0]!;
      if (pending.endSeconds > safeReferenceSeconds) {
        break;
      }
      pendingAutoScratchLongNotes.shift();
      playbackStateLogger.logLongNoteState(pending.endSeconds, {
        channel: pending.note.channel,
        state: 'complete',
        mode: resolveLoggedLongNoteMode(pending.note),
        event: pending.note.event,
        resources: resolvedJson.resources.wav,
        endSeconds: pending.endSeconds,
      });
      applyJudgeToSummary(summary, 'PERFECT', scoreTracker);
      applyLoggedGaugeJudge(referenceSeconds, 'PERFECT');
      uiSignals.pushCommand({ kind: 'clear-poor-bga' });
      setLoggedCombo(referenceSeconds, combo + 1, 'judge', 'PERFECT', pending.note.channel);
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'auto-judge', [
          ['time', formatSeconds(referenceSeconds)],
          ['result', 'PERFECT'],
          ['channel', pending.note.channel],
        ]);
      }
      activeStateSignals?.publishJudgeCombo('PERFECT', combo, pending.note.channel);
    }
  };

  const applyExpiredScorableJudgements = (referenceSeconds: number): void => {
    while (scorableMissCursor < scorableNotes.length) {
      const note = scorableNotes[scorableMissCursor]!;
      if (note.judged) {
        scorableMissCursor += 1;
        continue;
      }
      if (referenceSeconds - note.seconds <= badWindowSeconds) {
        break;
      }
      scorableMissCursor += 1;
      if (!markScorableJudged(note)) {
        continue;
      }
      if (typeof note.endBeat === 'number' && Number.isFinite(note.endBeat) && note.endBeat > note.beat) {
        note.visibleUntilBeat = note.endBeat;
      }
      applyJudgeToSummary(summary, 'POOR', scoreTracker);
      applyLoggedGaugeJudge(referenceSeconds, 'POOR', 'miss');
      uiSignals.pushCommand({ kind: 'trigger-poor-bga', seconds: referenceSeconds });
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'judge', [
          ['time', formatSeconds(referenceSeconds)],
          ['result', 'POOR'],
          ['channel', note.channel],
          ['deltaMs', Math.round((referenceSeconds - note.seconds) * 1000)],
          ['reason', 'miss'],
        ]);
        playbackEventTracer.logPoorTriggered(referenceSeconds);
      }
      setLoggedCombo(referenceSeconds, 0, 'miss', 'POOR', note.channel);
      activeStateSignals?.publishJudgeCombo('POOR', combo, note.channel);
    }
  };

  const applyResolvedManualJudge = (channel: string, judge: TimedManualJudge, atSeconds: number): void => {
    const deltaMs = Math.abs(judge.signedDeltaMs);
    applyJudgeToSummary(summary, judge.kind, scoreTracker);
    applyLoggedGaugeJudge(atSeconds, judge.kind);
    if (judge.kind === 'PERFECT' || judge.kind === 'GREAT' || judge.kind === 'GOOD') {
      applyFastSlowForJudge(summary, judge.kind, judge.signedDeltaMs);
      uiSignals.pushCommand({ kind: 'clear-poor-bga' });
      setLoggedCombo(atSeconds, combo + 1, 'judge', judge.kind, channel);
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'judge', [
          ['time', formatSeconds(atSeconds)],
          ['result', judge.kind],
          ['channel', channel],
          ['deltaMs', Math.round(deltaMs)],
        ]);
      } else {
        activeStateSignals?.publishJudgeCombo(judge.kind, combo, channel);
      }
      if (!uiEnabled) {
        playbackEventTracer.logPoorCleared(atSeconds);
      }
      return;
    }
    if (judge.kind === 'BAD') {
      setLoggedCombo(atSeconds, 0, 'judge', 'BAD', channel);
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'judge', [
          ['time', formatSeconds(atSeconds)],
          ['result', 'BAD'],
          ['channel', channel],
          ['deltaMs', Math.round(deltaMs)],
        ]);
      } else {
        activeStateSignals?.publishJudgeCombo('BAD', combo, channel);
      }
      return;
    }
    uiSignals.pushCommand({ kind: 'trigger-poor-bga', seconds: atSeconds });
    if (!uiEnabled) {
      playbackEventTracer.logPoorTriggered(atSeconds);
    }
    setLoggedCombo(atSeconds, 0, 'judge', 'POOR', channel);
    if (!uiEnabled) {
      writeRuntimeEventLog(writeOutput, 'judge', [
        ['time', formatSeconds(atSeconds)],
        ['result', 'POOR'],
        ['channel', channel],
        ['deltaMs', Math.round(deltaMs)],
      ]);
    } else {
      activeStateSignals?.publishJudgeCombo('POOR', combo, channel);
    }
  };

  const applyManualTimingJudge = (channel: string, signedDeltaMs: number, atSeconds: number): void => {
    applyResolvedManualJudge(channel, resolveManualTimedJudge(signedDeltaMs, judgeWindows, badWindowMs), atSeconds);
  };

  const finalizeActiveLongNote = (
    channel: string,
    hold: ActiveLongNoteState,
    judge: TimedManualJudge,
    atSeconds: number,
  ): void => {
    activeLongNotesByChannel.delete(channel);
    longHoldUntilMsByChannel.delete(channel);
    applyResolvedManualJudge(channel, judge, atSeconds);
  };

  const triggerRealtimeAudioVolumeEvents = (referenceSeconds: number): void => {
    const triggerEvent = audioSession?.triggerEvent;
    if (!triggerEvent) {
      return;
    }
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (realtimeAudioVolumeEventIndex < realtimeAudioVolumeEvents.length) {
      const volumeEvent = realtimeAudioVolumeEvents[realtimeAudioVolumeEventIndex]!;
      if (volumeEvent.seconds > safeReferenceSeconds) {
        break;
      }
      if (!uiEnabled) {
        writeRealtimeVolumeEventLog(writeOutput, volumeEvent.seconds, volumeEvent.event);
      }
      triggerEvent(volumeEvent.event);
      realtimeAudioVolumeEventIndex += 1;
    }
  };

  const triggerNonPlayableRealtimeAudioEvents = (referenceSeconds: number): void => {
    const triggerEvent = audioSession?.triggerEvent;
    if (!triggerEvent) {
      return;
    }
    const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
    while (nonPlayableRealtimeAudioTriggerIndex < nonPlayableRealtimeAudioTriggers.length) {
      const trigger = nonPlayableRealtimeAudioTriggers[nonPlayableRealtimeAudioTriggerIndex]!;
      if (trigger.seconds > safeReferenceSeconds) {
        break;
      }
      if (!uiEnabled) {
        writeRealtimeTriggeredEventLog(
          writeOutput,
          trigger,
          resolvedJson.resources.wav[trigger.sampleKey],
          'realtime',
        );
      }
      triggerEvent(trigger.event);
      nonPlayableRealtimeAudioTriggerIndex += 1;
    }
  };

  const candidateChannelsBuffer = new Set<string>();
  const collectMappedInputChannels = (tokens: readonly string[]): void => {
    for (const token of tokens) {
      const mapped = inputTokenToChannels.get(token);
      if (!mapped) {
        continue;
      }
      mapped.forEach((channel) => candidateChannelsBuffer.add(channel));
    }
  };
  const resolveMappedInputChannels = (
    tokens: readonly string[],
    additionalTokens?: readonly string[],
  ): ReadonlySet<string> => {
    candidateChannelsBuffer.clear();
    collectMappedInputChannels(tokens);
    if (additionalTokens && additionalTokens.length > 0) {
      collectMappedInputChannels(additionalTokens);
    }
    if (autoScratchEnabled) {
      for (const channel of candidateChannelsBuffer) {
        if (scratchPlayableChannels.has(channel)) {
          candidateChannelsBuffer.delete(channel);
        }
      }
    }
    return candidateChannelsBuffer;
  };

  const handleMappedInputTokens = (tokens: readonly string[]): void => {
    const candidateChannels = resolveMappedInputChannels(tokens);
    if (candidateChannels.size === 0) {
      return;
    }

    if (uiEnabled) {
      for (const mappedChannel of candidateChannels) {
        uiSignals.pushCommand({ kind: 'flash-lane', channel: mappedChannel });
      }
    }

    const nowMs = playbackClock.nowMs();
    const nowSec = elapsedMsToGameSeconds(nowMs, speed);
    advanceDynamicJudgeRankChanges(nowSec);

    let refreshedHold = false;
    for (const channel of candidateChannels) {
      if (!activeLongNotesByChannel.has(channel)) {
        continue;
      }
      longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
      refreshedHold = true;
    }

    const candidate = findBestCandidate(scorableNotes, candidateChannels, nowSec, badWindowSeconds);
    const landmineCandidate = findBestCandidate(landmineNotes, candidateChannels, nowSec, badWindowSeconds);
    const candidateDelta = candidate ? Math.abs(candidate.seconds - nowSec) : Number.POSITIVE_INFINITY;
    const landmineDelta = landmineCandidate ? Math.abs(landmineCandidate.seconds - nowSec) : Number.POSITIVE_INFINITY;

    if (landmineCandidate && landmineDelta <= candidateDelta) {
      if (!markLandmineJudged(landmineCandidate)) {
        return;
      }
      applyJudgeToSummary(summary, 'BAD', scoreTracker);
      applyLoggedGaugeJudge(nowSec, 'BAD', 'mine-hit');
      setLoggedCombo(nowSec, 0, 'mine-hit', 'BAD', landmineCandidate.channel);
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'mine-hit', [
          ['time', formatSeconds(nowSec)],
          ['channel', landmineCandidate.channel],
          ['deltaMs', Math.round(landmineDelta * 1000)],
        ]);
      } else {
        activeStateSignals?.publishJudgeCombo('BAD', combo, landmineCandidate.channel);
      }
      return;
    }

    if (!candidate) {
      if (refreshedHold) {
        return;
      }
      const fallback = findLaneSoundCandidate(notes, candidateChannels, nowSec);
      if (fallback) {
        const suppressUntil = longNoteSuppressUntilSecondsByChannel.get(fallback.channel);
        const shouldSuppressFallback = suppressUntil !== undefined && nowSec < suppressUntil;
        if (!shouldSuppressFallback) {
          if (!uiEnabled) {
            writePlayableSampleTriggerEventLog(
              writeOutput,
              fallback.event,
              nowSec,
              resolvedJson.resources.wav,
              'lane-fallback',
              fallback.channel,
            );
          }
          audioSession?.triggerEvent?.(fallback.event);
          if (activeFreeZoneChannels.has(fallback.channel)) {
            return;
          }
        } else {
          return;
        }
      }
      return;
    }

    if (!markScorableJudged(candidate)) {
      return;
    }
    const channel = candidate.channel;
    const signedDeltaMs = (nowSec - candidate.seconds) * 1000;
    if (uiEnabled) {
      uiSignals.pushCommand({ kind: 'flash-lane', channel });
    }
    if (!uiEnabled) {
      writePlayableSampleTriggerEventLog(
        writeOutput,
        candidate.event,
        nowSec,
        resolvedJson.resources.wav,
        'manual-note',
        channel,
      );
    }
    audioSession?.triggerEvent?.(candidate.event);
    const endSeconds = candidate.endSeconds;
      if (typeof endSeconds === 'number' && Number.isFinite(endSeconds) && endSeconds > candidate.seconds) {
        const longNoteMode = resolvePlayableLongNoteMode(candidate);
        const previousSuppressUntil = longNoteSuppressUntilSecondsByChannel.get(channel) ?? Number.NEGATIVE_INFINITY;
        if (endSeconds > previousSuppressUntil) {
          longNoteSuppressUntilSecondsByChannel.set(channel, endSeconds);
        }
        playbackStateLogger.logLongNoteState(nowSec, {
          channel,
          state: 'start',
          mode: longNoteMode === 2 || longNoteMode === 3 ? longNoteMode : 1,
          event: candidate.event,
          resources: resolvedJson.resources.wav,
          endSeconds,
        });
        candidate.visibleUntilBeat = candidate.endBeat;
        if (longNoteMode === 2 || longNoteMode === 3) {
          activeLongNotesByChannel.set(channel, {
          endSeconds,
          note: candidate,
          mode: longNoteMode,
          headJudge: resolveManualTimedJudge(signedDeltaMs, judgeWindows, badWindowMs),
          gaugeDrainCursorSeconds: nowSec,
          audioStopped: false,
        });
        longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
        return;
      }
      if (longNoteMode === 1) {
        activeLongNotesByChannel.set(channel, {
          endSeconds,
          note: candidate,
          mode: 1,
          headJudge: resolveManualTimedJudge(signedDeltaMs, judgeWindows, badWindowMs),
          gaugeDrainCursorSeconds: nowSec,
          audioStopped: false,
        });
        longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
        return;
      }
      activeLongNotesByChannel.delete(channel);
      longHoldUntilMsByChannel.delete(channel);
      return;
    } else {
      activeLongNotesByChannel.delete(channel);
      longHoldUntilMsByChannel.delete(channel);
    }

    applyManualTimingJudge(channel, signedDeltaMs, nowSec);
  };

  const applyHighSpeedAction = (action: HighSpeedControlAction | undefined): boolean => {
    if (!action) {
      return false;
    }
    const nextHighSpeed = applyHighSpeedControlAction(highSpeed, action);
    if (nextHighSpeed !== highSpeed) {
      highSpeed = nextHighSpeed;
      activeStateSignals?.setHighSpeed(highSpeed);
      options.onHighSpeedChange?.(highSpeed);
    }
    if (!uiEnabled) {
      writeRuntimeEventLog(writeOutput, 'high-speed-change', [
        ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
        ['value', `x${highSpeed.toFixed(1)}`],
      ]);
    }
    return true;
  };

  const togglePause = (): void => {
    if (playbackClock.isPaused()) {
      if (!playbackClock.resume()) {
        return;
      }
      audioSession?.resume();
      activeStateSignals?.setPaused(false);
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'playback-state', [
          ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
          ['state', 'resume'],
        ]);
      }
      return;
    }
    if (!playbackClock.pause()) {
      return;
    }
    audioSession?.pause();
    activeStateSignals?.setPaused(true);
    if (!uiEnabled) {
      writeRuntimeEventLog(writeOutput, 'playback-state', [
        ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
        ['state', 'pause'],
      ]);
    }
  };

  const consumeInputCommands = (): void => {
    const commands = inputSignals.drainCommands();
    for (const command of commands) {
      if (interruptedReason) {
        continue;
      }
      if (command.kind === 'interrupt') {
        if (!uiEnabled && playbackClock) {
          writeRuntimeEventLog(writeOutput, 'interrupt', [
            ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
            ['reason', command.reason],
          ]);
        }
        interruptedReason = command.reason;
        continue;
      }
      if (command.kind === 'toggle-pause') {
        togglePause();
        continue;
      }
      if (command.kind === 'high-speed') {
        applyHighSpeedAction(command.action);
        continue;
      }
      if (command.kind === 'kitty-state') {
        if (!uiEnabled) {
          if (command.pressTokens.length > 0) {
            writeRuntimeEventLog(writeOutput, 'input', [
              ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
              ['action', 'press'],
              ['tokens', command.pressTokens.join(',')],
            ]);
          }
          if (command.repeatTokens.length > 0) {
            writeRuntimeEventLog(writeOutput, 'input', [
              ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
              ['action', 'repeat'],
              ['tokens', command.repeatTokens.join(',')],
            ]);
          }
          if (command.releaseTokens.length > 0) {
            writeRuntimeEventLog(writeOutput, 'input', [
              ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
              ['action', 'release'],
              ['tokens', command.releaseTokens.join(',')],
            ]);
          }
        }
        const pressedChannels = resolveMappedInputChannels(command.pressTokens, command.repeatTokens);
        for (const channel of pressedChannels) {
          activeKittyPressedChannels.add(channel);
          if (uiEnabled) {
            uiSignals.pushCommand({ kind: 'press-lane', channel });
          }
        }
        const releasedChannels = resolveMappedInputChannels(command.releaseTokens);
        for (const channel of releasedChannels) {
          activeKittyPressedChannels.delete(channel);
          if (uiEnabled) {
            uiSignals.pushCommand({ kind: 'release-lane', channel });
          }
          if (activeLongNotesByChannel.has(channel)) {
            longHoldUntilMsByChannel.set(channel, playbackClock.nowMs());
          }
        }
        continue;
      }
      if (playbackClock.isPaused()) {
        continue;
      }
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'input', [
          ['time', formatSeconds(elapsedMsToGameSeconds(playbackClock.nowMs(), speed))],
          ['action', 'lane-input'],
          ['tokens', command.tokens.join(',')],
        ]);
      }
      const nowSec = elapsedMsToGameSeconds(playbackClock.nowMs(), speed);
      triggerRealtimeAudioVolumeEvents(nowSec);
      playbackEventTracer.flushUntil(nowSec);
      handleMappedInputTokens(command.tokens);
    }
  };

  try {
    while (playbackClock.nowMs() < horizon) {
      consumeInputCommands();
      if (interruptedReason) {
        break;
      }
      const nowMs = playbackClock.nowMs();
      if (playbackClock.isPaused()) {
        const nowSec = elapsedMsToGameSeconds(nowMs, speed);
        publishUiFrame(nowSec, beatAtSeconds(nowSec));
        await waitPrecise(PAUSE_POLL_INTERVAL_MS);
        continue;
      }
      const nowSec = elapsedMsToGameSeconds(nowMs, speed);
      const nowBeat = beatAtSeconds(nowSec);
      advanceDynamicJudgeRankChanges(nowSec);
      playbackEventTracer.flushUntil(nowSec);

      triggerRealtimeAudioVolumeEvents(nowSec);
      triggerNonPlayableRealtimeAudioEvents(nowSec);

      for (const channel of activeKittyPressedChannels) {
        if (!activeLongNotesByChannel.has(channel)) {
          continue;
        }
        longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
      }

      for (const [channel, hold] of activeLongNotesByChannel.entries()) {
        const holdUntilMs = longHoldUntilMsByChannel.get(channel);
        const isHolding = holdUntilMs !== undefined && nowMs <= holdUntilMs;
        if (hold.mode === 1 && holdUntilMs !== undefined && nowMs > holdUntilMs) {
          if (!hold.audioStopped) {
            playbackStateLogger.logLongNoteState(nowSec, {
              channel,
              state: 'release',
              mode: hold.mode,
              event: hold.note.event,
              resources: resolvedJson.resources.wav,
              endSeconds: hold.endSeconds,
            });
            if (!uiEnabled) {
              writeSampleStopEventLog(
                writeOutput,
                channel,
                nowSec,
                'long-note-release',
                hold.note.event,
                resolvedJson.resources.wav,
              );
            }
            audioSession?.stopChannel?.(channel);
            hold.audioStopped = true;
          }
          finalizeActiveLongNote(
            channel,
            hold,
            { kind: 'BAD', signedDeltaMs: (nowSec - hold.endSeconds) * 1000 },
            nowSec,
          );
          continue;
        }
        if (hold.mode === 3) {
          const drainUntilSeconds = Math.min(nowSec, hold.endSeconds);
          if (!isHolding && drainUntilSeconds > hold.gaugeDrainCursorSeconds) {
            applyLoggedGaugeDelta(
              nowSec,
              -(drainUntilSeconds - hold.gaugeDrainCursorSeconds) * HELL_CHARGE_GAUGE_DRAIN_PER_SECOND,
              'hold-drain',
            );
          }
          hold.gaugeDrainCursorSeconds = drainUntilSeconds;
          if (!isHolding && !hold.audioStopped) {
            playbackStateLogger.logLongNoteState(nowSec, {
              channel,
              state: 'break',
              mode: hold.mode,
              event: hold.note.event,
              resources: resolvedJson.resources.wav,
              endSeconds: hold.endSeconds,
            });
            if (!uiEnabled) {
              writeSampleStopEventLog(
                writeOutput,
                channel,
                nowSec,
                'long-note-break',
                hold.note.event,
                resolvedJson.resources.wav,
              );
            }
            audioSession?.stopChannel?.(channel);
            hold.audioStopped = true;
          }
        }

        if (nowSec >= hold.endSeconds) {
          if (hold.mode === 1) {
            playbackStateLogger.logLongNoteState(nowSec, {
              channel,
              state: 'complete',
              mode: hold.mode,
              event: hold.note.event,
              resources: resolvedJson.resources.wav,
              endSeconds: hold.endSeconds,
            });
            finalizeActiveLongNote(channel, hold, hold.headJudge, nowSec);
            continue;
          }
          if (hold.mode === 3 && !isHolding && hold.endSeconds > hold.gaugeDrainCursorSeconds) {
            applyLoggedGaugeDelta(
              nowSec,
              -(hold.endSeconds - hold.gaugeDrainCursorSeconds) * HELL_CHARGE_GAUGE_DRAIN_PER_SECOND,
              'hold-drain',
            );
            hold.gaugeDrainCursorSeconds = hold.endSeconds;
          }
          playbackStateLogger.logLongNoteState(nowSec, {
            channel,
            state: 'complete',
            mode: hold.mode,
            event: hold.note.event,
            resources: resolvedJson.resources.wav,
            endSeconds: hold.endSeconds,
          });
          const finalJudge =
            hold.mode === 3 && !isHolding
              ? combineLongNoteJudges(hold.headJudge, {
                  kind: 'POOR',
                  signedDeltaMs: (nowSec - hold.endSeconds) * 1000,
                } satisfies TimedManualJudge)
              : combineLongNoteJudges(
                  hold.headJudge,
                  resolveManualTimedJudge((nowSec - hold.endSeconds) * 1000, judgeWindows, badWindowMs),
                );
          finalizeActiveLongNote(channel, hold, finalJudge, nowSec);
          continue;
        }

        if (hold.mode === 2 && holdUntilMs !== undefined && nowMs > holdUntilMs) {
          if (!hold.audioStopped) {
            playbackStateLogger.logLongNoteState(nowSec, {
              channel,
              state: 'release',
              mode: hold.mode,
              event: hold.note.event,
              resources: resolvedJson.resources.wav,
              endSeconds: hold.endSeconds,
            });
            if (!uiEnabled) {
              writeSampleStopEventLog(
                writeOutput,
                channel,
                nowSec,
                'long-note-release',
                hold.note.event,
                resolvedJson.resources.wav,
              );
            }
            audioSession?.stopChannel?.(channel);
            hold.audioStopped = true;
          }
          finalizeActiveLongNote(
            channel,
            hold,
            combineLongNoteJudges(
              hold.headJudge,
              resolveManualTimedJudge((nowSec - hold.endSeconds) * 1000, judgeWindows, badWindowMs),
            ),
            nowSec,
          );
        }
      }

      drainPendingAutoScratchLongNotes(nowSec);
      for (const [channel, suppressUntil] of longNoteSuppressUntilSecondsByChannel.entries()) {
        if (nowSec >= suppressUntil) {
          longNoteSuppressUntilSecondsByChannel.delete(channel);
        }
      }

      applyAutoScratchJudgements(nowSec);
      applyExpiredScorableJudgements(nowSec);
      publishUiFrame(nowSec, nowBeat);

      markExpiredLandmines(nowSec);
      markExpiredInvisibleNotes(nowSec);

      const safeNowSeconds = Math.max(0, nowSec) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
      if (
        remainingScorableNotes === 0 &&
        remainingLandmineNotes === 0 &&
        remainingInvisibleNotes === 0 &&
        pendingAutoScratchLongNotes.length === 0 &&
        activeLongNotesByChannel.size === 0 &&
        !audioSession &&
        safeNowSeconds >= totalSeconds
      ) {
        break;
      }

      await waitPrecise(TUI_FRAME_INTERVAL_MS);
    }

    if (!interruptedReason) {
      playbackEventTracer.flushUntil(totalSeconds);
        const judgedCount = summary.perfect + summary.great + summary.good + summary.bad + summary.poor;
        if (judgedCount < summary.total) {
          const missingCount = summary.total - judgedCount;
          for (let index = 0; index < missingCount; index += 1) {
            applyJudgeToSummary(summary, 'POOR', scoreTracker);
            applyLoggedGaugeJudge(totalSeconds, 'POOR', 'remaining-notes');
          }
          uiSignals.pushCommand({ kind: 'trigger-poor-bga', seconds: totalSeconds });
          if (!uiEnabled) {
          writeRuntimeEventLog(writeOutput, 'judge', [
            ['time', formatSeconds(totalSeconds)],
            ['result', 'POOR'],
            ['reason', 'remaining-notes'],
            ['count', missingCount],
            ]);
            playbackEventTracer.logPoorTriggered(totalSeconds);
          }
          setLoggedCombo(totalSeconds, 0, 'remaining-notes', 'POOR');
          if (uiEnabled) {
            activeStateSignals?.publishJudgeCombo('POOR', combo);
            publishUiFrame(totalSeconds, beatAtSeconds(totalSeconds));
        }
      }
    }
  } finally {
    if (interruptedReason) {
      await disposeAudioSessionSafely(audioSession);
    } else {
      await finalizeAudioSessionSafely(audioSession);
    }
    inputRuntime?.stop();
    await settleMaybeAsyncWithTimeout(uiRuntime?.stop(), 300);
    await settleMaybeAsyncWithTimeout(uiRuntime?.dispose(), 300);
  }

  if (interruptedReason) {
    if (interruptedReason === 'escape') {
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'playback-end', [
          ['time', formatSeconds(totalSeconds)],
          ['reason', interruptedReason],
        ]);
        playbackStateLogger.logResult(totalSeconds, {
          reason: interruptedReason,
          summary,
        });
      }
      writeOutput(renderSummary(summary));
      return summary;
    }
    throw new PlayerInterruptedError(interruptedReason);
  }

  if (!uiEnabled) {
    writeRuntimeEventLog(writeOutput, 'playback-end', [
      ['time', formatSeconds(totalSeconds)],
      ['reason', 'complete'],
    ]);
    playbackStateLogger.logResult(totalSeconds, {
      reason: 'complete',
      summary,
    });
  }
  writeOutput(renderSummary(summary));
  return summary;
}

function resolveAudioBackendLabel(options: PlayerOptions, audioSession: AudioSession | undefined): string {
  if (options.audio === false) {
    return 'off';
  }
  return audioSession?.backendLabel ?? 'none';
}

async function finalizeAudioSessionSafely(audioSession: AudioSession | undefined): Promise<void> {
  if (!audioSession) {
    return;
  }
  await audioSession.finish().catch(() => undefined);
  await settleWithTimeout(audioSession.dispose(), 600);
}

async function disposeAudioSessionSafely(audioSession: AudioSession | undefined): Promise<void> {
  if (!audioSession) {
    return;
  }
  await settleWithTimeout(audioSession.dispose(), 600);
}

async function settleWithTimeout(task: Promise<void>, timeoutMs: number): Promise<boolean> {
  let completed = false;
  const guardedTask = task
    .catch(() => undefined)
    .then(() => {
      completed = true;
    });
  await Promise.race([guardedTask, delay(timeoutMs)]);
  return completed;
}

async function settleMaybeAsyncWithTimeout(
  task: void | Promise<void> | undefined,
  timeoutMs: number,
): Promise<boolean> {
  if (!task) {
    return true;
  }
  return settleWithTimeout(Promise.resolve(task), timeoutMs);
}

async function createAudioSessionIfEnabled(
  json: BeMusicJson,
  options: PlayerOptions,
  mode: 'auto' | 'manual',
  onLoadProgress?: (progress: AudioSessionLoadProgress) => void,
): Promise<AudioSession | undefined> {
  throwIfAborted(options.signal);
  const writeOutput = resolveOutputWriter(options);
  if (options.audio === false) {
    onLoadProgress?.({
      ratio: 1,
      message: 'Audio disabled; skipping audio setup.',
    });
    return undefined;
  }

  const headPaddingMs = options.audioHeadPaddingMs ?? 0;
  const masterVolume = normalizeMasterVolume(options.volume);
  const bgmVolume = normalizeBgmVolume(options.bgmVolume, masterVolume);
  const playVolume = normalizePlayVolume(options.playVolume, masterVolume);
  const inferBmsLnTypeWhenMissing = Boolean(options.inferBmsLnTypeWhenMissing);
  const chartWavGain = resolveChartVolWavGain(json);
  const lnobjEndEvents = collectLnobjEndEvents(json);
  const runtimeSampleRate = RUNTIME_AUDIO_SAMPLE_RATE;

  onLoadProgress?.({
    ratio: 0.05,
    message: 'Preparing real-time key sounds...',
  });
  throwIfAborted(options.signal);
  const samplesByKey = await buildRuntimeSampleMap(
    json,
    options,
    runtimeSampleRate,
    (progress) => {
      const ratio = progress.total <= 0 ? 1 : progress.loaded / progress.total;
      onLoadProgress?.({
        ratio: 0.08 + Math.max(0, Math.min(1, ratio)) * 0.72,
        message: `Loading key sounds... (${progress.loaded}/${progress.total})`,
        detail: progress.samplePath ?? progress.sampleKey,
      });
    },
    chartWavGain,
    inferBmsLnTypeWhenMissing,
    options.signal,
  );
  throwIfAborted(options.signal);
  onLoadProgress?.({
    ratio: 0.82,
    message: 'Initializing audio backend...',
  });
  const background = createSilentRenderResult(runtimeSampleRate);

  const sampleRate = toPlaybackSampleRate(background.sampleRate, options.speed ?? 1);
  const samplesPerFrame = mode === 'manual' ? MANUAL_AUDIO_CHUNK_FRAMES : AUTO_AUDIO_CHUNK_FRAMES;
  const leadTuning = createAudioLeadTuning(options, mode);
  const outputDynamics = createOutputDynamicsConfig(options, sampleRate);
  const output = await createNodeAudioSink({
    sampleRate,
    channels: 2,
    samplesPerFrame,
    mode,
    signal: options.signal,
  });
  throwIfAborted(options.signal);
  if (!output) {
    writeOutput('Audio playback disabled: node-web-audio-api is unavailable.\n');
    onLoadProgress?.({
      ratio: 1,
      message: 'node-web-audio-api is unavailable; continuing without audio.',
    });
    return undefined;
  }

  writeOutput(`Audio backend: ${output.label}\n`);

  const eventPlaybackMap = buildEventPlaybackMap(json, inferBmsLnTypeWhenMissing);
  onLoadProgress?.({
    ratio: 1,
    message: 'Audio ready.',
  });

  let closed = false;
  let abortRequested = false;
  let draining = false;
  let paused = false;
  let playbackTask: Promise<void> | undefined;
  const activeVoices: ActiveVoice[] = [];
  let currentBgmDynamicGain = 1;
  let currentPlayDynamicGain = 1;

  output.onError(() => {
    writeOutput(`Audio playback stream error (${output.label}).\n`);
  });

  const finish = async (): Promise<void> => {
    if (closed) {
      return;
    }
    draining = true;
    if (!playbackTask) {
      return;
    }
    await playbackTask.catch(() => undefined);
  };

  const dispose = async (): Promise<void> => {
    if (closed) {
      return;
    }
    closed = true;
    abortRequested = true;
    draining = true;

    output.destroy();

    if (playbackTask) {
      await Promise.race([playbackTask.catch(() => undefined), delay(300)]);
    }
  };

  return {
    backendLabel: output.label,
    start: () => {
      if (closed || playbackTask) {
        return;
      }

      playbackTask = playMixedPcmThroughOutput({
        output,
        background,
        activeVoices,
        shouldStop: () => abortRequested,
        isDraining: () => draining,
        isPaused: () => paused,
        mode,
        leadTuning,
        outputDynamics,
        playbackSampleRate: sampleRate,
      }).catch(() => undefined);
    },
    finish,
    dispose,
    chartStartDelayMs: headPaddingMs,
    pause: () => {
      if (closed) {
        return;
      }
      paused = true;
    },
    resume: () => {
      if (closed) {
        return;
      }
      paused = false;
    },
    getActiveAudioFiles: () => collectActiveAudioFileNames(activeVoices),
    getActiveAudioVoiceCount: () => activeVoices.length,
    triggerEvent: (event: BeMusicEvent) => {
      if (draining || abortRequested || paused) {
        return;
      }
      const normalizedChannel = normalizeChannel(event.channel);
      if (isBmsDynamicVolumeChangeChannel(normalizedChannel)) {
        const dynamicGain = parseBmsDynamicVolumeGain(event.value);
        if (dynamicGain === undefined) {
          return;
        }
        if (isBmsKeyVolumeChangeChannel(normalizedChannel)) {
          currentPlayDynamicGain = dynamicGain;
        } else if (isBmsBgmVolumeChangeChannel(normalizedChannel)) {
          currentBgmDynamicGain = dynamicGain;
        }
        return;
      }
      if (lnobjEndEvents.has(event)) {
        return;
      }
      const normalized = normalizeObjectKey(event.value);
      const sample = samplesByKey.get(normalized);
      if (!sample) {
        return;
      }
      const playback = eventPlaybackMap.get(event);
      const offsetSeconds = playback?.offsetSeconds ?? 0;
      const offsetFrames = Math.max(0, Math.round(offsetSeconds * sample.sampleRate));
      const durationFrames =
        typeof playback?.durationSeconds === 'number' && Number.isFinite(playback.durationSeconds)
          ? Math.max(1, Math.round(playback.durationSeconds * sample.sampleRate))
          : sample.left.length - offsetFrames;
      const endPosition = Math.min(sample.left.length, offsetFrames + durationFrames);
      if (offsetFrames >= endPosition) {
        return;
      }
      if (json.sourceFormat === 'bms') {
        removeActiveVoicesInPlace(activeVoices, (voice) => voice.sampleKey === normalized);
      }
      if (playback?.sliceId && activeVoices.some((voice) => voice.sliceId === playback.sliceId)) {
        return;
      }
      const isPlayLaneSound = isPlayLaneSoundChannel(normalizedChannel);
      const voiceGain =
        (isPlayLaneSound ? playVolume : bgmVolume) * (isPlayLaneSound ? currentPlayDynamicGain : currentBgmDynamicGain);
      if (voiceGain <= 0) {
        return;
      }
      activeVoices.push({
        sample,
        position: offsetFrames,
        endPosition,
        channel: normalizeChannel(event.channel),
        sampleKey: normalized,
        samplePath: json.resources.wav[normalized],
        sliceId: playback?.sliceId,
        gain: voiceGain,
      });
    },
    stopChannel:
      mode === 'manual'
        ? (channel: string) => {
            if (paused) {
              return;
            }
            const normalizedChannel = normalizeChannel(channel);
            removeActiveVoicesInPlace(activeVoices, (voice) => voice.channel === normalizedChannel);
          }
        : undefined,
  };
}

interface ActiveVoice {
  sample: RenderResult;
  position: number;
  endPosition: number;
  channel?: string;
  sampleKey?: string;
  samplePath?: string;
  sliceId?: string;
  gain: number;
}

interface DebugSampleWindow {
  sampleKey: string;
  startSeconds: number;
  endSeconds: number;
  label: string;
}

interface DebugActiveAudioState {
  activeAudioFiles: string[];
  activeAudioVoiceCount: number;
}

interface DebugActiveAudioEstimator {
  resolve: (nowSeconds: number) => DebugActiveAudioState;
}

function collectActiveAudioFileNames(activeVoices: ActiveVoice[]): string[] {
  const unique = new Set<string>();
  for (const voice of activeVoices) {
    const label = voice.samplePath ?? voice.sampleKey;
    if (typeof label !== 'string' || label.length === 0) {
      continue;
    }
    unique.add(label);
  }
  return [...unique];
}

async function createDebugActiveAudioEstimator(
  json: BeMusicJson,
  options: {
    baseDir?: string;
    inferBmsLnTypeWhenMissing?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<DebugActiveAudioEstimator> {
  throwIfAborted(options.signal);
  const resolver = createTimingResolver(json);
  const triggers = collectSampleTriggers(json, resolver, {
    inferBmsLnTypeWhenMissing: Boolean(options.inferBmsLnTypeWhenMissing),
  });
  const sampleDurationSecondsByKey = await buildDebugSampleDurationSecondsMap(
    triggers,
    options.baseDir,
    options.signal,
  );
  throwIfAborted(options.signal);
  const windows: DebugSampleWindow[] = triggers
    .map((trigger) => {
      const startSeconds = Math.max(0, trigger.seconds);
      const durationSeconds =
        typeof trigger.sampleDurationSeconds === 'number' && Number.isFinite(trigger.sampleDurationSeconds)
          ? Math.max(0, trigger.sampleDurationSeconds)
          : Math.max(
              0,
              (sampleDurationSecondsByKey.get(trigger.sampleKey) ?? DEBUG_ACTIVE_AUDIO_FALLBACK_SECONDS) -
                Math.max(0, trigger.sampleOffsetSeconds),
            );
      return {
        sampleKey: trigger.sampleKey,
        startSeconds,
        endSeconds: startSeconds + durationSeconds,
        label: trigger.samplePath ?? trigger.sampleKey,
      } satisfies DebugSampleWindow;
    })
    .filter((window) => window.endSeconds > window.startSeconds)
    .sort((left, right) => left.startSeconds - right.startSeconds);

  if (json.sourceFormat === 'bms') {
    const latestBySampleKey = new Map<string, number>();
    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index]!;
      const previousIndex = latestBySampleKey.get(window.sampleKey);
      if (previousIndex !== undefined) {
        const previousWindow = windows[previousIndex]!;
        if (window.startSeconds < previousWindow.endSeconds) {
          previousWindow.endSeconds = window.startSeconds;
        }
      }
      latestBySampleKey.set(window.sampleKey, index);
    }
  }

  let active: DebugSampleWindow[] = [];
  let nextIndex = 0;
  let lastResolvedSeconds = Number.NEGATIVE_INFINITY;

  const rebuildAt = (nowSeconds: number): void => {
    active = [];
    nextIndex = 0;
    while (nextIndex < windows.length && windows[nextIndex]!.startSeconds <= nowSeconds) {
      const window = windows[nextIndex]!;
      nextIndex += 1;
      if (window.endSeconds > nowSeconds) {
        active.push(window);
      }
    }
  };

  return {
    resolve: (nowSeconds: number): DebugActiveAudioState => {
      const safeNowSeconds = Number.isFinite(nowSeconds) ? Math.max(0, nowSeconds) : 0;
      if (safeNowSeconds < lastResolvedSeconds) {
        rebuildAt(safeNowSeconds);
      } else {
        while (nextIndex < windows.length && windows[nextIndex]!.startSeconds <= safeNowSeconds) {
          const window = windows[nextIndex]!;
          nextIndex += 1;
          if (window.endSeconds > safeNowSeconds) {
            active.push(window);
          }
        }
      }
      lastResolvedSeconds = safeNowSeconds;

      let writeIndex = 0;
      for (let readIndex = 0; readIndex < active.length; readIndex += 1) {
        const window = active[readIndex]!;
        if (window.endSeconds <= safeNowSeconds) {
          continue;
        }
        if (writeIndex !== readIndex) {
          active[writeIndex] = window;
        }
        writeIndex += 1;
      }
      active.length = writeIndex;

      const uniqueLabels = new Set<string>();
      for (const window of active) {
        uniqueLabels.add(window.label);
      }
      return {
        activeAudioFiles: [...uniqueLabels],
        activeAudioVoiceCount: active.length,
      };
    },
  };
}

async function buildDebugSampleDurationSecondsMap(
  triggers: TimedSampleTrigger[],
  baseDir?: string,
  signal?: AbortSignal,
): Promise<Map<string, number>> {
  throwIfAborted(signal);
  const uniqueTriggers = new Map<string, TimedSampleTrigger>();
  for (const trigger of triggers) {
    if (!uniqueTriggers.has(trigger.sampleKey)) {
      uniqueTriggers.set(trigger.sampleKey, trigger);
    }
  }

  const durations = new Map<string, number>();
  for (const trigger of uniqueTriggers.values()) {
    throwIfAborted(signal);
    const rendered = await renderSingleSample(trigger.sampleKey, trigger.samplePath, {
      baseDir: baseDir ?? process.cwd(),
      sampleRate: DEBUG_ACTIVE_AUDIO_SAMPLE_RATE,
      gain: 1,
      fallbackToneSeconds: DEBUG_ACTIVE_AUDIO_FALLBACK_SECONDS,
      signal,
    });
    durations.set(trigger.sampleKey, rendered.durationSeconds);
  }
  return durations;
}

function removeActiveVoicesInPlace(activeVoices: ActiveVoice[], shouldRemove: (voice: ActiveVoice) => boolean): void {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < activeVoices.length; readIndex += 1) {
    const voice = activeVoices[readIndex]!;
    if (shouldRemove(voice)) {
      continue;
    }
    if (writeIndex !== readIndex) {
      activeVoices[writeIndex] = voice;
    }
    writeIndex += 1;
  }
  activeVoices.length = writeIndex;
}

function advanceAndPruneActiveVoices(activeVoices: ActiveVoice[], chunkFrames: number): void {
  let writeIndex = 0;
  for (let readIndex = 0; readIndex < activeVoices.length; readIndex += 1) {
    const voice = activeVoices[readIndex]!;
    voice.position += chunkFrames;
    if (voice.position >= voice.endPosition) {
      continue;
    }
    if (writeIndex !== readIndex) {
      activeVoices[writeIndex] = voice;
    }
    writeIndex += 1;
  }
  activeVoices.length = writeIndex;
}

async function playMixedPcmThroughOutput(params: {
  output: AudioSink;
  background: RenderResult;
  activeVoices: ActiveVoice[];
  shouldStop: () => boolean;
  isDraining: () => boolean;
  isPaused: () => boolean;
  mode: 'auto' | 'manual';
  leadTuning: AudioLeadTuning;
  outputDynamics?: OutputDynamicsConfig;
  playbackSampleRate: number;
}): Promise<void> {
  const { output, background, activeVoices, shouldStop, isDraining, isPaused, mode, leadTuning, playbackSampleRate } =
    params;

  const chunkFrames = mode === 'manual' ? MANUAL_AUDIO_CHUNK_FRAMES : AUTO_AUDIO_CHUNK_FRAMES;
  // Keep one reusable PCM buffer and fill through Int16Array to minimize per-sample write overhead.
  const chunkSamples = new Int16Array(chunkFrames * 2);
  const chunk = new Uint8Array(chunkSamples.buffer);
  const mixedLeft = new Float32Array(chunkFrames);
  const mixedRight = new Float32Array(chunkFrames);
  const backgroundLeft = background.left;
  const backgroundRight = background.right;
  const backgroundLength = backgroundLeft.length;
  let playhead = 0;
  const playbackStartMs = performance.now();
  let pausedAtMs = 0;
  let pausedDurationMs = 0;
  let pauseActive = false;
  let adaptiveLeadMs = leadTuning.baseLeadMs;
  const chunkDurationMs = (chunkFrames / playbackSampleRate) * 1000;
  const outputDynamics = params.outputDynamics;
  let compressorGain = 1;
  let limiterGain = 1;

  while (!shouldStop()) {
    if (isPaused()) {
      if (!pauseActive) {
        pauseActive = true;
        pausedAtMs = performance.now();
      }
      await delay(PAUSE_POLL_INTERVAL_MS);
      continue;
    }
    if (pauseActive) {
      pauseActive = false;
      pausedDurationMs += performance.now() - pausedAtMs;
    }

    const mixStartedAtMs = performance.now();
    await waitForPlaybackRealtime(
      playhead,
      playbackSampleRate,
      playbackStartMs + pausedDurationMs,
      shouldStop,
      adaptiveLeadMs,
    );

    const backgroundEnded = playhead >= background.left.length;
    if (isDraining() && backgroundEnded && activeVoices.length === 0) {
      break;
    }

    for (let frame = 0; frame < chunkFrames; frame += 1) {
      const sourceFrame = playhead + frame;
      if (sourceFrame < backgroundLength) {
        mixedLeft[frame] = backgroundLeft[sourceFrame];
        mixedRight[frame] = backgroundRight[sourceFrame];
      } else {
        mixedLeft[frame] = 0;
        mixedRight[frame] = 0;
      }
    }

    // Voice-major accumulation removes a per-sample boundary branch from the hot path.
    for (let voiceIndex = 0; voiceIndex < activeVoices.length; voiceIndex += 1) {
      const voice = activeVoices[voiceIndex]!;
      const voiceFrames = Math.min(chunkFrames, voice.endPosition - voice.position);
      if (voiceFrames <= 0) {
        continue;
      }
      const voiceLeft = voice.sample.left;
      const voiceRight = voice.sample.right;
      const voiceGain = voice.gain;
      let sourceFrame = voice.position;
      if (Math.abs(voiceGain - 1) <= 1e-9) {
        for (let frame = 0; frame < voiceFrames; frame += 1) {
          mixedLeft[frame] += voiceLeft[sourceFrame];
          mixedRight[frame] += voiceRight[sourceFrame];
          sourceFrame += 1;
        }
      } else {
        for (let frame = 0; frame < voiceFrames; frame += 1) {
          mixedLeft[frame] += voiceLeft[sourceFrame] * voiceGain;
          mixedRight[frame] += voiceRight[sourceFrame] * voiceGain;
          sourceFrame += 1;
        }
      }
    }

    for (let frame = 0; frame < chunkFrames; frame += 1) {
      const sampleOffset = frame * 2;
      let leftSample = mixedLeft[frame];
      let rightSample = mixedRight[frame];

      if (outputDynamics) {
        const level = Math.max(Math.abs(leftSample), Math.abs(rightSample));
        if (outputDynamics.compressorEnabled) {
          const desiredCompressorGain =
            level > outputDynamics.compressorThresholdLinear
              ? Math.pow(level / outputDynamics.compressorThresholdLinear, outputDynamics.compressorInvRatioMinusOne)
              : 1;
          const compressorCoef =
            desiredCompressorGain < compressorGain
              ? outputDynamics.compressorAttackCoef
              : outputDynamics.compressorReleaseCoef;
          compressorGain = desiredCompressorGain + compressorCoef * (compressorGain - desiredCompressorGain);
        } else {
          compressorGain = 1;
        }

        const compressorAppliedGain = compressorGain * outputDynamics.compressorMakeupGain;
        leftSample *= compressorAppliedGain;
        rightSample *= compressorAppliedGain;

        if (outputDynamics.limiterEnabled) {
          const limitedLevel = Math.max(Math.abs(leftSample), Math.abs(rightSample));
          const desiredLimiterGain =
            limitedLevel > outputDynamics.limiterCeilingLinear && limitedLevel > 1e-9
              ? outputDynamics.limiterCeilingLinear / limitedLevel
              : 1;
          if (desiredLimiterGain < limiterGain) {
            // Limiter attack is immediate to avoid transient clipping.
            limiterGain = desiredLimiterGain;
          } else {
            limiterGain = desiredLimiterGain + outputDynamics.limiterReleaseCoef * (limiterGain - desiredLimiterGain);
          }
          leftSample *= limiterGain;
          rightSample *= limiterGain;
        } else {
          limiterGain = 1;
        }
      }

      chunkSamples[sampleOffset] = floatToInt16(leftSample);
      chunkSamples[sampleOffset + 1] = floatToInt16(rightSample);
    }

    advanceAndPruneActiveVoices(activeVoices, chunkFrames);
    playhead += chunkFrames;

    const writable = output.write(chunk);
    if (!writable) {
      await output.waitWritable(shouldStop);
    }

    const mixDurationMs = Math.max(0, performance.now() - mixStartedAtMs);
    adaptiveLeadMs = resolveAdaptiveLeadMs(
      adaptiveLeadMs,
      leadTuning,
      chunkDurationMs,
      mixDurationMs,
      activeVoices.length,
    );
  }

  if (shouldStop()) {
    return;
  }

  await output.end();
}

async function waitForPlaybackRealtime(
  playheadFrames: number,
  sampleRate: number,
  startMs: number,
  shouldStop: () => boolean,
  targetLeadMs: number,
): Promise<void> {
  const safeTargetLeadMs = Number.isFinite(targetLeadMs) ? Math.max(0, targetLeadMs) : MANUAL_AUDIO_TARGET_LEAD_MS;
  const targetLeadFrames = Math.max(0, Math.round((safeTargetLeadMs / 1000) * sampleRate));

  while (!shouldStop()) {
    const elapsedFrames = Math.floor(((performance.now() - startMs) / 1000) * sampleRate);
    const leadFrames = playheadFrames - elapsedFrames;
    if (leadFrames <= targetLeadFrames) {
      return;
    }

    const waitFrames = leadFrames - targetLeadFrames;
    const waitMs = Math.max(1, Math.ceil((waitFrames / sampleRate) * 1000));
    await delay(Math.min(waitMs, 3));
  }
}

function resolveAdaptiveLeadMs(
  currentLeadMs: number,
  tuning: AudioLeadTuning,
  chunkDurationMs: number,
  mixDurationMs: number,
  activeVoiceCount: number,
): number {
  const safeBaseLeadMs = Number.isFinite(tuning.baseLeadMs) ? Math.max(0, tuning.baseLeadMs) : 0;
  const safeMaxLeadMs = Number.isFinite(tuning.maxLeadMs)
    ? Math.max(safeBaseLeadMs, tuning.maxLeadMs)
    : AUDIO_TARGET_LEAD_MAX_MS;
  const safeStepUpMs =
    Number.isFinite(tuning.stepUpMs) && tuning.stepUpMs > 0 ? tuning.stepUpMs : AUDIO_TARGET_LEAD_STEP_UP_MS;
  const safeStepDownMs =
    Number.isFinite(tuning.stepDownMs) && tuning.stepDownMs > 0 ? tuning.stepDownMs : AUDIO_TARGET_LEAD_STEP_DOWN_MS;
  const safeCurrentLeadMs = Number.isFinite(currentLeadMs) ? Math.max(0, currentLeadMs) : safeBaseLeadMs;
  const safeChunkDurationMs = Number.isFinite(chunkDurationMs) ? Math.max(1, chunkDurationMs) : 1;
  const safeMixDurationMs = Number.isFinite(mixDurationMs) ? Math.max(0, mixDurationMs) : 0;

  const loadRatio = safeMixDurationMs / safeChunkDurationMs;
  let nextLeadMs = safeCurrentLeadMs;
  if (loadRatio >= 0.7) {
    nextLeadMs += safeStepUpMs;
  } else if (loadRatio <= 0.45) {
    nextLeadMs -= safeStepDownMs;
  }

  // Keep small baseline latency while granting temporary headroom for dense chord bursts.
  const polyphonyFloorMs = safeBaseLeadMs + Math.max(0, activeVoiceCount - 24) * 0.2;
  const minLeadMs = Math.max(safeBaseLeadMs, Math.min(safeMaxLeadMs, polyphonyFloorMs));
  if (nextLeadMs < minLeadMs) {
    nextLeadMs = minLeadMs;
  }
  return Math.min(safeMaxLeadMs, nextLeadMs);
}

function createAudioLeadTuning(options: PlayerOptions, mode: 'auto' | 'manual'): AudioLeadTuning {
  const defaultBaseLeadMs = mode === 'manual' ? MANUAL_AUDIO_TARGET_LEAD_MS : AUTO_AUDIO_TARGET_LEAD_MS;
  const baseLeadMs = resolvePositiveNumberOption(options.audioLeadMs, defaultBaseLeadMs);
  const maxLeadMs = Math.max(baseLeadMs, resolvePositiveNumberOption(options.audioLeadMaxMs, AUDIO_TARGET_LEAD_MAX_MS));
  const stepUpMs = resolvePositiveNumberOption(options.audioLeadStepUpMs, AUDIO_TARGET_LEAD_STEP_UP_MS);
  const stepDownMs = resolvePositiveNumberOption(options.audioLeadStepDownMs, AUDIO_TARGET_LEAD_STEP_DOWN_MS);
  return {
    baseLeadMs,
    maxLeadMs,
    stepUpMs,
    stepDownMs,
  };
}

function createOutputDynamicsConfig(options: PlayerOptions, sampleRate: number): OutputDynamicsConfig | undefined {
  const limiterEnabled = options.limiter !== false;
  const compressorEnabled = Boolean(options.compressor);
  if (!limiterEnabled && !compressorEnabled) {
    return undefined;
  }

  const compressorThresholdDb = Math.min(
    0,
    resolveFiniteNumberOption(options.compressorThresholdDb, DEFAULT_COMPRESSOR_THRESHOLD_DB),
  );
  const compressorThresholdLinear = Math.max(1e-4, dbToLinear(compressorThresholdDb));
  const compressorRatio = Math.max(
    1.01,
    resolvePositiveNumberOption(options.compressorRatio, DEFAULT_COMPRESSOR_RATIO),
  );
  const compressorInvRatioMinusOne = 1 / compressorRatio - 1;
  const compressorAttackMs = resolvePositiveNumberOption(options.compressorAttackMs, DEFAULT_COMPRESSOR_ATTACK_MS);
  const compressorReleaseMs = resolvePositiveNumberOption(options.compressorReleaseMs, DEFAULT_COMPRESSOR_RELEASE_MS);
  const compressorMakeupDb = resolveFiniteNumberOption(options.compressorMakeupDb, DEFAULT_COMPRESSOR_MAKEUP_DB);
  const compressorMakeupGain = dbToLinear(compressorMakeupDb);

  const limiterCeilingDb = Math.min(0, resolveFiniteNumberOption(options.limiterCeilingDb, DEFAULT_LIMITER_CEILING_DB));
  const limiterCeilingLinear = Math.max(1e-4, dbToLinear(limiterCeilingDb));
  const limiterReleaseMs = resolvePositiveNumberOption(options.limiterReleaseMs, DEFAULT_LIMITER_RELEASE_MS);

  return {
    compressorEnabled,
    compressorThresholdLinear,
    compressorInvRatioMinusOne,
    compressorAttackCoef: resolveTimeSmoothingCoef(compressorAttackMs, sampleRate),
    compressorReleaseCoef: resolveTimeSmoothingCoef(compressorReleaseMs, sampleRate),
    compressorMakeupGain,
    limiterEnabled,
    limiterCeilingLinear,
    limiterReleaseCoef: resolveTimeSmoothingCoef(limiterReleaseMs, sampleRate),
  };
}

function resolveFiniteNumberOption(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value;
}

function resolveTimeSmoothingCoef(timeMs: number, sampleRate: number): number {
  const safeTimeMs = Number.isFinite(timeMs) ? Math.max(0, timeMs) : 0;
  const safeSampleRate = Number.isFinite(sampleRate) ? Math.max(1, sampleRate) : 1;
  if (safeTimeMs <= 0) {
    return 0;
  }
  return Math.exp(-1 / ((safeTimeMs / 1000) * safeSampleRate));
}

function dbToLinear(db: number): number {
  const safeDb = Number.isFinite(db) ? db : 0;
  return 10 ** (safeDb / 20);
}

function resolvePositiveNumberOption(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function stripPlayableEvents(json: BeMusicJson): BeMusicJson {
  const cloned = structuredClone(json);
  cloned.events = cloned.events.filter((event) => !isPlayLaneSoundChannel(event.channel));
  return cloned;
}

function stripNonPlayableEvents(json: BeMusicJson): BeMusicJson {
  const cloned = structuredClone(json);
  cloned.events = cloned.events.filter(
    (event) => isPlayLaneSoundChannel(event.channel) || isBmsKeyVolumeChangeChannel(event.channel),
  );
  return cloned;
}

export function shouldUseAutoMixBgmHeadroomControl(options: PlayerOptions): boolean {
  return options.limiter === false;
}

async function renderAutoMixWithVolumeControls(
  json: BeMusicJson,
  bgmVolume: number,
  playVolume: number,
  options: {
    baseDir: string;
    tailSeconds: number;
    inferBmsLnTypeWhenMissing?: boolean;
    useBgmHeadroomControl?: boolean;
    onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
  },
): Promise<RenderResult> {
  if (bgmVolume === 1 && playVolume === 1) {
    return renderJson(json, options);
  }

  if (options.useBgmHeadroomControl !== true) {
    return renderJson(json, {
      ...options,
      normalize: false,
      resolveTriggerGain: (trigger) => (isPlayLaneSoundChannel(trigger.channel) ? playVolume : bgmVolume),
    });
  }

  const playableOnly = stripNonPlayableEvents(json);
  if (bgmVolume === 0) {
    return applyGainToRenderResult(await renderJson(playableOnly, options), playVolume);
  }

  const bgmOnly = stripPlayableEvents(json);
  if (playVolume === 0) {
    return applyGainToRenderResult(await renderJson(bgmOnly, options), bgmVolume);
  }

  const splitRenderOptions = {
    ...options,
    normalize: false,
  } as const;
  const [bgmRendered, playableRendered] = await Promise.all([
    renderJson(bgmOnly, splitRenderOptions),
    renderJson(playableOnly, splitRenderOptions),
  ]);
  const scaledPlayable = applyGainToRenderResult(playableRendered, playVolume);
  const scaledBgm = applyGainToRenderResult(bgmRendered, bgmVolume);
  const bgmHeadroomGain = resolveBgmHeadroomGain(scaledPlayable, scaledBgm);

  return mixRenderResults(applyGainToRenderResult(scaledBgm, bgmHeadroomGain), scaledPlayable);
}

async function buildRuntimeSampleMap(
  json: BeMusicJson,
  options: PlayerOptions,
  sampleRate: number,
  onProgress?: (progress: { loaded: number; total: number; sampleKey: string; samplePath?: string }) => void,
  chartWavGain = 1,
  inferBmsLnTypeWhenMissing = false,
  signal?: AbortSignal,
): Promise<Map<string, RenderResult>> {
  throwIfAborted(signal);
  const sampleMap = new Map<string, RenderResult>();
  const keys = collectRealtimeAudioSampleKeys(json, inferBmsLnTypeWhenMissing);

  if (keys.length === 0) {
    onProgress?.({
      loaded: 0,
      total: 0,
      sampleKey: '',
      samplePath: undefined,
    });
  }

  for (let index = 0; index < keys.length; index += 1) {
    throwIfAborted(signal);
    const key = keys[index];
    const sourcePath = json.resources.wav[key];
    const rendered = await renderSingleSample(key, sourcePath, {
      baseDir: options.audioBaseDir ?? process.cwd(),
      sampleRate,
      gain: chartWavGain,
      fallbackToneSeconds: 0.06,
      signal,
    });

    sampleMap.set(key, rendered);
    onProgress?.({
      loaded: index + 1,
      total: keys.length,
      sampleKey: key,
      samplePath: sourcePath,
    });
  }

  return sampleMap;
}

function buildEventPlaybackMap(
  json: BeMusicJson,
  inferBmsLnTypeWhenMissing: boolean,
): Map<BeMusicEvent, PlayableNotePlayback> {
  const playbackMap = new Map<BeMusicEvent, PlayableNotePlayback>();
  const resolver = createTimingResolver(json);
  for (const trigger of collectSampleTriggers(json, resolver, { inferBmsLnTypeWhenMissing })) {
    playbackMap.set(trigger.event, {
      offsetSeconds: trigger.sampleOffsetSeconds,
      durationSeconds: trigger.sampleDurationSeconds,
      sliceId: trigger.sampleSliceId,
    });
  }
  return playbackMap;
}

function collectRealtimeAudioTriggers(
  json: BeMusicJson,
  inferBmsLnTypeWhenMissing: boolean,
  includeChannel: (channel: string) => boolean = () => true,
  resolver: TimingResolver = createTimingResolver(json),
): Array<TimedSampleTrigger & RealtimeAudioTrigger> {
  const triggers = collectSampleTriggers(json, resolver, { inferBmsLnTypeWhenMissing });
  const filtered: Array<TimedSampleTrigger & RealtimeAudioTrigger> = [];
  for (const trigger of triggers) {
    if (!includeChannel(trigger.channel)) {
      continue;
    }
    filtered.push({
      ...trigger,
      seconds: Math.max(0, trigger.seconds),
      channel: normalizeChannel(trigger.channel),
    });
  }
  return filtered;
}

function collectRealtimeAudioSampleKeys(json: BeMusicJson, inferBmsLnTypeWhenMissing: boolean): string[] {
  const resolver = createTimingResolver(json);
  const keys = new Set<string>();
  for (const trigger of collectSampleTriggers(json, resolver, { inferBmsLnTypeWhenMissing })) {
    keys.add(trigger.sampleKey);
  }
  return [...keys];
}

function isInvisiblePlayLaneSoundChannel(channel: string): boolean {
  const normalized = normalizeChannel(channel);
  if (normalized.length !== 2) {
    return false;
  }
  const high = normalized.charCodeAt(0);
  const low = normalized.charCodeAt(1);
  return (high === 0x33 || high === 0x34) && low >= 0x31 && low <= 0x39;
}

function createSilentRenderResult(sampleRate: number): RenderResult {
  const safeSampleRate = Number.isFinite(sampleRate)
    ? Math.max(8_000, Math.floor(sampleRate))
    : RUNTIME_AUDIO_SAMPLE_RATE;
  const left = new Float32Array(0);
  const right = new Float32Array(0);
  return {
    sampleRate: safeSampleRate,
    left,
    right,
    durationSeconds: 0,
    peak: 0,
  };
}

function normalizeBgmVolume(value: number | undefined, masterVolume = 1): number {
  return normalizeBusVolume(value, masterVolume);
}

function normalizePlayVolume(value: number | undefined, masterVolume = 1): number {
  return normalizeBusVolume(value, masterVolume);
}

function normalizeMasterVolume(value: number | undefined): number {
  return normalizeBusVolume(value, 1);
}

function normalizeBusVolume(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, value) * fallback;
}

function applyGainToRenderResult(result: RenderResult, gain: number): RenderResult {
  if (gain === 1) {
    return result;
  }

  const left = new Float32Array(result.left.length);
  const right = new Float32Array(result.right.length);
  for (let index = 0; index < result.left.length; index += 1) {
    left[index] = result.left[index] * gain;
    right[index] = result.right[index] * gain;
  }

  return {
    sampleRate: result.sampleRate,
    left,
    right,
    durationSeconds: result.durationSeconds,
    peak: measureRenderPeak(left, right),
  };
}

function mixRenderResults(leftResult: RenderResult, rightResult: RenderResult): RenderResult {
  if (leftResult.sampleRate !== rightResult.sampleRate) {
    return leftResult;
  }

  const frameLength = Math.max(leftResult.left.length, rightResult.left.length);
  const mixedLeft = new Float32Array(frameLength);
  const mixedRight = new Float32Array(frameLength);

  for (let frame = 0; frame < frameLength; frame += 1) {
    const left = (leftResult.left[frame] ?? 0) + (rightResult.left[frame] ?? 0);
    const right = (leftResult.right[frame] ?? 0) + (rightResult.right[frame] ?? 0);
    mixedLeft[frame] = left;
    mixedRight[frame] = right;
  }

  return {
    sampleRate: leftResult.sampleRate,
    left: mixedLeft,
    right: mixedRight,
    durationSeconds: frameLength / leftResult.sampleRate,
    peak: measureRenderPeak(mixedLeft, mixedRight),
  };
}

export function resolveBgmHeadroomGain(playableResult: RenderResult, bgmResult: RenderResult): number {
  const playableLeft = playableResult.left;
  const playableRight = playableResult.right;
  const bgmLeft = bgmResult.left;
  const bgmRight = bgmResult.right;
  const frameLength = Math.max(playableLeft.length, bgmLeft.length);
  let headroomGain = 1;

  // Keep playable/key-sound amplitude intact by shrinking only the BGM side when summed peak would clip.
  for (let frame = 0; frame < frameLength; frame += 1) {
    const playableLeftAbs = Math.abs(playableLeft[frame] ?? 0);
    const playableRightAbs = Math.abs(playableRight[frame] ?? 0);
    const bgmLeftAbs = Math.abs(bgmLeft[frame] ?? 0);
    const bgmRightAbs = Math.abs(bgmRight[frame] ?? 0);
    headroomGain = Math.min(
      headroomGain,
      resolveBgmHeadroomGainForChannel(playableLeftAbs, bgmLeftAbs),
      resolveBgmHeadroomGainForChannel(playableRightAbs, bgmRightAbs),
    );
  }

  return Math.max(0, Math.min(1, headroomGain));
}

function resolveBgmHeadroomGainForChannel(playableAbs: number, bgmAbs: number): number {
  if (bgmAbs <= 1e-9) {
    return 1;
  }
  const availableHeadroom = 1 - playableAbs;
  if (availableHeadroom <= 0) {
    // Play-side already clips by itself: do not force BGM to complete silence here.
    return 1;
  }
  return Math.min(1, availableHeadroom / bgmAbs);
}

function measureRenderPeak(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftAbs = Math.abs(left[index]);
    if (leftAbs > peak) {
      peak = leftAbs;
    }
    const rightAbs = Math.abs(right[index]);
    if (rightAbs > peak) {
      peak = rightAbs;
    }
  }
  return peak;
}

function createPlaybackClock(startAtMs: number): PlaybackClock {
  const anchorMs = Number.isFinite(startAtMs) ? startAtMs : performance.now();
  let paused = false;
  let pausedAtMs = 0;
  let pausedDurationMs = 0;

  const nowMs = (): number => {
    const reference = paused ? pausedAtMs : performance.now();
    return Math.max(0, reference - anchorMs - pausedDurationMs);
  };

  return {
    nowMs,
    isPaused: () => paused,
    pause: () => {
      if (paused) {
        return false;
      }
      paused = true;
      pausedAtMs = performance.now();
      return true;
    },
    resume: () => {
      if (!paused) {
        return false;
      }
      pausedDurationMs += Math.max(0, performance.now() - pausedAtMs);
      paused = false;
      pausedAtMs = 0;
      return true;
    },
  };
}

function elapsedMsToGameSeconds(elapsedMs: number, speed: number): number {
  return Math.max(0, (elapsedMs / 1000) * speed);
}

async function waitPrecise(delayMs: number): Promise<void> {
  const target = performance.now() + Math.max(0, delayMs);
  while (true) {
    const remaining = target - performance.now();
    if (remaining <= 0) {
      return;
    }
    if (remaining > 8) {
      await delay(remaining - 4);
      continue;
    }
    await delayImmediate();
  }
}

function addHeadPadding(result: RenderResult, paddingMs: number): RenderResult {
  const safePaddingMs = Number.isFinite(paddingMs) ? Math.max(0, paddingMs) : 0;
  if (safePaddingMs === 0) {
    return result;
  }

  const paddingFrames = Math.round((safePaddingMs / 1000) * result.sampleRate);
  if (paddingFrames <= 0) {
    return result;
  }

  const left = new Float32Array(result.left.length + paddingFrames);
  const right = new Float32Array(result.right.length + paddingFrames);
  left.set(result.left, paddingFrames);
  right.set(result.right, paddingFrames);

  return {
    ...result,
    left,
    right,
    durationSeconds: left.length / result.sampleRate,
  };
}

function toPlaybackSampleRate(baseSampleRate: number, speed: number): number {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const scaled = Math.round(baseSampleRate * safeSpeed);
  return Math.max(8_000, Math.min(192_000, scaled));
}

function printLaneMap(writeOutput: (text: string) => void, bindings: LaneBinding[]): void {
  writeOutput('Channel map:\n');
  for (const binding of bindings) {
    writeOutput(`  ${binding.channel} => ${binding.keyLabel}\n`);
  }
}

function resolveNoteKeyLabel(channel: string, keyMap: ReadonlyMap<string, string>): string {
  const normalized = normalizeChannel(channel);
  if (keyMap.has(normalized)) {
    return keyMap.get(normalized) ?? '?';
  }
  if (normalized === '17') {
    return keyMap.get('16') ?? '?';
  }
  if (normalized === '27') {
    return keyMap.get('26') ?? '?';
  }
  return '?';
}

function formatGrooveGaugeNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '-';
  }
  const rounded = Math.round(value);
  return Math.abs(value - rounded) <= 1e-9 ? String(rounded) : value.toFixed(2);
}

function formatGrooveGaugeStatus(summary: PlayerSummary): string {
  return summary.gauge?.cleared === true ? 'CLEAR' : 'FAILED';
}

function renderSummary(summary: PlayerSummary): string {
  const maxExScore = Math.max(0, summary.total * IIDX_EX_SCORE_PER_PGREAT);
  const exScoreRate = maxExScore > 0 ? summary.exScore / maxExScore : 0;
  const scoreRate = summary.score / IIDX_SCORE_MAX;
  const gauge = summary.gauge;
  return (
    [
      '--- Result ---',
      `TOTAL  : ${summary.total}`,
      ...(gauge
        ? [
            `GAUGE  : ${gauge.current.toFixed(2)} / ${gauge.max.toFixed(2)} ${formatGrooveGaugeStatus(summary)} (TOTAL ${formatGrooveGaugeNumber(gauge.effectiveTotal)})`,
          ]
        : []),
      `PGREAT : ${summary.perfect}`,
      `GREAT  : ${summary.great}`,
      `GOOD   : ${summary.good}`,
      `BAD    : ${summary.bad}`,
      `POOR   : ${summary.poor}`,
      `FAST   : ${summary.fast}`,
      `SLOW   : ${summary.slow}`,
      `EX-SCORE: ${summary.exScore} / ${maxExScore} (${(exScoreRate * 100).toFixed(2)}%)`,
      `SCORE   : ${summary.score} / ${IIDX_SCORE_MAX} (${(scoreRate * 100).toFixed(2)}%)`,
    ].join('\n') + '\n'
  );
}
