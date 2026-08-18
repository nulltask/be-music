import {
  collectLnobjEndEvents,
  createBeatResolver,
  isBmsBgmVolumeChangeChannel,
  isBmsDynamicVolumeChangeChannel,
  isBmsKeyVolumeChangeChannel,
  isPlayLaneSoundChannel,
  parseBmsDynamicVolumeGain,
  sortEvents,
  usesMonophonicWavPlayback,
} from '@be-music/chart';
// Hand-rolled polyfills replace what was previously imported from `node:path` / `node:timers/promises`. Keeping the
// engine free of `node:`-prefixed imports lets the same module run unchanged in the browser (Phase 4 of the
// web-engine integration plan) without depending on bundler-side aliases. The behaviors below are deliberately
// minimal — `basename` only needs the trailing-segment semantics for log output, and `delay` only needs to resolve
// after `ms` ms (matches `node:timers/promises.setTimeout`).
const basename = (path: string): string => {
  // Match `node:path.basename`'s "drop the trailing separator(s) and return the final segment" semantics for both
  // POSIX and Windows-style separators. An all-separator input ("/" / "\\") returns an empty string.
  const trimmed = path.replace(/[\\/]+$/, '');
  const lastSep = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return lastSep === -1 ? trimmed : trimmed.slice(lastSep + 1);
};
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
import { findFirstIndexNumberAtOrAfter, floatToInt16, throwIfAborted } from '@be-music/utils/core';
import type { LogEntry, LogLevel } from '@be-music/utils/log';
import {
  type BeMusicEvent,
  type BeMusicJson,
  normalizeChannel,
  normalizeObjectKey,
  resolveBmsBase,
} from '@be-music/json';
import { resolveBmsControlFlow } from '@be-music/parser';
import {
  type RenderResult,
  type TimedSampleTrigger,
  type TimingResolver,
  collectSampleTriggers,
  createTimingResolver,
  renderSingleSample,
} from '@be-music/audio-renderer';
import { createPlayerStateSignals, type PlayerStateSignals } from '../state-signals.ts';
import { findLaneSoundCandidate, lowerBoundBySeconds } from '../judging.ts';
import { type ChartPlayVariant, type LaneBinding } from './lane-layout.ts';
import { type LongNoteMode, type TimedLandmineNote, type TimedPlayableNote } from '../playable-notes.ts';
import { type ImageResizeAlgorithm } from '../image-resize-algorithm.ts';
import { type TuiNoteHeight } from './ui-options.ts';
import { formatSeconds, resolveAltModifierLabel, resolveChartVolWavGain } from '../utils.ts';
import { createNodeAudioSink, type AudioSink, type AudioSinkClockState } from '../audio-sink.ts';
import {
  applyHighSpeedControlAction,
  resolveHighSpeedControlActionFromLaneChannels,
  resolveHighSpeedMultiplier,
  type HighSpeedControlAction,
} from './high-speed-control.ts';
import { createPlayerUiSignalBus, type PlayerGaugeSummary, type PlayerUiSignalBus } from './ui-signal-bus.ts';
import { createPlayerInputSignalBus, type PlayerInputSignalBus } from './input-signal-bus.ts';
import { createInputWakeUp } from './input-wakeup.ts';
import {
  applyGaugeDeltaWithLogging,
  applyGaugeJudgeWithLogging,
  applyPlaybackHighSpeedAction,
  consumePlaybackInputCommands,
  createNoopPlaybackStateLogger,
  createUiFramePublisher,
  setLoggedComboValue,
  togglePlaybackPause,
  type PlaybackStateLogger,
} from './playback-support.ts';
import {
  IIDX_EX_SCORE_PER_PGREAT,
  LR2_MONEY_SCORE_MAX,
  applyJudgeToSummary,
  createScoreTracker,
  type JudgeKind,
} from './scoring.ts';
import { type GrooveGaugeJudgeKind, type GrooveGaugeType } from './groove-gauge.ts';
import { resolveLandmineGaugeEffect } from './landmine.ts';
import {
  resolveBmsJudgeWindowsMsForExRankValue,
  resolveJudgeWindowsMs,
  type JudgeWindowRuleset,
} from './judge-window.ts';
import {
  classifyRulesetJudge,
  goodWindowReachUs,
  preferJudgeCandidate,
  judgeWindowEarlyReachUs,
  judgeWindowLateReachUs,
  resolveRuleset,
  rulesetChartFactsFromChart,
  RULESET_JUDGE_NONE,
  selectJudgeWindowSet,
  type JudgeSelectionCandidate,
  type JudgeWindowSetUs,
  type LongNoteStyle,
  type RulesetJudgeIndex,
  type RulesetWindowTables,
} from '../ruleset/index.ts';
import { createPlaylogRecorder, type PlaylogRecordingOptions } from '../playlog/recorder.ts';
import type { BeMusicPlaylog, PlaylogInputEvent } from '../playlog/format.ts';
import {
  createBeatAtSecondsResolverFromTimingResolver,
  createBpmTimeline,
  createScrollTimeline,
  createSpeedTimeline,
  createStopBeatWindows,
} from './timeline.ts';
import {
  createInitialPlayerSummary,
  initializePlayerUiRuntime,
  preparePlaybackChartData,
  type PreparedPlaybackChartData,
} from './bootstrap.ts';

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
  tuiVisibleNotesLimit?: number;
  tuiNoteHeight: TuiNoteHeight;
  judgeWindowMs: number;
  highSpeed: number;
  imageResizeAlgorithm: ImageResizeAlgorithm;
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
  tuiVisibleNotesLimit?: number;
  tuiNoteHeight?: TuiNoteHeight;
  imageResizeAlgorithm?: ImageResizeAlgorithm;
  highSpeed?: number;
  judgeWindowMs?: number;
  debugActiveAudio?: boolean;
  leadInMs?: number;
  audio?: boolean;
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
  audioBaseDir?: string;
  /**
   * Debug aid — synthesizes a short sine tone for `#WAVxx` references whose file is missing or fails to decode.
   * The spec-compliant default is silence (LR2 / beatoraja play nothing for a broken keysound reference); enable
   * this only in test rigs / chart debugging where hearing that a trigger fired matters.
   */
  missingSampleToneSeconds?: number;
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
  /**
   * Direct lane-mode override. When set, the engine's `resolveLaneMode` skips its content-based
   * heuristic and routes straight to the corresponding `LaneMode`:
   *
   *   - `'5'`  → `5-key-sp`     - `'10'` → `5-key-dp`
   *   - `'7'`  → `7-key-sp`     - `'14'` → `14-key-dp`
   *   - `'9'`  → `9-key`        - `'24'` → `24-key-sp` / `48-key-dp` (resolved against 2P presence)
   *
   * Mirrors the renderer-side `chartVariant` the host has already classified the chart as. The
   * engine's own heuristic only escalates to `9-key` when the chart is `.pms` OR `#PLAYER=3`
   * with channel `17`, which under-classifies BME-format POPN-9 charts that author `#PLAYER 1`
   * + channels 16/17/18/19. Without this override, those charts mounted on a 9-key skin /
   * adapter (via the host) had their `f/v/g/b` inputs dropped because the engine's lane
   * bindings followed `7-key-sp` (channel 16 → scratch, channel 17 → FREE ZONE, etc.).
   *
   * User report: 9 KEY laser and bomb sprites failed to appear. The previous
   * `laneModeExtension`-only inference (c0da7b5) only worked for charts the heuristic could
   * classify; this override lets the host force the engine into the variant it already decided on.
   */
  playVariant?: ChartPlayVariant;
  /**
   * Pre-built playback chart data the host wants the engine to use verbatim instead of running its own
   * `preparePlaybackChartData` pass. When provided, the engine treats the supplied {@link PreparedPlaybackChartData}
   * as the single source of truth for the playable / landmine / invisible / scorable note arrays, the lane
   * bindings, the input-token map, the active free-zone channel set, and the playback's `totalSeconds`.
   *
   * Why this exists: the web renderer used to call `extractTimedNotes` independently of the engine to build its
   * own `notes` / `mineNotes` / `invisibleNotes` arrays, and `applyEngineFrame` then synced the engine's
   * per-note `judged` flag onto the renderer's parallel arrays by **shared array index**. Any divergence
   * between the two extract calls (a different `inferBmsLnTypeWhenMissing` flag, a different
   * `laneModeExtension`, a stale `bms.controlFlow` array re-resolved on the engine side, a `random1P: 'OFF'`
   * truthy-check evaluating to `false` because `'OFF'` is a non-empty string, …) shifted the index alignment
   * and the renderer ended up applying judge flags to the wrong notes — symptoms ranged from notes vanishing
   * partway down the lane in HIDE-on-judge mode, to mid-chart full-combo cues, to AUTO PLAY exScore landing
   * below the EX-MAX 200_000 ceiling. Each of those was patched by aligning one more argument between the
   * two extract sites, but the underlying design was inherently fragile.
   *
   * Letting the host hand the engine a ready-made `preparedChart` removes the entire class of bugs at the
   * structural level: the renderer and the engine literally hold the same `TimedPlayableNote[]` / `TimedLandmineNote[]`
   * instances, so any judge mutation the engine performs on a note is visible to the renderer with no sync
   * step, and there is no second extract that could disagree with the first.
   *
   * Hosts that omit this option (TUI, every existing test) keep the original behavior — the engine
   * runs its own `preparePlaybackChartData` internally, just like before.
   */
  preparedChart?: PreparedPlaybackChartData;
  createUiRuntime?: (context: CreatePlayerUiRuntimeContext) => Promise<PlayerUiRuntime | undefined>;
  createInputRuntime?: (context: CreatePlayerInputRuntimeContext) => PlayerInputRuntime | undefined;
  /**
   * Optional override for the audio playback backend. When provided, the engine routes every sample trigger / channel
   * stop / pause-resume / finish-dispose through the returned {@link AudioSession} instead of the bundled Node
   * `createNodeAudioSink` path. Used by the web (Pixi) runtime to wire a Web Audio API backend through the same
   * judging code the TUI runs, so both runtimes hit the engine's beatoraja-compliant judge / fallback / LN logic
   * without each one re-implementing it.
   *
   * Returning `undefined` (or omitting the option entirely) preserves the original behavior — the engine falls
   * through to the Node sink, which is what every existing TUI / test path already relies on.
   */
  createAudioSession?: (context: CreateAudioSessionContext) => Promise<AudioSession | undefined>;
  onResolvedChart?: (json: BeMusicJson) => void;
  onLog?: (entry: LogEntry) => void;
  writeOutput?: (text: string) => void;
  /**
   * Host-declared play settings merged into the recorded play-log (`gauge`, `randomLane`, `dpFlip`, `native`).
   * The engine itself knows mode / auto-scratch / judge-window override; everything host-side (which gauge the
   * player picked, which lane shuffle produced `preparedChart`, ...) arrives through this bag. Only meaningful
   * together with {@link onPlaylogRecorded}.
   */
  recordPlaylog?: PlaylogRecordingOptions;
  /**
   * Enables play-log recording: when set, the engine snapshots the resolved chart it actually played
   * (post-`#RANDOM`, post lane-shuffle via `preparedChart`), records every judged key press / release with
   * chart-relative timestamps, and hands the assembled {@link BeMusicPlaylog} here right before `autoPlay` /
   * `manualPlay` resolves — including the ESC (aborted) exit. The playlog's `results.native` caches this run's
   * engine summary; see `@be-music/player/playlog` for the format and the LR2 / beatoraja / IIDX re-simulation
   * tools.
   */
  onPlaylogRecorded?: (playlog: BeMusicPlaylog) => void;
  /**
   * Judge-window ruleset for manual play: `'lr2'` (default — the engine's LR2-aligned windows), `'beatoraja'`
   * (SEVENKEYS windows scaled by beatoraja's judgerank), or `'iidx'` (fixed ±16.67/±33.33/±116.67/±250 ms).
   * Only the WINDOW WIDTHS switch — note selection, empty-POOR, long-note mechanics, and the gauge stay on the
   * engine's LR2-aligned semantics (the playlog simulators are the full per-ruleset reproduction). Dynamic
   * `#EXRANKxx` changes are an LR2 concept and only apply under `'lr2'`. Recorded into the playlog
   * (`play.judgeRuleset`) so replays re-apply the same windows.
   */
  judgeRuleset?: JudgeWindowRuleset;
  /**
   * Gauge the player selected, as an LR2-family id (`'GROOVE'` / `'EASY'` / `'HARD'` / `'DEATH'`). Mapped onto the
   * active ruleset's own line-up — `'GROOVE'` is beatoraja's `NORMAL`, `'DEATH'` is its `HAZARD`, and so on.
   * Defaults to `'GROOVE'`.
   */
  gauge?: GrooveGaugeType;
  /**
   * Replay playback: a recorded play-log input stream (`playlog.inputs`) `manualPlay` re-drives DETERMINISTICALLY.
   * Each event fires at its exact chart-relative microsecond timestamp (no wall-clock jitter — the judge timestamp
   * is the recorded one), so replaying a log against the same resolved chart reproduces the original judgments.
   * While a replay is active, live lane / kitty input commands are ignored; pause, high-speed, and interrupt
   * commands keep working. The caller is responsible for mounting the SAME resolved chart the log was recorded
   * against (`preparedChart`, or a chart remapped to the log's note arrangement).
   */
  replayInputs?: readonly PlaylogInputEvent[];
}

export interface PlayerSummary {
  /**
   * The active ruleset's judgment count — its EX-SCORE denominator. Charge-note styles count a long note's head
   * and tail separately, so this is NOT always the number of notes on screen.
   */
  total: number;
  perfect: number;
  fast: number;
  slow: number;
  great: number;
  good: number;
  bad: number;
  /** Notes that were missed or hit outside every scoring window. Empty POORs are counted separately. */
  poor: number;
  /**
   * Empty POOR (空POOR) — a press with no note in reach but one inside the ruleset's miss window. It costs gauge
   * and fires the POOR cue without consuming a note, so it never reaches EX-SCORE and is tracked apart from
   * `poor`. Whether a player's POOR counter displays the two summed is a per-ruleset presentation choice: LR2 does
   * (OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for it), which is why the split is exposed here.
   */
  emptyPoor: number;
  exScore: number;
  score: number;
  gauge?: PlayerGrooveGaugeSummary;
}

/** @see {@link PlayerGaugeSummary} — the canonical declaration lives beside the UI frame payload. */
export type PlayerGrooveGaugeSummary = PlayerGaugeSummary;

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

/**
 * The audio playback contract the engine uses regardless of which runtime backs it. The default Node implementation
 * created in {@link createAudioSessionIfEnabled} wraps `node-web-audio-api`; alternative runtimes (browser Web Audio,
 * test mocks) implement this same shape and plug in via {@link PlayerOptions.createAudioSession}.
 *
 * **Lifetime**: caller invokes `start()` once chart playback begins, `pause()` / `resume()` during input-driven
 * pauses, and exactly one of `finish()` (graceful drain) or `dispose()` (abort, no drain) at the end of playback.
 *
 * **Optional methods** are absent on backends that don't model the corresponding concept — e.g. test mocks may
 * skip clock state, and pure-render backends may not handle `triggerEvent` / `stopChannel`.
 */
export interface AudioSession {
  start: () => void;
  finish: () => Promise<void>;
  dispose: () => Promise<void>;
  /**
   * Milliseconds to wait between {@link start} and the chart's note-zero moment. Backends that need a known lead-in
   * (e.g. to fully fill an audio output buffer before the chart's first note) report it here so the engine schedules
   * note timings against this offset.
   */
  chartStartDelayMs: number;
  backendLabel: string;
  pause: () => void;
  resume: () => void;
  getClockState?: () => AudioSinkClockState;
  getActiveAudioFiles?: () => string[];
  getActiveAudioVoiceCount?: () => number;
  triggerEvent?: (event: BeMusicEvent) => void;
  stopChannel?: (channel: string) => void;
}

/**
 * Context handed to a {@link PlayerOptions.createAudioSession} factory. Mirrors the inputs the engine's built-in
 * Node session would consume so a custom backend can apply the same chart-derived gain / volume semantics. Forward-
 * compatible: backends should ignore unrecognized fields.
 */
export interface CreateAudioSessionContext {
  json: BeMusicJson;
  options: PlayerOptions;
  mode: 'auto' | 'manual';
  onLoadProgress?: (progress: AudioSessionLoadProgress) => void;
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

const LANDMINE_EXPLOSION_SAMPLE_KEY = '00';

interface PlaybackClock {
  nowMs: () => number;
  scheduledMs: () => number;
  isPaused: () => boolean;
  pause: () => boolean;
  resume: () => boolean;
}

interface PlaybackClockSource {
  nowMs: () => number;
  scheduledMs?: () => number;
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

interface TimedManualJudge {
  kind: JudgeKind;
  signedDeltaMs: number;
}

interface ActiveLongNoteState {
  endSeconds: number;
  note: TimedPlayableNote;
  mode: 1 | 2 | 3;
  headJudge: TimedManualJudge;
  /**
   * Last second-mark already accounted for by the HCN gauge gain / drain accumulator.
   * Per-frame advances apply `(nowSec - cursor) × rate` either to the gain or drain side
   * (mode 3 only) before pushing the cursor forward to `nowSec`. Mirrors upstream
   * `JudgeManager.java:299-349`'s `mpassingcount` accumulator, but at the per-frame
   * granularity our engine ticks rather than upstream's 200 ms timer step — the integrated
   * gauge delta is mathematically equivalent for the same elapsed duration.
   */
  gaugeDrainCursorSeconds: number;
  audioStopped: boolean;
  /**
   * True when `headJudge` has ALREADY been applied to the score (charge modes judge the head on the press). The
   * tail then stands alone; LN mode instead defers, and resolves head and tail into one combined judgment.
   */
  headScored: boolean;
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
/**
 * Per-second gauge drain rate while a Hell-Charge LN (mode 3) is being held UNHELD (= the
 * player isn't actively pressing the key during the body of the LN).
 *
 * Upstream `JudgeManager.java:324-340` integrates 0.5% per 200 ms tick = 2.5%/sec. We
 * apply the same rate continuously per frame because the engine doesn't have a hard
 * 200 ms ticker — `(nowSec - cursor) × rate` integrated each frame produces the same
 * total drain over the same elapsed duration.
 *
 * The previous value (`6` = 6%/sec) was empirically tuned without referencing upstream and
 * made HCN charts effectively unclear-able: a 1-second hold-break drained ~6% in addition
 * to the BAD-on-tail penalty, so a player who momentarily lost grip lost roughly twice
 * the gauge upstream would have taken.
 */
const HELL_CHARGE_GAUGE_DRAIN_PER_SECOND = 2.5;
/**
 * Per-second gauge GAIN rate while a Hell-Charge LN (mode 3) is being held SUCCESSFULLY.
 *
 * Upstream `JudgeManager.java:324-329` calls `gauge.update(1, 0.5f)` per 200 ms tick under
 * the gain branch = 2.5%/sec. The previous TS impl had no gain branch at all (held HCNs
 * couldn't recover gauge at all), which contradicted HCN's design intent: the chart
 * authors EXPECT the player to claw back gauge by sustaining holds across the body. With
 * gain disabled, breaking a hold for any duration was permanently destructive.
 */
const HELL_CHARGE_GAUGE_GAIN_PER_SECOND = 2.5;
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
export { preparePlaybackChartData, type PreparedPlaybackChartData };

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

/** Renders one window set as `PGREAT -8.0/+8.0ms ...` (early / late reach) for the TUI's start banner. */
function formatJudgeWindowSet(windows: JudgeWindowSetUs): string {
  return RULESET_JUDGE_KINDS.map((kind, index) => {
    const [lateBoundUs, earlyBoundUs] = windows.judges[index]!;
    return `${kind} -${(earlyBoundUs / 1000).toFixed(1)}/+${(-lateBoundUs / 1000).toFixed(1)}ms`;
  }).join(' ');
}

/** True when a playable note carries a tail — a long / charge note rather than a single hit. */
function isLongPlayableNote(note: TimedPlayableNote): boolean {
  return typeof note.endSeconds === 'number' && Number.isFinite(note.endSeconds) && note.endSeconds > note.seconds;
}

/** Judge indices, best to worst, in the order the ruleset window sets use. */
const RULESET_JUDGE_KINDS: readonly [JudgeKind, JudgeKind, JudgeKind, JudgeKind] = [
  'PERFECT',
  'GREAT',
  'GOOD',
  'BAD',
];

/**
 * Classify a signed timing delta against one ruleset window set, or `undefined` when the press cannot reach the
 * note at all. Both legs of every window matter: beatoraja's seven-key BAD window reaches 280 ms late but only
 * 220 ms early, so "within the BAD width" is not a question that can be asked of an absolute delta.
 *
 * `signedDeltaMs` is the engine's convention (positive = the press was LATE); the window tables use beatoraja's
 * (`noteTime - inputTime`, positive = EARLY), hence the negation.
 */
function resolveManualJudgeKind(signedDeltaMs: number, windows: JudgeWindowSetUs): JudgeKind | undefined {
  const judge = classifyRulesetJudge(-signedDeltaMs * 1000, windows);
  return judge === RULESET_JUDGE_NONE ? undefined : RULESET_JUDGE_KINDS[judge];
}

/**
 * Same classification, for contexts where "out of reach" is itself a miss — a long-note end that the player never
 * released inside its window is a POOR, not a non-event.
 */
function resolveManualTimedJudge(signedDeltaMs: number, windows: JudgeWindowSetUs): TimedManualJudge {
  return {
    kind: resolveManualJudgeKind(signedDeltaMs, windows) ?? 'POOR',
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

/**
 * How the active ruleset plays this long note, which is not always what the chart's `#LNMODE` asks for:
 *
 * - LR2 (`'ln'`) plays every long note as an LN — one deferred judgment, early release is a BAD.
 * - beatoraja (`'per-note'`) honours the chart: 1 = LN, 2 = CN, 3 = HCN.
 * - IIDX (`'charge'`) has no LN at all — every long note is a charge note, HCN where the chart says 3.
 *
 * Charge modes (2 / 3) judge the head and the tail separately, so they contribute two judgments to the score.
 */
function resolveEffectiveLongNoteMode(style: LongNoteStyle, chartMode: LongNoteMode): LongNoteMode {
  switch (style) {
    case 'ln':
      return 1;
    case 'charge':
      return chartMode === 3 ? 3 : 2;
    default:
      return chartMode;
  }
}

/** True for the modes that score the head on the press and the tail on the release. */
function isChargeLongNoteMode(mode: LongNoteMode): boolean {
  return mode === 2 || mode === 3;
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

function emitPlayerLog(options: PlayerOptions, level: LogLevel, event: string, fields?: Record<string, unknown>): void {
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
  const normalizedResourcePath =
    typeof resourcePath === 'string' ? normalizeLoggedResourcePath(resourcePath) : undefined;
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
  base: 36 | 62 = 36,
): { sampleKey: string; resourcePath?: string } {
  const sampleKey = normalizeObjectKey(event.value, base);
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
  source: 'auto-note' | 'auto-scratch' | 'manual-note' | 'lane-fallback' | 'mine-hit',
  channel?: string,
  base: 36 | 62 = 36,
): void {
  const { sampleKey, resourcePath } = resolveEventResourceInfo(resources, event, base);
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

function resolveLandmineExplosionEvent(
  landmineEvent: BeMusicEvent,
  resources: Readonly<Record<string, string>>,
): BeMusicEvent | undefined {
  const sourcePath = resources[LANDMINE_EXPLOSION_SAMPLE_KEY];
  if (typeof sourcePath !== 'string' || sourcePath.length === 0) {
    return undefined;
  }
  return {
    ...landmineEvent,
    value: LANDMINE_EXPLOSION_SAMPLE_KEY,
  };
}

// Mine gauge-damage resolution lives in `core/landmine.ts` so the play-log recorder / simulators share the
// exact same value interpretation. Re-imported here for the manual landmine hit path.

function writeSampleStopEventLog(
  writeOutput: (text: string) => void,
  channel: string,
  seconds: number,
  reason: 'long-note-release' | 'long-note-break',
  event?: BeMusicEvent,
  resources?: Readonly<Record<string, string>>,
  base: 36 | 62 = 36,
): void {
  const resourceInfo = event && resources ? resolveEventResourceInfo(resources, event, base) : undefined;
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
  /**
   * Object-ID radix used for resolving sample keys in `logLongNoteState`. Defaults to base 36; pass `62` for charts
   * that opted into `#BASE 62` so lowercase IDs hit the right resource entry instead of being case-folded.
   */
  base?: 36 | 62;
}): PlaybackStateLogger {
  const { writeOutput, summary } = params;
  const base = params.base ?? 36;

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
      const { sampleKey, resourcePath } = resolveEventResourceInfo(logParams.resources, logParams.event, base);
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

function writeRealtimeVolumeEventLog(writeOutput: (text: string) => void, seconds: number, event: BeMusicEvent): void {
  const normalizedChannel = normalizeChannel(event.channel);
  const target = isBmsKeyVolumeChangeChannel(normalizedChannel)
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
  base: 36 | 62 = 36,
): LoggedBgaCue[] {
  const normalizedChannel = normalizeChannel(channel);
  const timeline: LoggedBgaCue[] = [];
  for (const event of sortedEvents) {
    if (normalizeChannel(event.channel) !== normalizedChannel) {
      continue;
    }
    const key = normalizeObjectKey(event.value, base);
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

function createScheduledPlaybackEvent(
  seconds: number,
  order: number,
  text: string,
): NoTuiScheduledPlaybackEvent | undefined {
  if (!Number.isFinite(seconds)) {
    return undefined;
  }
  return {
    seconds: Math.max(0, seconds),
    order,
    text,
  };
}

function mergeScheduledPlaybackEventGroups(
  groups: ReadonlyArray<ReadonlyArray<NoTuiScheduledPlaybackEvent>>,
): NoTuiScheduledPlaybackEvent[] {
  const cursors = Array.from({ length: groups.length }, () => 0);
  const merged: NoTuiScheduledPlaybackEvent[] = [];

  while (true) {
    let selectedGroupIndex = -1;
    let selectedEvent: NoTuiScheduledPlaybackEvent | undefined;

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const event = groups[groupIndex]?.[cursors[groupIndex] ?? 0];
      if (!event) {
        continue;
      }
      if (
        !selectedEvent ||
        event.seconds < selectedEvent.seconds ||
        (event.seconds === selectedEvent.seconds && event.order < selectedEvent.order)
      ) {
        selectedEvent = event;
        selectedGroupIndex = groupIndex;
      }
    }

    if (selectedGroupIndex < 0 || !selectedEvent) {
      break;
    }

    merged.push(selectedEvent);
    cursors[selectedGroupIndex] = (cursors[selectedGroupIndex] ?? 0) + 1;
  }

  return merged;
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
  let nextOrder = 0;
  const measureLengthEvents = resolveLoggedMeasureLengthTimeline(json, resolver, beatResolver)
    .map((point) =>
      createScheduledPlaybackEvent(
        point.seconds,
        nextOrder++,
        createRuntimeEventLine('measure-length-change', [
          ['time', formatSeconds(point.seconds)],
          ['measure', point.measure],
          ['length', formatLoggedNumericValue(point.length)],
        ]),
      ),
    )
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);
  const bpmEvents = createBpmTimeline(json, resolver)
    .map((point) =>
      createScheduledPlaybackEvent(
        point.seconds,
        nextOrder++,
        createRuntimeEventLine('bpm-change', [
          ['time', formatSeconds(point.seconds)],
          ['value', formatLoggedNumericValue(point.bpm)],
        ]),
      ),
    )
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);
  const scrollEvents = createScrollTimeline(json, beatResolver)
    .map((point) => {
      const seconds = resolver.beatToSeconds(point.beat);
      return createScheduledPlaybackEvent(
        seconds,
        nextOrder++,
        createRuntimeEventLine('scroll-change', [
          ['time', formatSeconds(seconds)],
          ['value', formatLoggedNumericValue(point.speed)],
        ]),
      );
    })
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);
  const speedEvents = createSpeedTimeline(json, beatResolver)
    .map((point) => {
      const seconds = resolver.beatToSeconds(point.beat);
      return createScheduledPlaybackEvent(
        seconds,
        nextOrder++,
        createRuntimeEventLine('speed-change', [
          ['time', formatSeconds(seconds)],
          ['value', formatLoggedNumericValue(point.speed)],
        ]),
      );
    })
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);
  const stopEvents = createStopBeatWindows(resolver)
    .flatMap((window) => [
      createScheduledPlaybackEvent(
        window.startSeconds,
        nextOrder++,
        createRuntimeEventLine('stop', [
          ['time', formatSeconds(window.startSeconds)],
          ['state', 'start'],
          ['duration', `${formatLoggedNumericValue(window.durationSeconds)}s`],
        ]),
      ),
      createScheduledPlaybackEvent(
        window.endSeconds,
        nextOrder++,
        createRuntimeEventLine('stop', [
          ['time', formatSeconds(window.endSeconds)],
          ['state', 'end'],
        ]),
      ),
    ])
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);
  const judgeRankEvents = collectDynamicBmsJudgeRankChanges(json, resolver)
    .map((change) => {
      const badWindow = resolveBmsJudgeWindowsMsForExRankValue(change.exRankValue, judgeWindowMs).bad;
      return createScheduledPlaybackEvent(
        change.seconds,
        nextOrder++,
        createRuntimeEventLine('judge-rank-change', [
          ['time', formatSeconds(change.seconds)],
          ['rank', formatLoggedNumericValue(change.exRankValue)],
          ['bad', `${formatLoggedNumericValue(badWindow)}ms`],
        ]),
      );
    })
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);

  const idBase = resolveBmsBase(json);
  const baseBgaTimeline = buildLoggedBgaCueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_BASE_CHANNEL,
    'base',
    idBase,
  );
  const poorBgaTimeline = buildLoggedBgaCueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_POOR_CHANNEL,
    'poor',
    idBase,
  );
  const layerBgaTimeline = buildLoggedBgaCueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_LAYER_CHANNEL,
    'layer',
    idBase,
  );
  const layer2BgaTimeline = buildLoggedBgaCueTimeline(
    sortedEvents,
    resolver,
    json.resources.bmp,
    BGA_LAYER2_CHANNEL,
    'layer2',
    idBase,
  );
  const baseBgaEvents = baseBgaTimeline
    .map((cue) => createScheduledPlaybackEvent(cue.seconds, nextOrder++, formatLoggedBgaCueText(cue)))
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);
  const poorBgaEvents = poorBgaTimeline
    .map((cue) => createScheduledPlaybackEvent(cue.seconds, nextOrder++, formatLoggedBgaCueText(cue)))
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);
  const layerBgaEvents = layerBgaTimeline
    .map((cue) => createScheduledPlaybackEvent(cue.seconds, nextOrder++, formatLoggedBgaCueText(cue)))
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);
  const layer2BgaEvents = layer2BgaTimeline
    .map((cue) => createScheduledPlaybackEvent(cue.seconds, nextOrder++, formatLoggedBgaCueText(cue)))
    .filter((event): event is NoTuiScheduledPlaybackEvent => event !== undefined);
  const scheduledEvents = mergeScheduledPlaybackEventGroups([
    measureLengthEvents,
    bpmEvents,
    scrollEvents,
    speedEvents,
    stopEvents,
    judgeRankEvents,
    baseBgaEvents,
    poorBgaEvents,
    layerBgaEvents,
    layer2BgaEvents,
  ]);

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

/**
 * Progress signal emitted while an {@link AudioSession} is loading. Values are normalized:
 * - `ratio` is in `[0, 1]` (0 = just started, 1 = ready)
 * - `message` is a short human-readable status (`"Loading key sounds..."`, `"Audio ready."`)
 * - `detail` is optional context (the WAV currently decoding, the failed asset, etc.)
 */
export interface AudioSessionLoadProgress {
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
  /** Raw `#EXRANKxx` value (`RANK 2 = 100` unit) — conversion to judge windows is owned by `judge-window.ts`. */
  exRankValue: number;
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
  const idBase = resolveBmsBase(json);
  const changes: DynamicBmsJudgeRankChange[] = [];
  for (const event of sortEvents(json.events)) {
    if (normalizeChannel(event.channel) !== 'A0') {
      continue;
    }
    const raw = json.bms.exRank[normalizeObjectKey(event.value, idBase)];
    const parsed = Number.parseFloat(raw ?? '');
    if (!Number.isFinite(parsed) || parsed <= 0) {
      continue;
    }
    changes.push({
      seconds: resolver.eventToSeconds(event),
      exRankValue: parsed,
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
  // Prefer the host-provided `preparedChart` over running our own extract pass. See `PlayerOptions.preparedChart`
  // for the why — sharing the playable / landmine / invisible note arrays with the renderer eliminates a whole
  // class of "view and engine each ran `extractTimedNotes` with subtly different arguments and the parallel
  // arrays drifted" bugs that plagued the web runtime through the Phase-4c shared-engine migration.
  const playbackChart =
    options.preparedChart ??
    preparePlaybackChartData(
      resolvedJson,
      {
        showInvisibleNotes: options.showInvisibleNotes,
        laneModeExtension: options.laneModeExtension,
        playVariant: options.playVariant,
      },
      inferBmsLnTypeWhenMissing,
      realtimeAudioEndSeconds,
    );
  const {
    landmineNotes,
    invisibleNotes,
    renderNotes,
    laneBindings,
    laneDisplayMode,
    scorableNotes,
    inputTokenToChannels,
  } = playbackChart;
  let { totalSeconds } = playbackChart;
  // Hoist values that are constant for the entire play session out of the per-frame / per-event hot loops. Both fields
  // live on `resolvedJson`, which the engine treats as immutable from this point on. The auto-play loop touches each
  // many times per tick (LN body, every triggered sample, mine resolution, ...), and `resolveBmsBase` does a tiny
  // property walk each call — small individually but accumulates into measurable per-second overhead on dense charts.
  const idBase = resolveBmsBase(resolvedJson);
  const wavResources = resolvedJson.resources.wav;
  const keyMap = new Map(laneBindings.map((binding) => [binding.channel, binding.keyLabel]));
  const autoRuleset = resolveRuleset(
    rulesetChartFactsFromChart(resolvedJson, playbackChart),
    options.judgeRuleset ?? 'lr2',
    {
      ...(options.gauge !== undefined ? { selectedGauge: options.gauge } : {}),
      ...(options.judgeWindowMs !== undefined ? { judgeWindowOverrideMs: options.judgeWindowMs } : {}),
    },
  );
  const { summary, applyGaugeJudge } = createInitialPlayerSummary(autoRuleset, autoRuleset.noteCount);
  const scoreTracker = createScoreTracker({ moneyScore: autoRuleset.moneyScore });
  // AUTO plays never have manual inputs, but recording still snapshots the resolved chart + play settings so an
  // auto run produces a structurally complete playlog (simulators treat an empty input stream as all-miss; the
  // cached native result carries the actual AUTO outcome).
  const playlogRecorder = options.onPlaylogRecorded
    ? (() => {
        const { chartSha256, ...hostPlaySettings } = options.recordPlaylog ?? {};
        return createPlaylogRecorder({
          json: resolvedJson,
          chart: playbackChart,
          chartSha256,
          dynamicJudgeRankChanges: collectDynamicBmsJudgeRankChanges(resolvedJson, timingResolver),
          play: {
            mode: 'auto',
            autoScratch: false,
            judgeWindowOverrideMs: options.judgeWindowMs,
            judgeRuleset: options.judgeRuleset,
            ...hostPlaySettings,
          },
        });
      })()
    : undefined;
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
    landmineNotes,
    invisibleNotes,
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
  const playbackStateLogger = uiEnabled
    ? createNoopPlaybackStateLogger()
    : createNoTuiPlaybackStateLogger({ writeOutput, summary, base: idBase });
  const applyLoggedGaugeJudge = (seconds: number, judge: GrooveGaugeJudgeKind, reason = 'judge'): void => {
    applyGaugeJudgeWithLogging({
      summary,
      applyGaugeJudge,
      playbackStateLogger,
      seconds,
      judge,
      reason,
    });
  };
  const setLoggedCombo = (seconds: number, value: number, reason: string, judge?: string, channel?: string): void => {
    combo = setLoggedComboValue(playbackStateLogger, seconds, value, reason, judge, channel);
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
  const publishUiFrame = createUiFramePublisher({
    uiEnabled,
    uiSignals,
    totalSeconds,
    summary,
    notes: renderNotes,
    landmineNotes,
    invisibleNotes,
    audioBackend: audioBackendLabel,
    resolveDebugActiveAudioState,
  });

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
  const resolveAutoCommandSeconds = (): number =>
    playbackClock ? elapsedMsToGameSeconds(playbackClock.nowMs(), speed) : 0;
  const resolveAutoInterruptSeconds = (): number | undefined =>
    playbackClock ? elapsedMsToGameSeconds(playbackClock.nowMs(), speed) : undefined;

  const togglePause = (): void => {
    togglePlaybackPause({
      playbackClock,
      audioSession,
      activeStateSignals,
      onStateChange: !uiEnabled
        ? (state, nowMs) => {
            writeRuntimeEventLog(writeOutput, 'playback-state', [
              ['time', formatSeconds(elapsedMsToGameSeconds(nowMs, speed))],
              ['state', state],
            ]);
          }
        : undefined,
    });
  };
  const consumeInputCommands = (): void => {
    consumePlaybackInputCommands({
      inputSignals,
      isInterrupted: () => interruptedReason !== undefined,
      setInterruptedReason: (reason) => {
        interruptedReason = reason;
      },
      onTogglePause: togglePause,
      onHighSpeedAction: (action) => {
        highSpeed = applyPlaybackHighSpeedAction({
          action,
          currentHighSpeed: highSpeed,
          activeStateSignals,
          onHighSpeedChange: options.onHighSpeedChange,
          logHighSpeedChange: !uiEnabled
            ? (nextHighSpeed) => {
                writeRuntimeEventLog(writeOutput, 'high-speed-change', [
                  ['time', formatSeconds(resolveAutoCommandSeconds())],
                  ['value', `x${nextHighSpeed.toFixed(1)}`],
                ]);
              }
            : undefined,
        });
      },
      logInterrupt: !uiEnabled
        ? (reason) => {
            const interruptSeconds = resolveAutoInterruptSeconds();
            if (interruptSeconds === undefined) {
              return;
            }
            writeRuntimeEventLog(writeOutput, 'interrupt', [
              ['time', formatSeconds(interruptSeconds)],
              ['reason', reason],
            ]);
          }
        : undefined,
    });
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
        writeRealtimeTriggeredEventLog(writeOutput, trigger, wavResources[trigger.sampleKey], 'realtime');
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

  /** True when the active ruleset scores a long note's tail as a judgment of its own (charge modes). */
  const autoLongNoteScoresTail = (note: TimedPlayableNote): boolean => {
    const chartMode = resolvePlayableLongNoteMode(note);
    return (
      chartMode !== undefined && isChargeLongNoteMode(resolveEffectiveLongNoteMode(autoRuleset.longNoteStyle, chartMode))
    );
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
        resources: wavResources,
        endSeconds: pending.endSeconds,
      });
      applyAutoPerfectJudge(pending.note, pending.endSeconds);
      if (autoLongNoteScoresTail(pending.note)) {
        // Charge modes judge the head and the tail separately; auto play clears both as PGREAT.
        applyAutoPerfectJudge(pending.note, pending.endSeconds);
      }
      // Pair the `hold-lane-until-beat` command emitted at the LN head (see `applyDueAutoPlayableJudgements` for the
      // autoplay path / `applyAutoScratchJudgements` for the auto-scratch path) with an explicit release at the
      // tail so the LR2 LN-hold timer (70..89) and the lane laser (100..117) actually fade out. Without this the
      // sustain glow / scratch streak stay lit after the LN has visually cleared, and the surrounding LN-body
      // sprite vanishes while the lane laser still reads as "held" — both regressions reported during Phase 4c
      // shared-engine playthroughs.
      if (uiEnabled) {
        uiSignals.pushCommand({ kind: 'release-lane', channel: pending.note.channel });
      }
    }
  };

  inputRuntime?.start();

  // Event-driven wake-up so the loop's inter-tick sleep can be cut short the moment a control command
  // arrives (toggle-pause / interrupt / high-speed). autoPlay doesn't act on lane-input but every
  // `pushCommand` still flips `inputSignals.tick` once and resolves the wake-up — that's harmless because
  // the loop's next iteration just consumes-and-discards the lane-input. The wake-up is disposed in the
  // outer `finally` below so its alien-signals subscription doesn't outlive the playback session.
  const inputWakeUp = createInputWakeUp(inputSignals);

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
        createAudioPlaybackClockSource(audioSession),
        audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0),
      );
      playbackClock = chartClock;
      playbackEventTracer.flushUntil(0);
      // Autoplay never misses, so this is purely the horizon after which un-detonated mines and invisible notes
      // are retired. The active ruleset's widest note reach is the right bound: nothing can act on them past it.
      const badWindowSeconds = judgeWindowLateReachUs(autoRuleset.windows.note) / 1e6;
      let landmineExpireCursor = 0;
      let invisibleExpireCursor = 0;
      let autoPlayableAudioIndex = 0;
      let autoPlayableJudgeIndex = 0;

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

      const triggerAutoPlayableNoteAudio = (referenceSeconds: number): void => {
        const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
        while (autoPlayableAudioIndex < scorableNotes.length) {
          const note = scorableNotes[autoPlayableAudioIndex]!;
          if (note.seconds > safeReferenceSeconds) {
            break;
          }
          if (!uiEnabled) {
            writePlayableSampleTriggerEventLog(
              writeOutput,
              note.event,
              note.seconds,
              wavResources,
              'auto-note',
              note.channel,
              idBase,
            );
          }
          audioSession?.triggerEvent?.(note.event);
          autoPlayableAudioIndex += 1;
        }
      };

      const applyDueAutoPlayableJudgements = (referenceSeconds: number): void => {
        const safeReferenceSeconds = Math.max(0, referenceSeconds) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
        while (autoPlayableJudgeIndex < scorableNotes.length) {
          const note = scorableNotes[autoPlayableJudgeIndex]!;
          if (note.seconds > safeReferenceSeconds) {
            break;
          }
          note.judged = true;
          autoPlayableJudgeIndex += 1;

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
              resources: wavResources,
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
      };

      const playbackHorizonMs = (totalSeconds * 1000) / speed + 1000;
      while (chartClock.nowMs() < playbackHorizonMs) {
        consumeInputCommands();
        if (interruptedReason) {
          break;
        }

        const nowMs = chartClock.nowMs();
        if (chartClock.isPaused()) {
          const nowSec = elapsedMsToGameSeconds(nowMs, speed);
          publishUiFrame(nowSec, beatAtSeconds(nowSec));
          // While paused, the only useful inputs are toggle-pause (resume) and interrupt — both processed
          // by the next iteration's `consumeInputCommands`. Cutting the poll short on input arrival makes
          // pause-resume feel instantaneous.
          await waitPreciseOrInput(PAUSE_POLL_INTERVAL_MS, inputWakeUp);
          continue;
        }

        const scheduledMs = chartClock.scheduledMs();
        const nowSec = elapsedMsToGameSeconds(nowMs, speed);
        const scheduledSec = elapsedMsToGameSeconds(scheduledMs, speed);
        playbackEventTracer.flushUntil(nowSec);
        // Queue audio against the write head, then judge and render against what is actually audible.
        triggerRealtimeAudioVolumeEvents(scheduledSec);
        triggerRealtimeAudioEvents(scheduledSec);
        triggerAutoPlayableNoteAudio(scheduledSec);
        applyDueAutoPlayableJudgements(nowSec);
        drainPendingAutoLongNotes(nowSec);
        markExpiredLandmines(nowSec);
        markExpiredInvisibleNotes(nowSec);
        publishUiFrame(nowSec, beatAtSeconds(nowSec));

        const safeNowSeconds = Math.max(0, nowSec) + REALTIME_AUDIO_TRIGGER_EPSILON_SECONDS;
        if (
          autoPlayableAudioIndex >= scorableNotes.length &&
          autoPlayableJudgeIndex >= scorableNotes.length &&
          pendingAutoLongNotes.length === 0 &&
          safeNowSeconds >= totalSeconds
        ) {
          break;
        }

        // Race the 60 Hz tick against the next input arrival so control commands (Space / ESC / high-speed)
        // resolve within ~1 ms instead of waiting up to a full tick. autoPlay doesn't act on lane-input,
        // but lane presses still wake the loop — that's harmless because the next iteration just
        // consumes-and-discards them via `consumeInputCommands`.
        await waitPreciseOrInput(TUI_FRAME_INTERVAL_MS, inputWakeUp);
      }

      if (!interruptedReason) {
        triggerRealtimeAudioVolumeEvents(totalSeconds);
        triggerRealtimeAudioEvents(totalSeconds);
        triggerAutoPlayableNoteAudio(totalSeconds);
        applyDueAutoPlayableJudgements(totalSeconds);
        const totalScheduledMs = (totalSeconds * 1000) / speed;
        const totalWaitMs = Math.max(0, totalScheduledMs - chartClock.nowMs());
        if (totalWaitMs > 0) {
          // Trailing wait for chart end. ESC during this window should still abort promptly, so race the
          // sleep against the wake-up the same way the main tick does.
          await waitPreciseOrInput(Math.min(totalWaitMs, TUI_FRAME_INTERVAL_MS), inputWakeUp);
        }
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
    inputWakeUp.dispose();
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
  if (playlogRecorder) {
    options.onPlaylogRecorded?.(
      playlogRecorder.finalize({
        summary,
        maxCombo: scoreTracker.maxCombo,
        aborted: interruptedReason === 'escape',
      }),
    );
  }
  writeOutput(renderSummary(summary, autoRuleset.moneyScore));
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
  const judgeRuleset: JudgeWindowRuleset = options.judgeRuleset ?? 'lr2';
  const timingResolver = createTimingResolver(resolvedJson);
  // Dynamic `#EXRANKxx` is an LR2 concept — beatoraja ignores it and IIDX has no BMS rank axis at all, so the
  // non-LR2 rulesets keep their initial windows for the whole chart.
  const dynamicJudgeRankChanges =
    judgeRuleset === 'lr2' ? collectDynamicBmsJudgeRankChanges(resolvedJson, timingResolver) : [];
  const realtimeAudioVolumeEvents = collectRealtimeAudioVolumeEvents(resolvedJson, timingResolver);
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
  // Same shared-instance fast path as `autoPlay`. See `PlayerOptions.preparedChart`.
  const playbackChart =
    options.preparedChart ??
    preparePlaybackChartData(
      resolvedJson,
      {
        showInvisibleNotes: options.showInvisibleNotes,
        laneModeExtension: options.laneModeExtension,
        playVariant: options.playVariant,
      },
      inferBmsLnTypeWhenMissing,
      nonPlayableRealtimeAudioEndSeconds,
    );
  const {
    laneSoundNotes,
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
  // Hoisted constants — see the matching block in `autoPlay`. Same rationale: the manual-play loop touches both heavily
  // per tick / per input event, and these don't change across the play session.
  const idBase = resolveBmsBase(resolvedJson);
  const wavResources = resolvedJson.resources.wav;
  const scratchPlayableChannels = new Set(
    laneBindings.filter((binding) => binding.isScratch).map((binding) => binding.channel),
  );

  const ruleset = resolveRuleset(
    rulesetChartFactsFromChart(resolvedJson, playbackChart, dynamicJudgeRankChanges),
    judgeRuleset,
    {
      ...(options.gauge !== undefined ? { selectedGauge: options.gauge } : {}),
      ...(options.judgeWindowMs !== undefined ? { judgeWindowOverrideMs: options.judgeWindowMs } : {}),
    },
  );
  /**
   * Signed judge windows in force at a given chart time. The ruleset owns the whole table set — key vs scratch,
   * note vs long-note end, and (LR2 only) the `#EXRANKxx` timeline — so the engine never derives a window itself.
   */
  const windowTablesAt = (seconds: number): RulesetWindowTables => ruleset.windowsAt(Math.round(seconds * 1e6));
  const judgeWindowsFor = (channel: string, seconds: number, longNoteEnd = false): JudgeWindowSetUs =>
    selectJudgeWindowSet(windowTablesAt(seconds), {
      scratch: scratchPlayableChannels.has(channel),
      longNoteEnd,
    });
  /**
   * Widest reach (seconds) any lane can have at `seconds`, used as the candidate search radius and as the horizon
   * for retiring notes the player can no longer reach. Only a coarse bound: the asymmetric legs are settled by
   * `resolveManualJudgeKind` against the note's own window set.
   */
  const maxJudgeReachSeconds = (seconds: number): number => {
    const tables = windowTablesAt(seconds);
    let reachUs = 0;
    for (const set of [tables.note, tables.scratch, tables.longNoteEnd, tables.longScratchEnd]) {
      reachUs = Math.max(reachUs, judgeWindowLateReachUs(set), judgeWindowEarlyReachUs(set));
    }
    return reachUs / 1e6;
  };
  /** How far ahead of a note its judgable window opens — when the lane's fallback keysound becomes that note's. */
  const maxJudgeEarlyReachSeconds = (seconds: number): number => {
    const tables = windowTablesAt(seconds);
    let reachUs = 0;
    for (const set of [tables.note, tables.scratch]) {
      reachUs = Math.max(reachUs, judgeWindowEarlyReachUs(set));
    }
    return reachUs / 1e6;
  };
  /** The BAD gate as a single width, for the log line and the host's judge-window readout. */
  const badWindowMs = judgeWindowLateReachUs(ruleset.windows.note) / 1000;
  const badWindowSeconds = badWindowMs / 1000;

  const { summary, applyGaugeJudge, applyGaugeDelta } = createInitialPlayerSummary(ruleset, ruleset.noteCount);
  const scoreTracker = createScoreTracker({ moneyScore: ruleset.moneyScore });
  const playlogRecorder = options.onPlaylogRecorded
    ? (() => {
        const { chartSha256, ...hostPlaySettings } = options.recordPlaylog ?? {};
        return createPlaylogRecorder({
          json: resolvedJson,
          chart: playbackChart,
          chartSha256,
          dynamicJudgeRankChanges,
          play: {
            mode: 'manual',
            autoScratch: autoScratchEnabled,
            judgeWindowOverrideMs: options.judgeWindowMs,
            judgeRuleset: options.judgeRuleset,
            ...hostPlaySettings,
          },
        });
      })()
    : undefined;
  let combo = 0;
  let highSpeed = resolveHighSpeedMultiplier(options.highSpeed);
  const stateSignals = createPlayerStateSignals(highSpeed);
  const uiSignals = createPlayerUiSignalBus({
    currentBeat: 0,
    currentSeconds: 0,
    totalSeconds,
    summary,
    notes: renderNotes,
    landmineNotes,
    invisibleNotes,
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
  const playbackStateLogger = uiEnabled
    ? createNoopPlaybackStateLogger()
    : createNoTuiPlaybackStateLogger({ writeOutput, summary, base: idBase });
  const applyLoggedGaugeJudge = (seconds: number, judge: GrooveGaugeJudgeKind, reason = 'judge'): void => {
    applyGaugeJudgeWithLogging({
      summary,
      applyGaugeJudge,
      playbackStateLogger,
      seconds,
      judge,
      reason,
    });
  };
  const applyLoggedGaugeDelta = (seconds: number, delta: number, reason: string): void => {
    applyGaugeDeltaWithLogging({
      summary,
      applyGaugeDelta,
      playbackStateLogger,
      seconds,
      delta,
      reason,
    });
  };
  const setLoggedCombo = (seconds: number, value: number, reason: string, judge?: string, channel?: string): void => {
    combo = setLoggedComboValue(playbackStateLogger, seconds, value, reason, judge, channel);
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
  const publishUiFrame = createUiFramePublisher({
    uiEnabled,
    uiSignals,
    totalSeconds,
    summary,
    notes: renderNotes,
    landmineNotes,
    invisibleNotes,
    audioBackend: audioBackendLabel,
    resolveDebugActiveAudioState: () => resolveDebugActiveAudioState(),
  });

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
      `Judge window (${ruleset.id}): ${formatJudgeWindowSet(ruleset.windows.note)}\n`,
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
  // Event-driven wake-up so a press lands within ~1 ms of consuming-and-judging instead of waiting up to
  // a full 16.67 ms tick. The judge timestamp itself is already correct via `pressedAt`; what this saves
  // is the AUDIO and VISUAL response window (keysound playback, lane flash queueing). Disposed in the
  // outer `finally` so the alien-signals subscription doesn't outlive the playback session.
  const inputWakeUp = createInputWakeUp(inputSignals);
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

  const playbackClock = createPlaybackClock(
    createAudioPlaybackClockSource(audioSession),
    audioOffsetMs + (audioSession?.chartStartDelayMs ?? 0),
  );
  playbackEventTracer.flushUntil(0);
  // Widest reach across the whole chart — a mid-chart `#EXRANKxx` can widen the windows past the opening rank's.
  const maxBadWindowMs =
    1000 *
    Math.max(
      maxJudgeReachSeconds(0),
      ...dynamicJudgeRankChanges.map((change) => maxJudgeReachSeconds(change.seconds)),
    );
  const horizon = (totalSeconds * 1000) / speed + leadInMs + maxBadWindowMs + 1000;
  let interruptedReason: PlayerInterruptReason | undefined;
  const longHoldUntilMsByChannel = new Map<string, number>();
  /**
   * Chart second at which each held long note was RELEASED. The tail is judged against the release instant, not
   * against whichever frame happens to notice it: at high `speed` a frame can span hundreds of chart milliseconds,
   * which would quantize a clean release into a GOOD or worse.
   */
  const longHoldReleaseSecondsByChannel = new Map<string, number>();
  const activeLongNotesByChannel = new Map<string, ActiveLongNoteState>();
  const longNoteSuppressUntilSecondsByChannel = new Map<string, number>();
  const activeKittyPressedChannels = new Set<string>();
  const autoScratchNotes = autoScratchEnabled
    ? scorableNotes.filter((note) => scratchPlayableChannels.has(note.channel))
    : [];
  // LR2 empty-POOR reference times — a phantom press registers as 空POOR only while a note on that lane lies within
  // the next second (lr2oraja `JudgeProperty` LR2 miss window `{0, 1000000}`µs, early side only). Per-channel sorted
  // note times let the press handler binary-search the next upcoming note; judged notes stay valid references (LR2's
  // `MissCondition.ALWAYS` keeps mashing in front of an already-judged note producing 空POORs).
  const scorableNoteSecondsByChannel = new Map<string, number[]>();
  for (const note of scorableNotes) {
    const noteTimes = scorableNoteSecondsByChannel.get(note.channel);
    if (noteTimes) {
      noteTimes.push(note.seconds);
    } else {
      scorableNoteSecondsByChannel.set(note.channel, [note.seconds]);
    }
  }
  /**
   * Is there a note near enough on any pressed lane for a note-less press to charge an empty POOR?
   *
   * The reach is the ruleset's own miss (`ms`) window, which is not symmetric and not the same shape everywhere:
   * LR2's is early-only (a press up to 1 s BEFORE a note charges, one after never does), while beatoraja's reaches
   * 500 ms early and 150 ms late. Both neighbours of the press are tested, since the late side matters where the
   * ruleset has one.
   */
  const hasEmptyPoorReferenceNote = (channels: ReadonlySet<string>, nowSec: number): boolean => {
    for (const channel of channels) {
      const noteTimes = scorableNoteSecondsByChannel.get(channel);
      if (!noteTimes) {
        continue;
      }
      const missWindow = judgeWindowsFor(channel, nowSec).ms;
      if (!missWindow) {
        continue;
      }
      const index = findFirstIndexNumberAtOrAfter(noteTimes, nowSec);
      for (const neighbour of [index - 1, index]) {
        const noteSeconds = noteTimes[neighbour];
        if (noteSeconds === undefined) {
          continue;
        }
        const dmUs = (noteSeconds - nowSec) * 1e6;
        if (dmUs >= missWindow[0] && dmUs <= missWindow[1]) {
          return true;
        }
      }
    }
    return false;
  };
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

  const lastLanePressMsByChannel = new Map<string, number>();
  const isLandmineChannelHeld = (channel: string, nowMs: number): boolean => {
    if (activeKittyPressedChannels.has(channel)) {
      return true;
    }
    // Non-kitty input carries no release events, so "held" is approximated with the same short grace window the LN
    // hold logic uses for terminal key repeat.
    const lastPressMs = lastLanePressMsByChannel.get(channel);
    return lastPressMs !== undefined && nowMs - lastPressMs <= LONG_NOTE_REPEAT_HOLD_GRACE_MS;
  };

  const detonateLandmine = (landmine: TimedLandmineNote, nowSec: number): void => {
    if (!markLandmineJudged(landmine)) {
      return;
    }
    const landmineGaugeEffect = resolveLandmineGaugeEffect(landmine.event, idBase);
    const landmineExplosionEvent = resolveLandmineExplosionEvent(landmine.event, wavResources);
    if (landmineExplosionEvent) {
      if (!uiEnabled) {
        writePlayableSampleTriggerEventLog(
          writeOutput,
          landmineExplosionEvent,
          nowSec,
          wavResources,
          'mine-hit',
          landmine.channel,
          idBase,
        );
      }
      audioSession?.triggerEvent?.(landmineExplosionEvent);
    }
    // LR2 — a mine hit drains the gauge and plays the explosion sample, nothing else: no verdict, no combo break, no
    // judge-counter change (beatoraja's JudgeManager likewise only calls `gauge.addValue`). The raw-delta path also
    // bypasses the HARD guts softening and #TOTAL damage multiplier, matching `GrooveGauge.addValue`.
    applyLoggedGaugeDelta(nowSec, landmineGaugeEffect.gaugeDelta, 'mine-hit');
    if (!uiEnabled) {
      writeRuntimeEventLog(writeOutput, 'mine-hit', [
        ['time', formatSeconds(nowSec)],
        ['channel', landmine.channel],
        ['value', landmineGaugeEffect.objectValue],
        ['damage', landmineGaugeEffect.damage],
      ]);
    }
  };

  /**
   * LR2 mine model (losak's LR2 writeup, confirmed by otlovers): a mine explodes while its lane's key is ON and the
   * mine sits within the GOOD window of the judge line — covering both "press while a mine is in range" and "hold
   * through a passing mine". Mines that leave the window with the key up are retired silently (passing an
   * un-pressed mine is harmless). Runs on every frame tick and on every press dispatch.
   */
  const processLandminePassage = (nowSec: number, nowMs: number): void => {
    // Mines sit on lanes, so they read the lane's own GOOD window; the legs are asymmetric under beatoraja, hence
    // the separate early / late reach rather than one radius.
    const [goodLateUs, goodEarlyUs] = goodWindowReachUs(windowTablesAt(nowSec).note);
    const goodLateSeconds = goodLateUs / 1e6;
    const goodEarlySeconds = goodEarlyUs / 1e6;
    while (landmineExpireCursor < landmineNotes.length) {
      const landmine = landmineNotes[landmineExpireCursor]!;
      if (landmine.judged) {
        landmineExpireCursor += 1;
        continue;
      }
      if (nowSec - landmine.seconds <= goodLateSeconds) {
        break;
      }
      markLandmineJudged(landmine);
      landmineExpireCursor += 1;
    }
    for (let index = landmineExpireCursor; index < landmineNotes.length; index += 1) {
      const landmine = landmineNotes[index]!;
      if (landmine.seconds - nowSec > goodEarlySeconds) {
        break;
      }
      if (landmine.judged) {
        continue;
      }
      if (!isLandmineChannelHeld(landmine.channel, nowMs)) {
        continue;
      }
      detonateLandmine(landmine, nowSec);
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
          wavResources,
          'auto-scratch',
          note.channel,
          idBase,
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
          resources: wavResources,
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
        resources: wavResources,
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
      if (longNoteScoresTail(pending.note)) {
        // Charge modes judge the head and the tail separately; the turntable's auto-scratch clears both.
        applyJudgeToSummary(summary, 'PERFECT', scoreTracker);
        applyLoggedGaugeJudge(referenceSeconds, 'PERFECT');
        setLoggedCombo(referenceSeconds, combo + 1, 'judge', 'PERFECT', pending.note.channel);
        activeStateSignals?.publishJudgeCombo('PERFECT', combo, pending.note.channel);
      }
      // Mirror the `release-lane` emitted from `drainPendingAutoLongNotes` so the LN-hold timer / lane laser the
      // turntable's auto-scratch lit at the head (`hold-lane-until-beat` from `applyAutoScratchJudgements`) actually
      // fades out at the tail. Without this the scratch streak keeps glowing past the LN's visual end. Gated on
      // `uiEnabled` to match the matching `hold-lane-until-beat` push in `applyAutoScratchJudgements`.
      if (uiEnabled) {
        uiSignals.pushCommand({ kind: 'release-lane', channel: pending.note.channel });
      }
    }
  };

  /**
   * How long past its own time a note stays reachable, in seconds. Resolved from the window set active at THAT
   * NOTE's time and on THAT NOTE's lane, never from a live "current window" variable: a mid-chart `#EXRANKxx`
   * would otherwise retroactively move the deadline of notes that had already scrolled past under the old rank —
   * widening the rank would resurrect notes that should already have been missed, narrowing it would miss notes
   * early. The play-log simulator freezes the same per-note deadline (`playlog/simulate.ts`, `missDeadlineUs`).
   */
  const resolveMissDeadlineSeconds = (note: TimedPlayableNote): number =>
    judgeWindowLateReachUs(judgeWindowsFor(note.channel, note.seconds)) / 1e6;

  const applyExpiredScorableJudgements = (referenceSeconds: number): void => {
    while (scorableMissCursor < scorableNotes.length) {
      const note = scorableNotes[scorableMissCursor]!;
      if (note.judged) {
        scorableMissCursor += 1;
        continue;
      }
      if (referenceSeconds - note.seconds <= resolveMissDeadlineSeconds(note)) {
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
      // Miss-without-press: positive `signedDeltaMs` because the engine reached the note's
      // judgement deadline without an input. The visualizer plots these in the "late" band.
      activeStateSignals?.publishJudgeCombo(
        'POOR',
        combo,
        note.channel,
        undefined,
        (referenceSeconds - note.seconds) * 1000,
      );
      if (longNoteOwesTailMiss(note)) {
        applyJudgeToSummary(summary, 'POOR', scoreTracker);
        applyLoggedGaugeJudge(referenceSeconds, 'POOR', 'miss');
        if (!uiEnabled) {
          writeRuntimeEventLog(writeOutput, 'judge', [
            ['time', formatSeconds(referenceSeconds)],
            ['result', 'POOR'],
            ['channel', note.channel],
            ['reason', 'charge-tail-miss'],
          ]);
        }
      }
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
        activeStateSignals?.publishJudgeCombo(judge.kind, combo, channel, undefined, judge.signedDeltaMs);
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
        activeStateSignals?.publishJudgeCombo('BAD', combo, channel, undefined, judge.signedDeltaMs);
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
      activeStateSignals?.publishJudgeCombo('POOR', combo, channel, undefined, judge.signedDeltaMs);
    }
  };

  /**
   * The note a press resolves against, chosen by the ruleset's own selection algorithm.
   *
   * Reachability is per note, not per press: the note's own lane (key vs scratch) and its own chart time (the
   * `#EXRANKxx` rank in force there) pick its window set, and both legs are checked separately. A note inside the
   * coarse scan radius but outside its own windows is not a candidate at all, so the press falls through to the
   * lane keysound / empty-POOR path instead of consuming the note as a POOR.
   */
  const selectPressCandidate = (
    nowSec: number,
    candidateChannels: ReadonlySet<string>,
  ): { note: TimedPlayableNote; judge: RulesetJudgeIndex } | undefined => {
    const reachSeconds = maxJudgeReachSeconds(nowSec);
    const inputTimeUs = nowSec * 1e6;
    let best: TimedPlayableNote | undefined;
    let bestSelection: JudgeSelectionCandidate | undefined;
    // `scorableNotes` is sorted by time, so the scan visits candidates in the ascending order the selection
    // algorithms assume (`lowest` keeps the first, the others may displace it).
    for (let index = lowerBoundBySeconds(scorableNotes, nowSec - reachSeconds); index < scorableNotes.length; index += 1) {
      const note = scorableNotes[index]!;
      if (note.seconds - nowSec > reachSeconds) {
        break;
      }
      if (note.judged || !candidateChannels.has(note.channel)) {
        continue;
      }
      const windows = judgeWindowsFor(note.channel, note.seconds);
      const judge = classifyRulesetJudge((note.seconds - nowSec) * 1e6, windows);
      if (judge === RULESET_JUDGE_NONE) {
        continue;
      }
      if (
        ruleset.ignoreLateBadOnLnHead &&
        judge === 3 &&
        note.seconds < nowSec &&
        typeof note.endSeconds === 'number' &&
        note.endSeconds > note.seconds &&
        resolvePlayableLongNoteMode(note) === 1
      ) {
        // LR2: a long-note head has no LATE bad — the press falls through to whatever else is in reach.
        continue;
      }
      const selection: JudgeSelectionCandidate = {
        noteTimeUs: note.seconds * 1e6,
        dmUs: (note.seconds - nowSec) * 1e6,
        judge,
        windows,
      };
      if (bestSelection === undefined || preferJudgeCandidate(ruleset.selection, bestSelection, selection, inputTimeUs)) {
        best = note;
        bestSelection = selection;
      }
    }
    return best === undefined || bestSelection === undefined ? undefined : { note: best, judge: bestSelection.judge };
  };

  /**
   * lr2oraja `MultiBadCollector`: once a press has consumed its note, every OTHER unjudged note on the pressed
   * lanes that sits inside the BAD window but outside the GOOD window also resolves as a BAD. This is what makes
   * LR2 punish a mistimed press across a dense cluster instead of quietly eating one note.
   *
   * The collector's own pruning: notes AFTER the consumed one only fall when the consumed note was itself a BAD
   * and was not a long note, and long notes BEFORE the consumed one are always spared.
   */
  const applyMultiBadCollector = (
    nowSec: number,
    candidateChannels: ReadonlySet<string>,
    consumed: TimedPlayableNote,
    consumedJudge: RulesetJudgeIndex,
  ): void => {
    const reachSeconds = maxJudgeReachSeconds(nowSec);
    const consumedIsLong = isLongPlayableNote(consumed);
    const consumedWasBad = consumedJudge === 3;
    const extras: TimedPlayableNote[] = [];
    for (let index = lowerBoundBySeconds(scorableNotes, nowSec - reachSeconds); index < scorableNotes.length; index += 1) {
      const note = scorableNotes[index]!;
      if (note.seconds - nowSec > reachSeconds) {
        break;
      }
      if (note === consumed || note.judged || !candidateChannels.has(note.channel)) {
        continue;
      }
      if (activeLongNotesByChannel.get(note.channel)?.note === note) {
        continue;
      }
      const windows = judgeWindowsFor(note.channel, note.seconds);
      const dmUs = (note.seconds - nowSec) * 1e6;
      const bad = windows.judges[3];
      const good = windows.judges[2];
      if (dmUs < bad[0] || dmUs > bad[1]) {
        continue;
      }
      if (dmUs >= good[0] && dmUs <= good[1]) {
        continue;
      }
      if ((!consumedWasBad || consumedIsLong) && note.seconds > consumed.seconds) {
        continue;
      }
      if (isLongPlayableNote(note) && note.seconds < consumed.seconds) {
        continue;
      }
      extras.push(note);
    }
    for (const note of extras) {
      if (!markScorableJudged(note)) {
        continue;
      }
      applyResolvedManualJudge(note.channel, { kind: 'BAD', signedDeltaMs: (nowSec - note.seconds) * 1000 }, nowSec);
      if (longNoteOwesTailMiss(note)) {
        applyJudgeToSummary(summary, 'POOR', scoreTracker);
        applyLoggedGaugeJudge(nowSec, 'POOR', 'miss');
      }
    }
  };

  const applyManualTimingJudge = (channel: string, signedDeltaMs: number, atSeconds: number): void => {
    applyResolvedManualJudge(
      channel,
      resolveManualTimedJudge(signedDeltaMs, judgeWindowsFor(channel, atSeconds)),
      atSeconds,
    );
  };

  const finalizeActiveLongNote = (
    channel: string,
    hold: ActiveLongNoteState,
    judge: TimedManualJudge,
    atSeconds: number,
  ): void => {
    activeLongNotesByChannel.delete(channel);
    longHoldUntilMsByChannel.delete(channel);
    longHoldReleaseSecondsByChannel.delete(channel);
    // Mirror the autoplay LN-tail `release-lane` so the renderer fades out the LR2 LN-hold timer (70..89) and
    // the lane laser (100..117) at the LN's resolution moment. The `hold-lane-until-beat` we emitted on the
    // manual LN HEAD relies on this matching release to take the lane out of the renderer's `pressedChannels`
    // set; without it the sustain glow / lane laser would stay lit indefinitely once the engine finalizes the
    // LN (early grace expiry, end-beat reached, or kitty-state release).
    if (uiEnabled) {
      uiSignals.pushCommand({ kind: 'release-lane', channel });
    }
    applyResolvedManualJudge(channel, judge, atSeconds);
  };

  /**
   * The judgment a long note's tail contributes. Charge modes already scored the head on the press, so the tail
   * is its own judgment; LN mode defers both and resolves them into the worse of the two.
   */
  const resolveLongNoteTailJudge = (hold: ActiveLongNoteState, tail: TimedManualJudge): TimedManualJudge =>
    hold.headScored ? tail : combineLongNoteJudges(hold.headJudge, tail);

  /**
   * True when a long note the player never held contributes a SECOND miss for its tail. Charge modes score head
   * and tail separately, so a note missed at the head owes two POORs — except under IIDX, where a broken head
   * cancels the tail outright (`headBadSkipsTail`).
   */
  const longNoteOwesTailMiss = (note: TimedPlayableNote): boolean =>
    !ruleset.headBadSkipsTail && longNoteScoresTail(note);

  /** True when the active ruleset scores this long note's tail as a judgment of its own (charge modes). */
  const longNoteScoresTail = (note: TimedPlayableNote): boolean => {
    if (!isLongPlayableNote(note)) {
      return false;
    }
    const chartMode = resolvePlayableLongNoteMode(note);
    return (
      chartMode !== undefined && isChargeLongNoteMode(resolveEffectiveLongNoteMode(ruleset.longNoteStyle, chartMode))
    );
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
        writeRealtimeTriggeredEventLog(writeOutput, trigger, wavResources[trigger.sampleKey], 'realtime');
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
  const isLongNoteRepeatSuppressedInput = (candidateChannels: ReadonlySet<string>, nowSec: number): boolean => {
    for (const channel of candidateChannels) {
      const suppressUntil = longNoteSuppressUntilSecondsByChannel.get(channel);
      if (suppressUntil !== undefined && nowSec < suppressUntil) {
        return true;
      }
    }
    return false;
  };

  const handleMappedInputTokens = (tokens: readonly string[], nowMs: number, nowSec: number): void => {
    const candidateChannels = resolveMappedInputChannels(tokens);
    if (candidateChannels.size === 0) {
      return;
    }
    handleLaneInputChannels(candidateChannels, tokens, nowMs, nowSec);
  };

  // Channel-direct core of the lane press handling. Live input goes through `handleMappedInputTokens` (token →
  // channel resolution); replay playback calls this directly with the recorded channel set and the recorded
  // chart-relative timestamp.
  const handleLaneInputChannels = (
    candidateChannels: ReadonlySet<string>,
    tokens: readonly string[],
    nowMs: number,
    nowSec: number,
  ): void => {
    // Play-log press event — recorded BEFORE any judging so the log stays a raw input replay (recordInput copies
    // the shared channel-buffer synchronously).
    playlogRecorder?.recordInput('down', nowSec, tokens, candidateChannels);

    if (uiEnabled) {
      for (const mappedChannel of candidateChannels) {
        uiSignals.pushCommand({ kind: 'flash-lane', channel: mappedChannel });
      }
    }


    let refreshedHold = false;
    for (const channel of candidateChannels) {
      if (!activeLongNotesByChannel.has(channel)) {
        continue;
      }
      longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
      refreshedHold = true;
    }

    // LR2 mine model — the press itself counts as "key ON": record the press instant for the non-kitty hold
    // approximation, then let the shared passage processor detonate any mine currently inside the GOOD window on
    // these lanes. Detonation never consumes the press: the regular note judgment below still runs, so a mine close
    // to a real note no longer swallows the player's input.
    for (const channel of candidateChannels) {
      lastLanePressMsByChannel.set(channel, nowMs);
    }
    processLandminePassage(nowSec, nowMs);

    const selected = selectPressCandidate(nowSec, candidateChannels);

    if (!selected) {
      if (refreshedHold) {
        // Active LN re-tap inside the hold-grace window — input is part of the sustain, not a phantom press.
        return;
      }
      if (isLongNoteRepeatSuppressedInput(candidateChannels, nowSec)) {
        // LN repeat-suppress window — same intent as the hold path above, just on the cooldown side. Treat as benign.
        return;
      }
      const fallback = findLaneSoundCandidate(laneSoundNotes, candidateChannels, nowSec, maxJudgeEarlyReachSeconds(nowSec));
      if (fallback) {
        if (!uiEnabled) {
          writePlayableSampleTriggerEventLog(
            writeOutput,
            fallback.event,
            nowSec,
            wavResources,
            'lane-fallback',
            fallback.channel,
            idBase,
          );
        }
        audioSession?.triggerEvent?.(fallback.event);
        if (activeFreeZoneChannels.has(fallback.channel)) {
          // Free zone keysound — authored for empty-press playback. No POOR cue; this is intended audio.
          return;
        }
      }
      if (!hasEmptyPoorReferenceNote(candidateChannels, nowSec)) {
        // No note in the ruleset's miss window — the press is harmless: the lane keysound (fallback above) plays
        // and nothing else happens.
        return;
      }
      // Empty POOR (kara-poor / 空POOR): a phantom press near a note but outside every judgable window. It costs
      // gauge and fires the POOR cue without consuming the note, so it never reaches EX-SCORE. Repeatable per note
      // (LR2's `MissCondition.ALWAYS`). Whether it breaks the combo is the ruleset's call — beatoraja's five-key
      // and PMS rules say yes, LR2 and IIDX say no.
      summary.emptyPoor += 1;
      applyLoggedGaugeJudge(nowSec, 'EMPTY_POOR', 'empty-poor');
      if (ruleset.comboBreaksOnEmptyPoor) {
        setLoggedCombo(nowSec, 0, 'judge', 'POOR');
      }
      playlogRecorder?.recordEmptyPoor();
      uiSignals.pushCommand({ kind: 'trigger-poor-bga', seconds: nowSec });
      if (!uiEnabled) {
        writeRuntimeEventLog(writeOutput, 'judge', [
          ['time', formatSeconds(nowSec)],
          ['result', 'EMPTY_POOR'],
          ['reason', 'empty-poor'],
        ]);
      } else {
        // Brief visual cue. The web-core gameplay scene maps this back to the LR2 `'poor'` skin slot (NOWJUDGE index
        // 0/1 share the same kind in our model).
        activeStateSignals?.publishJudgeCombo('POOR', combo);
      }
      return;
    }

    const candidate = selected.note;
    if (!markScorableJudged(candidate)) {
      return;
    }
    const channel = candidate.channel;
    const signedDeltaMs = (nowSec - candidate.seconds) * 1000;
    const collectMultiBad = ruleset.multiBad
      ? () => applyMultiBadCollector(nowSec, candidateChannels, candidate, selected.judge)
      : () => {};
    if (uiEnabled) {
      uiSignals.pushCommand({ kind: 'flash-lane', channel });
    }
    if (!uiEnabled) {
      writePlayableSampleTriggerEventLog(
        writeOutput,
        candidate.event,
        nowSec,
        wavResources,
        'manual-note',
        channel,
        idBase,
      );
    }
    audioSession?.triggerEvent?.(candidate.event);
    const endSeconds = candidate.endSeconds;
    if (typeof endSeconds === 'number' && Number.isFinite(endSeconds) && endSeconds > candidate.seconds) {
      const chartLongNoteMode = resolvePlayableLongNoteMode(candidate);
      const longNoteMode =
        chartLongNoteMode === undefined
          ? undefined
          : resolveEffectiveLongNoteMode(ruleset.longNoteStyle, chartLongNoteMode);
      const previousSuppressUntil = longNoteSuppressUntilSecondsByChannel.get(channel) ?? Number.NEGATIVE_INFINITY;
      if (endSeconds > previousSuppressUntil) {
        longNoteSuppressUntilSecondsByChannel.set(channel, endSeconds);
      }
      playbackStateLogger.logLongNoteState(nowSec, {
        channel,
        state: 'start',
        mode: longNoteMode === 2 || longNoteMode === 3 ? longNoteMode : 1,
        event: candidate.event,
        resources: wavResources,
        endSeconds,
      });
      candidate.visibleUntilBeat = candidate.endBeat;
      // Mirror the autoplay LN-head path's `hold-lane-until-beat` so the renderer can light its LR2 LN-hold
      // timer (70..89, drives the skin's sustain glow / hold-sparkle elements) on a manual LN start. The
      // accompanying `release-lane` is fired when the LN finalizes (early release through `kitty-state`, mode-1
      // grace expiry, or end-beat reached) — see `finalizeActiveLongNote` and the early-release branches in
      // the playback loop. Without this, the renderer never sees a "the LN is firing now" cue from the engine
      // on manual play, and the skin's sustain-glow gated on timer 70..89 stays invisible for the whole hold.
      if (uiEnabled && longNoteMode !== undefined) {
        uiSignals.pushCommand({ kind: 'hold-lane-until-beat', channel, beat: candidate.endBeat ?? candidate.beat });
      }
      const headJudge = resolveManualTimedJudge(signedDeltaMs, judgeWindowsFor(channel, nowSec));
      if (longNoteMode !== undefined && isChargeLongNoteMode(longNoteMode)) {
        // Charge modes score the head right here — it is a judgment of its own, not half of a deferred one.
        applyResolvedManualJudge(channel, headJudge, nowSec);
        if (ruleset.headBadSkipsTail && (headJudge.kind === 'BAD' || headJudge.kind === 'POOR')) {
          // IIDX: a broken charge-note head cancels the tail; the note is finished with a single judgment.
          activeLongNotesByChannel.delete(channel);
          longHoldUntilMsByChannel.delete(channel);
          if (uiEnabled) {
            uiSignals.pushCommand({ kind: 'release-lane', channel });
          }
          collectMultiBad();
          return;
        }
        activeLongNotesByChannel.set(channel, {
          endSeconds,
          note: candidate,
          mode: longNoteMode,
          headJudge,
          headScored: true,
          gaugeDrainCursorSeconds: nowSec,
          audioStopped: false,
        });
        longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
        longHoldReleaseSecondsByChannel.delete(channel);
        collectMultiBad();
        return;
      }
      if (longNoteMode === 1) {
        activeLongNotesByChannel.set(channel, {
          endSeconds,
          note: candidate,
          mode: 1,
          headJudge,
          headScored: false,
          gaugeDrainCursorSeconds: nowSec,
          audioStopped: false,
        });
        longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_INITIAL_HOLD_GRACE_MS);
        longHoldReleaseSecondsByChannel.delete(channel);
        collectMultiBad();
        return;
      }
      activeLongNotesByChannel.delete(channel);
      longHoldUntilMsByChannel.delete(channel);
      collectMultiBad();
      return;
    } else {
      activeLongNotesByChannel.delete(channel);
      longHoldUntilMsByChannel.delete(channel);
    }

    applyManualTimingJudge(channel, signedDeltaMs, nowSec);
    collectMultiBad();
  };

  const togglePause = (): void => {
    togglePlaybackPause({
      playbackClock,
      audioSession,
      activeStateSignals,
      onStateChange: !uiEnabled
        ? (state, nowMs) => {
            writeRuntimeEventLog(writeOutput, 'playback-state', [
              ['time', formatSeconds(elapsedMsToGameSeconds(nowMs, speed))],
              ['state', state],
            ]);
          }
        : undefined,
    });
  };
  const resolveManualCommandSeconds = (): number => elapsedMsToGameSeconds(playbackClock.nowMs(), speed);

  const consumeInputCommands = (): void => {
    consumePlaybackInputCommands({
      inputSignals,
      isInterrupted: () => interruptedReason !== undefined,
      setInterruptedReason: (reason) => {
        interruptedReason = reason;
      },
      onTogglePause: togglePause,
      onHighSpeedAction: (action) => {
        highSpeed = applyPlaybackHighSpeedAction({
          action,
          currentHighSpeed: highSpeed,
          activeStateSignals,
          onHighSpeedChange: options.onHighSpeedChange,
          logHighSpeedChange: !uiEnabled
            ? (nextHighSpeed) => {
                writeRuntimeEventLog(writeOutput, 'high-speed-change', [
                  ['time', formatSeconds(resolveManualCommandSeconds())],
                  ['value', `x${nextHighSpeed.toFixed(1)}`],
                ]);
              }
            : undefined,
        });
      },
      onUnhandledCommand: (command) => {
        // Replay playback drives the lanes from the recorded input stream — live lane / key-state input must not
        // interleave with it (pause / high-speed / interrupt still arrive through the standard command path).
        if (options.replayInputs !== undefined && (command.kind === 'kitty-state' || command.kind === 'lane-input')) {
          return;
        }
        if (command.kind === 'kitty-state') {
          if (!uiEnabled) {
            if (command.pressTokens.length > 0) {
              writeRuntimeEventLog(writeOutput, 'input', [
                ['time', formatSeconds(resolveManualCommandSeconds())],
                ['action', 'press'],
                ['tokens', command.pressTokens.join(',')],
              ]);
            }
            if (command.repeatTokens.length > 0) {
              writeRuntimeEventLog(writeOutput, 'input', [
                ['time', formatSeconds(resolveManualCommandSeconds())],
                ['action', 'repeat'],
                ['tokens', command.repeatTokens.join(',')],
              ]);
            }
            if (command.releaseTokens.length > 0) {
              writeRuntimeEventLog(writeOutput, 'input', [
                ['time', formatSeconds(resolveManualCommandSeconds())],
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
          if (playlogRecorder && releasedChannels.size > 0) {
            const releaseNowMs = resolveJudgeNowMsFromPressedAt(playbackClock.nowMs(), command.pressedAt);
            playlogRecorder.recordInput(
              'up',
              elapsedMsToGameSeconds(releaseNowMs, speed),
              command.releaseTokens,
              releasedChannels,
            );
          }
          for (const channel of releasedChannels) {
            activeKittyPressedChannels.delete(channel);
            if (uiEnabled) {
              uiSignals.pushCommand({ kind: 'release-lane', channel });
            }
            if (activeLongNotesByChannel.has(channel)) {
              longHoldUntilMsByChannel.set(channel, playbackClock.nowMs());
              longHoldReleaseSecondsByChannel.set(channel, elapsedMsToGameSeconds(playbackClock.nowMs(), speed));
            }
          }
          return;
        }
        if (playbackClock.isPaused()) {
          return;
        }
        if (command.kind !== 'lane-input') {
          return;
        }
        // The runtime adapter (web / node) snapshots `performance.now()` at OS-level event arrival and threads
        // it through as `command.pressedAt`. Adjusting the playback clock backwards by the wall-clock delta
        // means the judge resolves against the player's true press timing instead of the engine's drain time —
        // up to ~16 ms of artificial late-bias is removed on the 60 Hz tick. See `resolveJudgeNowMsFromPressedAt`
        // for the defensive bounds (negative / >50 ms deltas fall back to drain semantics).
        if (!uiEnabled) {
          const commandNowMs = resolveJudgeNowMsFromPressedAt(playbackClock.nowMs(), command.pressedAt);
          const commandNowSec = elapsedMsToGameSeconds(commandNowMs, speed);
          writeRuntimeEventLog(writeOutput, 'input', [
            ['time', formatSeconds(commandNowSec)],
            ['action', 'lane-input'],
            ['tokens', command.tokens.join(',')],
          ]);
          const scheduledSec = elapsedMsToGameSeconds(playbackClock.scheduledMs(), speed);
          triggerRealtimeAudioVolumeEvents(scheduledSec);
          playbackEventTracer.flushUntil(commandNowSec);
          handleMappedInputTokens(command.tokens, commandNowMs, commandNowSec);
          return;
        }
        const nowMs = resolveJudgeNowMsFromPressedAt(playbackClock.nowMs(), command.pressedAt);
        const nowSec = elapsedMsToGameSeconds(nowMs, speed);
        const scheduledSec = elapsedMsToGameSeconds(playbackClock.scheduledMs(), speed);
        triggerRealtimeAudioVolumeEvents(scheduledSec);
        playbackEventTracer.flushUntil(nowSec);
        handleMappedInputTokens(command.tokens, nowMs, nowSec);
      },
      logInterrupt: !uiEnabled
        ? (reason) => {
            writeRuntimeEventLog(writeOutput, 'interrupt', [
              ['time', formatSeconds(resolveManualCommandSeconds())],
              ['reason', reason],
            ]);
          }
        : undefined,
    });
  };

  // Replay playback — recorded play-log inputs re-driven at their exact chart-relative timestamps. Events are
  // processed at each tick boundary but judged with THEIR OWN chart seconds, so the replayed judgments are
  // deterministic and independent of tick timing. Presses maintain `activeKittyPressedChannels` so long-note holds
  // work exactly like the recorded run's key-state stream did.
  const replayEvents =
    options.replayInputs !== undefined && options.replayInputs.length > 0
      ? [...options.replayInputs].sort((left, right) => left.timeUs - right.timeUs || left.seq - right.seq)
      : undefined;
  let replayCursor = 0;
  const processReplayEventsUntil = (untilSec: number): void => {
    if (!replayEvents) return;
    while (replayCursor < replayEvents.length) {
      const event = replayEvents[replayCursor]!;
      const eventSec = event.timeUs / 1_000_000;
      if (eventSec > untilSec) break;
      replayCursor += 1;
      const channels = new Set(event.channels);
      if (autoScratchEnabled) {
        for (const channel of channels) {
          if (scratchPlayableChannels.has(channel)) {
            channels.delete(channel);
          }
        }
      }
      if (channels.size === 0) continue;
      const eventMs = (eventSec * 1000) / speed;
      if (event.action === 'down') {
        for (const channel of channels) {
          activeKittyPressedChannels.add(channel);
          if (uiEnabled) {
            uiSignals.pushCommand({ kind: 'press-lane', channel });
          }
        }
        playbackEventTracer.flushUntil(eventSec);
        handleLaneInputChannels(channels, event.tokens ?? [], eventMs, eventSec);
      } else {
        // Mirror the live kitty-release recording so a replayed run re-records an equivalent playlog.
        playlogRecorder?.recordInput('up', eventSec, event.tokens ?? [], channels);
        for (const channel of channels) {
          activeKittyPressedChannels.delete(channel);
          if (uiEnabled) {
            uiSignals.pushCommand({ kind: 'release-lane', channel });
          }
          if (activeLongNotesByChannel.has(channel)) {
            longHoldUntilMsByChannel.set(channel, eventMs);
            longHoldReleaseSecondsByChannel.set(channel, eventSec);
          }
        }
      }
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
        // Resume / ESC arrive as input commands; cutting the poll short on input arrival makes pause-resume
        // feel instantaneous instead of after one ~16 ms poll boundary.
        await waitPreciseOrInput(PAUSE_POLL_INTERVAL_MS, inputWakeUp);
        continue;
      }
      const scheduledMs = playbackClock.scheduledMs();
      const nowSec = elapsedMsToGameSeconds(nowMs, speed);
      const scheduledSec = elapsedMsToGameSeconds(scheduledMs, speed);
      const nowBeat = beatAtSeconds(nowSec);
      processReplayEventsUntil(nowSec);
        playbackEventTracer.flushUntil(nowSec);

      triggerRealtimeAudioVolumeEvents(scheduledSec);
      triggerNonPlayableRealtimeAudioEvents(scheduledSec);

      for (const channel of activeKittyPressedChannels) {
        if (!activeLongNotesByChannel.has(channel)) {
          continue;
        }
        longHoldUntilMsByChannel.set(channel, nowMs + LONG_NOTE_REPEAT_HOLD_GRACE_MS);
      }

      for (const [channel, hold] of activeLongNotesByChannel.entries()) {
        const holdUntilMs = longHoldUntilMsByChannel.get(channel);
        const isHolding = holdUntilMs !== undefined && nowMs <= holdUntilMs;
        // The tail is judged against the release instant when there was one — a frame can be hundreds of chart
        // milliseconds wide at high `speed`, and quantizing to it would turn a clean release into a GOOD.
        const releaseSeconds = longHoldReleaseSecondsByChannel.get(channel);
        const tailJudgeSeconds = releaseSeconds ?? nowSec;
        if (hold.mode === 1 && holdUntilMs !== undefined && nowMs > holdUntilMs && tailJudgeSeconds < hold.endSeconds) {
          if (!hold.audioStopped) {
            playbackStateLogger.logLongNoteState(nowSec, {
              channel,
              state: 'release',
              mode: hold.mode,
              event: hold.note.event,
              resources: wavResources,
              endSeconds: hold.endSeconds,
            });
            if (!uiEnabled) {
              writeSampleStopEventLog(
                writeOutput,
                channel,
                nowSec,
                'long-note-release',
                hold.note.event,
                wavResources,
                idBase,
              );
            }
            audioSession?.stopChannel?.(channel);
            hold.audioStopped = true;
          }
          finalizeActiveLongNote(
            channel,
            hold,
            { kind: 'BAD', signedDeltaMs: (tailJudgeSeconds - hold.endSeconds) * 1000 },
            tailJudgeSeconds,
          );
          continue;
        }
        if (hold.mode === 3) {
          const accumulateUntilSeconds = Math.min(nowSec, hold.endSeconds);
          if (accumulateUntilSeconds > hold.gaugeDrainCursorSeconds) {
            const elapsedSeconds = accumulateUntilSeconds - hold.gaugeDrainCursorSeconds;
            if (isHolding) {
              // HCN GAIN — held cleanly through this frame. Mirrors upstream
              // `JudgeManager.java:324-329`'s `gauge.update(1, 0.5f)` per 200 ms tick under
              // the gain branch. Continuous integration produces the same total gauge gain
              // over the same elapsed duration. Without this branch HCNs were one-shot
              // gauge sinks — once a player broke a hold, the only recovery path was
              // through subsequent normal-note PERFECTs.
              applyLoggedGaugeDelta(nowSec, elapsedSeconds * HELL_CHARGE_GAUGE_GAIN_PER_SECOND, 'hold-gain');
            } else {
              // HCN DRAIN — hold broken during this frame. Mirrors upstream
              // `JudgeManager.java:341-344`'s `gauge.update(3, 0.5f)` per 200 ms tick.
              applyLoggedGaugeDelta(nowSec, -elapsedSeconds * HELL_CHARGE_GAUGE_DRAIN_PER_SECOND, 'hold-drain');
            }
          }
          hold.gaugeDrainCursorSeconds = accumulateUntilSeconds;
          if (!isHolding && !hold.audioStopped) {
            playbackStateLogger.logLongNoteState(nowSec, {
              channel,
              state: 'break',
              mode: hold.mode,
              event: hold.note.event,
              resources: wavResources,
              endSeconds: hold.endSeconds,
            });
            if (!uiEnabled) {
              writeSampleStopEventLog(
                writeOutput,
                channel,
                nowSec,
                'long-note-break',
                hold.note.event,
                wavResources,
                idBase,
              );
            }
            audioSession?.stopChannel?.(channel);
            hold.audioStopped = true;
          }
        }

        if (nowSec >= hold.endSeconds) {
          if (
            isChargeLongNoteMode(hold.mode) &&
            isHolding &&
            nowSec < hold.endSeconds + judgeWindowLateReachUs(judgeWindowsFor(channel, hold.endSeconds, true)) / 1e6
          ) {
            // Charge modes judge the tail on the RELEASE. Still holding past the tail is not yet a judgment — the
            // player has until the tail's late window closes to let go, exactly as the play-log simulator models it.
            continue;
          }
          if (hold.mode === 1) {
            playbackStateLogger.logLongNoteState(nowSec, {
              channel,
              state: 'complete',
              mode: hold.mode,
              event: hold.note.event,
              resources: wavResources,
              endSeconds: hold.endSeconds,
            });
            finalizeActiveLongNote(channel, hold, hold.headJudge, nowSec);
            continue;
          }
          if (hold.mode === 3 && hold.endSeconds > hold.gaugeDrainCursorSeconds) {
            // Catch up the gauge accumulator to the tail mark. The per-frame loop above
            // (line ~3358) clamps to `Math.min(nowSec, endSeconds)`, so when the frame's
            // `nowSec` exceeds `endSeconds` (= the tail has just passed) there's still a
            // residual `[cursor, endSeconds]` slice unaccounted for. Direction picks gain
            // vs drain based on the player's hold state DURING that slice; we approximate
            // it with the current frame's `isHolding` since the engine doesn't track
            // hold-state samples per-tick (the slice is bounded by 1 frame ≈ 16ms at 60Hz
            // so the approximation error is at most ~0.04% gauge — negligible vs the 2.5%
            // /sec rate).
            const elapsedSeconds = hold.endSeconds - hold.gaugeDrainCursorSeconds;
            applyLoggedGaugeDelta(
              nowSec,
              isHolding
                ? elapsedSeconds * HELL_CHARGE_GAUGE_GAIN_PER_SECOND
                : -elapsedSeconds * HELL_CHARGE_GAUGE_DRAIN_PER_SECOND,
              isHolding ? 'hold-gain' : 'hold-drain',
            );
            hold.gaugeDrainCursorSeconds = hold.endSeconds;
          }
          playbackStateLogger.logLongNoteState(nowSec, {
            channel,
            state: 'complete',
            mode: hold.mode,
            event: hold.note.event,
            resources: wavResources,
            endSeconds: hold.endSeconds,
          });
          const finalJudge =
            hold.mode === 3 && !isHolding && releaseSeconds === undefined
              ? resolveLongNoteTailJudge(hold, {
                  kind: 'POOR',
                  signedDeltaMs: (nowSec - hold.endSeconds) * 1000,
                } satisfies TimedManualJudge)
              : resolveLongNoteTailJudge(
                  hold,
                  resolveManualTimedJudge(
                    (tailJudgeSeconds - hold.endSeconds) * 1000,
                    judgeWindowsFor(channel, hold.endSeconds, true),
                  ),
                );
          finalizeActiveLongNote(channel, hold, finalJudge, tailJudgeSeconds);
          continue;
        }

        if (hold.mode === 2 && holdUntilMs !== undefined && nowMs > holdUntilMs) {
          if (!hold.audioStopped) {
            playbackStateLogger.logLongNoteState(nowSec, {
              channel,
              state: 'release',
              mode: hold.mode,
              event: hold.note.event,
              resources: wavResources,
              endSeconds: hold.endSeconds,
            });
            if (!uiEnabled) {
              writeSampleStopEventLog(
                writeOutput,
                channel,
                nowSec,
                'long-note-release',
                hold.note.event,
                wavResources,
                idBase,
              );
            }
            audioSession?.stopChannel?.(channel);
            hold.audioStopped = true;
          }
          finalizeActiveLongNote(
            channel,
            hold,
            resolveLongNoteTailJudge(
              hold,
              resolveManualTimedJudge(
                (tailJudgeSeconds - hold.endSeconds) * 1000,
                judgeWindowsFor(channel, hold.endSeconds, true),
              ),
            ),
            tailJudgeSeconds,
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

      processLandminePassage(nowSec, nowMs);
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

      // Race the 60 Hz tick against the next input arrival. The judge timestamp itself is recovered via
      // `command.pressedAt`, so this race doesn't change *what* a press is judged as — it changes *when*
      // the keysound and lane flash get triggered. Pressing right after a tick boundary used to wait the
      // full ~16 ms before the keysound fired; with the race, the engine wakes within ~1 ms.
      await waitPreciseOrInput(TUI_FRAME_INTERVAL_MS, inputWakeUp);
    }

    if (!interruptedReason) {
      playbackEventTracer.flushUntil(totalSeconds);
      // Safety net for notes the per-frame sweep never reached (an audio tail that outran the loop, a hold still
      // open at the end). Counted from the notes themselves rather than from `summary.total`: the total is the
      // ruleset's EX-SCORE denominator, and under IIDX a missed charge note owes only ONE judgment even though it
      // counts for two, so topping the tally up to the denominator would invent a POOR.
      let missingCount = 0;
      for (const note of scorableNotes) {
        if (note.judged) {
          continue;
        }
        note.judged = true;
        missingCount += 1;
        if (longNoteOwesTailMiss(note)) {
          missingCount += 1;
        }
      }
      for (const hold of activeLongNotesByChannel.values()) {
        // The head already scored; only the unresolved tail is outstanding.
        if (hold.headScored) {
          missingCount += 1;
        }
      }
      activeLongNotesByChannel.clear();
      if (missingCount > 0) {
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
    inputWakeUp.dispose();
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
      if (playlogRecorder) {
        options.onPlaylogRecorded?.(
          playlogRecorder.finalize({ summary, maxCombo: scoreTracker.maxCombo, aborted: true }),
        );
      }
      writeOutput(renderSummary(summary, ruleset.moneyScore));
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
  if (playlogRecorder) {
    options.onPlaylogRecorded?.(playlogRecorder.finalize({ summary, maxCombo: scoreTracker.maxCombo }));
  }
  writeOutput(renderSummary(summary, ruleset.moneyScore));
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
  // Custom backend hook (web / browser / test). When supplied, the factory owns sample loading, mixing, and clock
  // state — we only forward the standard load-progress reporter so the host UI's loading bar still ticks during the
  // backend's own asset-decode phase. A factory that returns `undefined` is treated the same as omitting the hook
  // (fall through to the Node sink); this lets a runtime conditionally opt out at runtime (e.g. browser without
  // AudioContext support).
  if (options.createAudioSession) {
    const customSession = await options.createAudioSession({ json, options, mode, onLoadProgress });
    throwIfAborted(options.signal);
    if (customSession) {
      writeOutput(`Audio backend: ${customSession.backendLabel}\n`);
      onLoadProgress?.({ ratio: 1, message: 'Audio ready.' });
      return customSession;
    }
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
  // Cache the chart's object-ID radix so the per-event runtime lookup below uses the same case-sensitivity as the keys
  // in `samplesByKey` (which were extracted from `json.resources.wav` and therefore mirror the chart's authored case).
  const runtimeSampleIdBase = resolveBmsBase(json);
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
    getClockState: () => output.getClockState(),
    pause: () => {
      if (closed) {
        return;
      }
      paused = true;
      void output.suspend();
    },
    resume: () => {
      if (closed) {
        return;
      }
      paused = false;
      void output.resume();
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
      const normalized = normalizeObjectKey(event.value, runtimeSampleIdBase);
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
      if (usesMonophonicWavPlayback(json)) {
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
    resolveBmsBase(json),
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

  if (usesMonophonicWavPlayback(json)) {
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
  baseDir: string | undefined,
  signal: AbortSignal | undefined,
  base: 36 | 62,
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
      base,
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
  const outputStartSeconds = output.getClockState().outputSeconds;
  let adaptiveLeadMs = leadTuning.baseLeadMs;
  const chunkDurationMs = (chunkFrames / playbackSampleRate) * 1000;
  const outputDynamics = params.outputDynamics;
  let compressorGain = 1;
  let limiterGain = 1;

  while (!shouldStop()) {
    if (isPaused()) {
      await delay(PAUSE_POLL_INTERVAL_MS);
      continue;
    }

    const mixStartedAtMs = performance.now();
    await waitForPlaybackRealtime(output, playhead, playbackSampleRate, outputStartSeconds, shouldStop, adaptiveLeadMs);

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
  output: AudioSink,
  playheadFrames: number,
  sampleRate: number,
  startOutputSeconds: number,
  shouldStop: () => boolean,
  targetLeadMs: number,
): Promise<void> {
  const safeTargetLeadMs = Number.isFinite(targetLeadMs) ? Math.max(0, targetLeadMs) : MANUAL_AUDIO_TARGET_LEAD_MS;
  const targetLeadFrames = Math.max(0, Math.round((safeTargetLeadMs / 1000) * sampleRate));

  while (!shouldStop()) {
    const outputSeconds = Math.max(0, output.getClockState().outputSeconds - startOutputSeconds);
    const elapsedFrames = Math.floor(outputSeconds * sampleRate);
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

export function shouldUseAutoMixBgmHeadroomControl(options: PlayerOptions): boolean {
  return options.limiter === false;
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

  const idBase = resolveBmsBase(json);
  for (let index = 0; index < keys.length; index += 1) {
    throwIfAborted(signal);
    const key = keys[index];
    const sourcePath = json.resources.wav[key];
    const rendered = await renderSingleSample(key, sourcePath, {
      baseDir: options.audioBaseDir ?? process.cwd(),
      sampleRate,
      gain: chartWavGain,
      fallbackToneSeconds:
        typeof options.missingSampleToneSeconds === 'number' &&
        Number.isFinite(options.missingSampleToneSeconds) &&
        options.missingSampleToneSeconds > 0
          ? options.missingSampleToneSeconds
          : 0,
      signal,
      base: idBase,
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
  if (
    typeof json.resources.wav[LANDMINE_EXPLOSION_SAMPLE_KEY] === 'string' &&
    json.resources.wav[LANDMINE_EXPLOSION_SAMPLE_KEY].length > 0 &&
    json.events.some((event) => {
      const normalized = normalizeChannel(event.channel);
      if (normalized.length !== 2) {
        return false;
      }
      const side = normalized.charCodeAt(0);
      const lane = normalized.charCodeAt(1);
      return (side === 0x44 || side === 0x45) && lane >= 0x31 && lane <= 0x39;
    })
  ) {
    keys.add(LANDMINE_EXPLOSION_SAMPLE_KEY);
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

function createPerformancePlaybackClockSource(): PlaybackClockSource {
  return {
    nowMs: () => performance.now(),
  };
}

function createAudioPlaybackClockSource(audioSession: AudioSession | undefined): PlaybackClockSource {
  if (!audioSession?.getClockState) {
    return createPerformancePlaybackClockSource();
  }
  return {
    // Keep gameplay on the audible clock while exposing the buffered write head separately.
    nowMs: () => audioSession.getClockState!().outputSeconds * 1000,
    scheduledMs: () => {
      const clockState = audioSession.getClockState!();
      return Math.max(clockState.outputSeconds, clockState.scheduledSeconds) * 1000;
    },
  };
}

function createPlaybackClock(source: PlaybackClockSource, startOffsetMs = 0): PlaybackClock {
  const sourceScheduledMs = source.scheduledMs ?? source.nowMs;
  const anchorMs = source.nowMs() + (Number.isFinite(startOffsetMs) ? startOffsetMs : 0);
  let paused = false;
  let pausedScheduledMs = 0;
  let pauseSourceMs = 0;
  let pausedSourceDurationMs = 0;

  const resolveNowMs = (): number => {
    const referenceSourceMs = paused ? pauseSourceMs : source.nowMs();
    return Math.max(0, referenceSourceMs - anchorMs - pausedSourceDurationMs);
  };

  const resolveScheduledMs = (): number => {
    if (paused) {
      return pausedScheduledMs;
    }
    const scheduledSourceMs = Math.max(source.nowMs(), sourceScheduledMs());
    return Math.max(0, scheduledSourceMs - anchorMs - pausedSourceDurationMs);
  };

  const nowMs = (): number => resolveNowMs();

  return {
    nowMs,
    scheduledMs: () => resolveScheduledMs(),
    isPaused: () => paused,
    pause: () => {
      if (paused) {
        return false;
      }
      paused = true;
      pauseSourceMs = source.nowMs();
      pausedScheduledMs = resolveScheduledMs();
      return true;
    },
    resume: () => {
      if (!paused) {
        return false;
      }
      pausedSourceDurationMs += Math.max(0, source.nowMs() - pauseSourceMs);
      paused = false;
      pausedScheduledMs = 0;
      pauseSourceMs = 0;
      return true;
    },
  };
}

function elapsedMsToGameSeconds(elapsedMs: number, speed: number): number {
  return Math.max(0, (elapsedMs / 1000) * speed);
}

/**
 * Adjusts a drain-time playback timestamp backwards by the wall-clock delta between the OS-level press event and
 * now, so judging a queued lane-input resolves against the player's actual press timing rather than the engine's
 * next-tick drain time. Without this, a press that lands a few ms before the next 60 Hz tick gets judged up to
 * ~16 ms late even though the player hit the note on time. With it, the judge timestamp matches the physical
 * press to within event-handler latency (= ~1–3 ms on typical hardware).
 *
 * `pressedAt` is in the **wall-clock-ms domain** (`Date.now()`-equivalent, but with sub-ms precision via
 * `performance.timeOrigin + performance.now()`), NOT the per-thread `performance.now()` domain. This matters
 * because the TUI's input runtime runs on the main thread and the engine runs in a `worker_threads` Worker —
 * each thread has its own `performance.timeOrigin`, so a raw `performance.now()` snapshot from the main thread
 * compared against the worker's `performance.now()` would always read as "in the future" (negative delta) and
 * the fallback would silently swallow every press. Wall-clock-ms is process-shared, so the comparison is
 * stable across worker boundaries, and `KeyboardEvent.timeStamp` on the web (also `performance.timeOrigin`-
 * relative) feeds the same domain after a `+ performance.timeOrigin` adjustment in the runtime adapter.
 *
 * Defensive bounds:
 * - Negative delta (`pressedAt` in the future) → fall back to drain time. Happens with synthetic / test inputs
 *   that supply a fixed timestamp ahead of the clock; the legacy semantics are still correct in that case.
 * - Delta > {@link PRESSED_AT_MAX_DELTA_MS} → fall back to drain time. Long stalls (pause-then-resume, GC) can
 *   make the wall-clock delta diverge from the playback delta because `playbackClock` pauses while the wall
 *   clock keeps ticking. Capping the adjustment prevents stale presses from being judged in the past after a
 *   pause.
 */
function resolveJudgeNowMsFromPressedAt(drainNowMs: number, pressedAt: number | undefined): number {
  if (pressedAt === undefined) return drainNowMs;
  const deltaMs = performance.timeOrigin + performance.now() - pressedAt;
  if (deltaMs < 0 || deltaMs > PRESSED_AT_MAX_DELTA_MS) return drainNowMs;
  return Math.max(0, drainNowMs - deltaMs);
}

/**
 * Cap on the wall-clock delta we'll accept between `pressedAt` and drain time. Anything larger almost certainly
 * indicates a paused-then-resumed segment (where `performance.now()` ticked but the playback clock didn't), so
 * we fall back to drain-time semantics rather than over-subtract. 50 ms is comfortably above the engine's 16.67
 * ms TUI tick + a stutter-frame margin and well below any real pause duration.
 */
const PRESSED_AT_MAX_DELTA_MS = 50;

/**
 * Precise sleep that cuts the wait short on the next input arrival
 * (`inputSignals.pushCommand`). Returns `'timeout'` when the full delay elapsed and `'input'` when an input
 * woke us up early. The caller decides what to do on `'input'` — typically re-drain the input queue and
 * continue waiting for the rest of the original tick.
 *
 * The input wake-up owns a cancellable input-vs-timeout wait. That matters for timeout-heavy runs: using
 * `Promise.race([wakeUp.wait(), timer])` leaves the losing wake-up branch attached to the shared input promise
 * until the next key press, which can retain a growing PromiseReaction chain during AUTO play or long no-input
 * stretches.
 *
 * Why the race exists at all: `pressedAt` ensures the JUDGE timestamp is correct regardless of drain timing,
 * but the audio / visual response (keysound playback, lane flash queueing) still happens at drain time.
 * Without this race the engine sleeps a full 16.67 ms tick before processing inputs that arrived mid-tick,
 * adding up to that much delay before the keysound is heard. With the race the engine wakes up within ~1 ms
 * of the press and triggers audio at that point — perceived as "immediate."
 */
async function waitPreciseOrInput(
  delayMs: number,
  wakeUp: { waitForInputOrTimeout: (timeoutMs: number) => Promise<'timeout' | 'input'> },
): Promise<'timeout' | 'input'> {
  const target = performance.now() + Math.max(0, delayMs);
  while (true) {
    const remaining = target - performance.now();
    if (remaining <= 0) {
      return 'timeout';
    }
    if (remaining > 8) {
      const winner = await wakeUp.waitForInputOrTimeout(remaining - 4);
      if (winner === 'input') {
        return 'input';
      }
      continue;
    }
    const winner = await wakeUp.waitForInputOrTimeout(0);
    if (winner === 'input') {
      return 'input';
    }
  }
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

function renderSummary(summary: PlayerSummary, moneyScore: boolean): string {
  const maxExScore = Math.max(0, summary.total * IIDX_EX_SCORE_PER_PGREAT);
  const exScoreRate = maxExScore > 0 ? summary.exScore / maxExScore : 0;
  const scoreRate = summary.score / LR2_MONEY_SCORE_MAX;
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
      `EMPTY  : ${summary.emptyPoor}`,
      `FAST   : ${summary.fast}`,
      `SLOW   : ${summary.slow}`,
      `EX-SCORE: ${summary.exScore} / ${maxExScore} (${(exScoreRate * 100).toFixed(2)}%)`,
      // Only LR2 defines a money score; the other rulesets report EX-SCORE in this field, so printing a
      // percentage of 200000 there would be meaningless.
      ...(moneyScore ? [`SCORE   : ${summary.score} / ${LR2_MONEY_SCORE_MAX} (${(scoreRate * 100).toFixed(2)}%)`] : []),
    ].join('\n') + '\n'
  );
}
