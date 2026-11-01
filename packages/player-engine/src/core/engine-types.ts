import type { ChartOptionProgram, ChartOptionDiagnostic, ChartPlayOptionProgram } from '@be-music/chart-model';
import type { ChartTextStage } from './chart-text.ts';
export type { ChartTextStage } from './chart-text.ts';
import type { BattleMode } from './battle-mode.ts';
import type { LR2ExtraLevel } from './lr2-extra-lanes.ts';
import type { LongNoteModifier, LongNotePlacement } from './long-note-modifier.ts';
import type { MineModifier, MinePlacement } from './mine-modifier.ts';
import {
  type KeyBoundBGACue,
  type BmsonBGAEventCue,
  type ChartPlayVariant,
  type RandomDraws,
  type ResolvedChart,
} from '@be-music/chart-model';
import type { LogEntry } from '@be-music/shared-utils/log';
import { type BeMusicEvent, type BeMusicJSON } from '@be-music/chart-source';
import { type PlayerStateSignals } from '../state-signals.ts';
import { type LaneBinding } from './lane-layout.ts';
import { type ImageResizeAlgorithm } from '../image-resize-algorithm.ts';
import { type TUINoteHeight } from './ui-options.ts';
import { type AudioSinkClockState } from '../audio-clock.ts';
import { type PlayerGaugeSummary, type PlayerUISignalBus } from './ui-signal-bus.ts';
import { type PlayerInputSignalBus } from './input-signal-bus.ts';
import type { GaugeType, GaugeAutoShift } from '../ruleset/gauge-type.ts';
import { type LongNoteStyle, type RulesetId, type RulesetWindowTables } from '../ruleset/index.ts';
import { type ReplayRecordingOptions } from '../replay/recorder.ts';
import type { BeMusicReplay, ReplayCourseStage, ReplayInputEvent } from '../replay/format.ts';
import type { ReplayTempoChange } from '../replay/view.ts';
import { type PreparedPlaybackChartData } from './bootstrap.ts';

/**
 * Public types of the playback engine: options, runtimes, the audio-session contract and the summary.
 */
export interface PlayerUIRuntime {
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
  /**
   * Whether the input reports its key releases (`kitty-state` releases), declared before the play starts. `true`: a
   * manual play judges it as key-state input from its first key, so even its first press is judged as it comes, with
   * no inferred hold. Absent (or `false`): the engine detects it, inferring when each key came up
   * (`play-key-inference.ts`) until the first `kitty-state` command arrives. A browser always reports releases; a
   * terminal does only under the kitty keyboard protocol (or Windows' win32-input-mode).
   */
  reportsKeyReleases?: boolean;
}

export interface CreatePlayerUIRuntimeContext {
  keyBoundBGACues?: readonly KeyBoundBGACue[];
  /** Remapped bmson event animations supplied by a NONSTOP host. */
  bmsonBGACues?: readonly BmsonBGAEventCue[];
  json: BeMusicJSON;
  mode: 'AUTO' | 'MANUAL' | 'AUTO SCRATCH';
  laneDisplayMode: string;
  laneBindings: LaneBinding[];
  speed: number;
  uiFPS?: number;
  tuiVisibleNotesLimit?: number;
  tuiNoteHeight: TUINoteHeight;
  judgeWindowMs: number;
  highSpeed: number;
  imageResizeAlgorithm: ImageResizeAlgorithm;
  videoBGAStreaming?: boolean;
  showLaneChannels: boolean;
  randomPatternSummary?: string;
  stateSignals: PlayerStateSignals;
  uiSignals: PlayerUISignalBus;
  baseDir: string;
  loadSignal?: AbortSignal;
  onBGALoadProgress: (progress: { ratio: number; detail?: string }) => void;
}

export interface CreatePlayerInputRuntimeContext {
  mode: 'auto' | 'manual';
  inputSignals: PlayerInputSignalBus;
  inputTokenToChannels: ReadonlyMap<string, readonly string[]>;
}

/**
 * Play settings: what decides the judgments and the score, or which chart / branch is played. Plain serializable
 * values, and the set a replay has to carry to reproduce a play (see "Engine options by category" in
 * docs/architecture.md for the ones it does not record yet). The engine does not read `auto`: the host picks
 * `autoPlay` or `manualPlay`.
 */
export interface PlayerPlaySettings {
  /** Absent retains beatoraja-compatible bmson zero-total recovery. */
  bmsonTotalMode?: import('../ruleset/bmson-total.ts').BmsonTotalMode;
  /** beatoraja scroll modifier; REMOVE changes coordinates and ADD replaces the scroll-rate timeline. Event times stay fixed. */
  scrollModifier?: import('./scroll-modifier.ts').ScrollModifier;
  scrollSection?: number;
  scrollRate?: number;
  /** Effective source ADD curve; supplying it restores the original draws. */
  scrollModifierTimeline?: readonly import('@be-music/chart-model').ScrollTimelinePoint[];
  auto?: boolean;
  autoScratch?: boolean;
  /** beatoraja's note-selection algorithm; other source rulesets retain their own fixed selection. */
  judgeAlgorithm?: 'combo' | 'duration' | 'lowest';
  /** beatoraja CUSTOM JUDGE rates; absent while the option is off. Recorded into the replay. */
  customJudge?: import('../ruleset/custom-judge.ts').BeatorajaCustomJudge;
  /**
   * beatoraja PRACTICE: plays only the range, with its gauge, TOTAL and judgerank, from 1000 ms before the range. The
   * source applies no chart modifier in PRACTICE; a practice play records no replay.
   */
  practice?: import('./practice.ts').BeatorajaPractice;
  /**
   * The automatic judge-timing adjustment of a manual play (default `'OFF'`): beatoraja's calibration or LR2's ON /
   * SILENT. Display-only: it moves {@link judgeTimingMs}, never the input or audio clocks. AUTO and replays never adjust.
   */
  judgeTimingAutoAdjust?: import('./judge-timing.ts').JudgeTimingAutoAdjust;
  judgeTimingMs?: number;
  longNoteModifier?: LongNoteModifier;
  /** Probability for source long-note additions, default 1. */
  longNoteRate?: number;
  /** beatoraja EXTRA: source depth 0..100 (0 disables it), with optional scratch participation. */
  extraNoteDepth?: number;
  extraNoteScratch?: boolean;
  /** LR2 beta3 EXTRA, independently selected from beatoraja EXTRA depth. Courses ignore it. */
  sevenToNinePattern?: import('./seven-to-nine.ts').SevenToNinePattern;
  sevenToNineType?: import('./seven-to-nine.ts').SevenToNineType;
  hRandomThresholdBPM?: number;
  battleMode?: BattleMode;
  /** The 2P player's gauge in a two-player play (`battleMode: 'TWO-PLAYER'`); absent plays the 1P gauge. */
  gauge2P?: string;
  /** LR2 D-BATTLE: the scratch key was held through the decide animation, so scratch objects stay playable. */
  dBattleScratch?: boolean;
  lr2ExtraMode?: boolean;
  lr2ExtraLevel?: LR2ExtraLevel;
  mineModifier?: MineModifier;
  /** Independently assist the source play side; explicit values override autoScratch for that side. */
  autoScratch1P?: boolean;
  autoScratch2P?: boolean;
  /**
   * ANY KEY (That-Which-Must-Not-Be-Named PC, #751): a press takes the nearest unjudged note in reach on any lane and
   * holds that lane until its key comes up. Manual play only; the replay records it as `play.anyKey`.
   */
  anyKey?: boolean;
  /**
   * Gauge the player selected, as an LR2-family id (`'GROOVE'` / `'EASY'` / `'HARD'` / `'DEATH'`). Mapped onto the
   * active ruleset's own line-up — `'GROOVE'` is beatoraja's `NORMAL`, `'DEATH'` is its `HAZARD`, and so on.
   * Defaults to `recordReplay.gauge`, then `'GROOVE'`. The replay records the gauge the play ran on.
   */
  gauge?: GaugeType;
  /**
   * The compat ruleset the play is judged under: `'lr2'` (default), `'beatoraja'` or `'____'`. It owns every judge
   * rule — the windows (beatoraja's SEVENKEYS windows scaled by its judgerank, That-Which-Must-Not-Be-Named's fixed ±16.67 / ±33.33 /
   * ±116.67 / ±250 ms), which note a press resolves against, the long-note style, the empty-POOR rule, mines, the gauge
   * line-up and its curve, and the score — and the replay simulator plays by the same tables. Dynamic `#EXRANKxx`
   * changes are an LR2 concept and only apply under `'lr2'`. Recorded into the replay (`play.judgeRuleset`) so
   * replays and re-simulations judge under the same ruleset.
   */
  judgeRuleset?: RulesetId;
  /**
   * The `#RANDOM` / `#SWITCH` outcomes of this play (`resolvePlayChart`, or `drawRandomOutcomes` from
   * `@be-music/chart-model`). With a chart the host already resolved, these are the draws it was resolved with and only feed
   * the RANDOM summary. With a chart that still carries `bms.controlFlow` (e.g. replaying a replay against the source
   * chart), the engine resolves it exactly once with these draws. The engine never draws itself: a chart with control
   * flow and no draws is rejected with a `TypeError`.
   */
  randomDraws?: RandomDraws;
  speed?: number;
  inferBmsLNTypeWhenMissing?: boolean;
  /**
   * The chart file's extension (`.bms` / `.bme` / `.pms` / ...). Feeds the extension rules of the shared lane-mode rule
   * (`resolveChartPlayVariant` from `@be-music/chart-model`): `.pms` is 9 KEY. Every other extension leaves the decision to the
   * lanes in use (a `.bme` chart without a 6 / 7 key column is 5 / 10 KEY, as in beatoraja).
   */
  laneModeExtension?: string;
  /**
   * The chart's play variant, when the host declares it. Routes straight to the corresponding lane mode:
   *
   *   - `'5'`  → `5-key-sp`     - `'10'` → `5-key-dp`
   *   - `'7'`  → `7-key-sp`     - `'14'` → `14-key-dp`
   *   - `'9'`  → `9-key`        - `'24'` → `24-key-sp`    - `'48'` → `48-key-dp`
   *
   * When omitted, the engine resolves it with `resolveChartPlayVariant` over the resolved chart's events (after
   * `#RANDOM`), `laneModeExtension`, and `#PLAYER` — the same rule the web hosts use to pick play skins — so the lane
   * mode (and the beatoraja per-mode judge windows that follow from it) never depends on mines, invisible objects, or
   * which long-note notation the chart uses.
   */
  playVariant?: ChartPlayVariant;
  /**
   * End the play the moment a survival gauge empties, as LR2 and beatoraja do: nothing after the judgment that emptied
   * it counts, and the play stops there. Default `true`; `false` keeps judging to the end of the chart with the gauge
   * dead (`failedMidPlay`). Recorded into the replay (`play.endOnFailure`) so re-simulations stop at the same point.
   */
  endOnFailure?: boolean;
  /** Source-defined beatoraja policy; when present, takes precedence over endOnFailure. */
  gaugeAutoShift?: GaugeAutoShift;
  bottomShiftableGauge?: import('../ruleset/gauge-type.ts').GaugeShiftBottom;
  /**
   * This play is one stage of a course: the stage runs on the ruleset's course gauge under the course's judge
   * constraint, starting from the state the previous stage left (`carryIn`; absent for the first stage). Recorded into
   * the replay (`play.course`), so the stage replays on its own.
   */
  course?: ReplayCourseStage;
  /**
   * The judge rank changes of a stitched LR2 NONSTOP chart's later stages (`NonstopStitchMap.stageRanks` from
   * `@be-music/player-engine/course`), in chart seconds: from each change on, the windows of that stage's `#RANK`. Applied under
   * LR2 (and beatoraja for mixed bmson courses) and recorded into the replay (`chart.judgeRank.stageRanks`), so a replay
   * and a re-simulation judge with them.
   */
  stageRanks?: ReadonlyArray<PlayerStageRank>;
  /**
   * The chart second the play starts at instead of the chart's beginning: the play's first seek (a `{ kind: 'seek' }`
   * input command, applied as the chart starts). AUTO play and replays rebuild their judgments; manual play starts practice and skips earlier note heads and tails without scoring.
   * The judge state there is the one a play from the start reaches (the notes before it judged, without their keysounds,
   * flashes or bombs), the volume changes before it apply, and sounds that started earlier and still ring start
   * partway, through `AudioSession.triggerEventAt`. A play that seeks records no replay.
   */
  startAtSeconds?: number;
}

/** One judge rank change of {@link PlayerPlaySettings.stageRanks}. */
export interface PlayerStageRank {
  seconds: number;
  rank: number;
  table: 'chart' | 'lr2-nonstop' | 'bmson' | 'bms-exrank';
}

/**
 * Play runtime: the host services the engine runs on — adapter factories, the abort signal, callbacks and
 * output sinks, and the chart data a host prepared itself. Functions and live objects, never serialized.
 */
export interface PlayerPlayRuntime {
  /** Versioned effective chart-authored display operations, e.g. a recorded replay or NONSTOP program. */
  chartOptionProgram?: ChartOptionProgram;
  /**
   * Chart-authored gameplay options (RANDOM, judgment CRAZY, #844) the play runs with, e.g. a recorded replay's. Absent:
   * compiled from the chart's initial `#OPTION`s. A host applies the arrangement and ADDMINE before preparing the chart;
   * the engine applies the judge modifiers and records the program.
   */
  chartPlayOptionProgram?: ChartPlayOptionProgram;
  /** Diagnostics retained by a host compiling stage-owned programs before playback. */
  chartOptionDiagnostics?: readonly ChartOptionDiagnostic[];
  /** Stage-owned chart text supplied by a NONSTOP host; overrides flattened TEXT definitions. */
  chartTextStages?: readonly ChartTextStage[];
  /** Host-remapped input-bound BGA selections, e.g. NonstopStitchMap.keyBoundBGA. Overrides chart A5 controls. */
  keyBoundBGACues?: readonly KeyBoundBGACue[];
  /** Remapped bmson event animations supplied by a NONSTOP host. */
  bmsonBGACues?: readonly BmsonBGAEventCue[];
  /**
   * Pre-built playback chart data the host wants the engine to use verbatim instead of running its own
   * `preparePlaybackChartData` pass. When provided, the engine treats the supplied {@link PreparedPlaybackChartData}
   * as the single source of truth for the playable / landmine / invisible / scorable note arrays, the lane
   * bindings, the input-token map, the active free-zone channel set, and the playback's `totalSeconds`.
   *
   * Why this exists: the web renderer used to call `extractTimedNotes` independently of the engine to build its
   * own `notes` / `mineNotes` / `invisibleNotes` arrays, and `applyEngineFrame` then synced the engine's
   * per-note `judged` flag onto the renderer's parallel arrays by **shared array index**. Any divergence
   * between the two extract calls (a different `inferBmsLNTypeWhenMissing` flag, a different
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
  /** Recorded mine population for deterministic playback of a generated mine option. */
  mineModifierPlacements?: readonly MinePlacement[];
  longNoteModifierPlacements?: readonly LongNotePlacement[];
  createUIRuntime?: (context: CreatePlayerUIRuntimeContext) => Promise<PlayerUIRuntime | undefined>;
  createInputRuntime?: (context: CreatePlayerInputRuntimeContext) => PlayerInputRuntime | undefined;
  /** The host's audio backend. Omitted or returning undefined means playback without audio. */
  createAudioSession?: (context: CreateAudioSessionContext) => Promise<AudioSession | undefined>;
  /** Optional sample-duration loader for active-audio diagnostics, including silent playback. */
  loadAudioSampleDurations?: (
    resolved: ResolvedChart,
    options: { baseDir?: string; signal?: AbortSignal },
  ) => Promise<ReadonlyMap<string, number>>;
  signal?: AbortSignal;
  /**
   * Keeps a play open after its chart is over, so the player's keys still light the lanes (and the chart's remaining
   * background sounds still play) while the host shows its outro. When the chart is over — every note judged and the
   * judge windows passed — `onSettled` runs once; the play then carries on until `signal` aborts, and only then ends
   * normally (its summary and replay as usual; aborting this signal is not an interrupt). Without it a play ends as
   * soon as its chart is over. Manual, replay and AUTO play alike.
   */
  holdAfterChart?: { signal: AbortSignal; onSettled?: () => void };
  audioBaseDir?: string;
  onLoadProgress?: (progress: PlayerLoadProgress) => void;
  onLoadComplete?: () => void;
  onHighSpeedChange?: (highSpeed: number) => void;
  /**
   * Called when the play tempo changes during the play (a `{ kind: 'tempo' }` input command, or a replay following
   * {@link PlayerPlayRecording.replayTempoChanges}), with the new tempo and the chart second it took effect at. Chart time
   * stays continuous across the change and runs at the new tempo from then on; a host with its own clock follows it
   * from that chart second.
   */
  onTempoChange?: (change: PlayerTempoChange) => void;
  onResolvedChart?: (json: BeMusicJSON) => void;
  /**
   * Called once, before playback starts, with the ruleset the play is judged under — after `judgeRuleset`,
   * `judgeWindowMs`, and (for a replay) the recorded settings were applied. Lets a host show the windows the engine
   * actually uses instead of re-deriving them. Under LR2 a mid-chart `#EXRANKxx` can narrow or widen the windows
   * later; `windows` is the table in force at the start of the chart.
   */
  onRulesetResolved?: (info: PlayerRulesetInfo) => void;
  onLog?: (entry: LogEntry) => void;
  writeOutput?: (text: string) => void;
}

/**
 * Play tuning: audio, latency and rendering knobs. They change how the play sounds and looks, never what is
 * judged (`audioOffsetMs` moves the judge clock against live input, but recorded inputs are already on chart
 * time). The engine does not read `tui` or `audioTailSeconds`.
 */
export interface PlayerPlayTuning {
  audio?: boolean;
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
  compressor?: boolean;
  compressorThresholdDb?: number;
  compressorRatio?: number;
  compressorAttackMs?: number;
  compressorReleaseMs?: number;
  compressorMakeupDb?: number;
  limiter?: boolean;
  limiterCeilingDb?: number;
  limiterReleaseMs?: number;
  leadInMs?: number;
  /** Wait for a `start` input command as well as the lead-in before starting chart time and audio. */
  waitForStart?: boolean;
  audioOffsetMs?: number;
  audioHeadPaddingMs?: number;
  audioTailSeconds?: number;
  audioLeadMs?: number;
  audioLeadMaxMs?: number;
  audioLeadStepUpMs?: number;
  audioLeadStepDownMs?: number;
  highSpeed?: number;
  uiFPS?: number;
  tui?: boolean;
  tuiVisibleNotesLimit?: number;
  tuiNoteHeight?: TUINoteHeight;
  imageResizeAlgorithm?: ImageResizeAlgorithm;
  videoBGAStreaming?: boolean;
}

/**
 * Play debug: diagnostic overrides. `judgeWindowMs` changes the judgments (the replay records it as
 * `play.judgeWindowOverrideMs`); the others only change what is shown or heard. The engine does not read
 * `showInvisibleNotes`.
 */
export interface PlayerPlayDebug {
  judgeWindowMs?: number;
  debugActiveAudio?: boolean;
  showInvisibleNotes?: boolean;
  /**
   * Debug aid — synthesizes a short sine tone for `#WAVxx` references whose file is missing or fails to decode.
   * The spec-compliant default is silence (LR2 / beatoraja play nothing for a broken keysound reference); enable
   * this only in test rigs / chart debugging where hearing that a trigger fired matters.
   */
  missingSampleToneSeconds?: number;
}

/**
 * Play recording: replay capture and replay. `recordReplay` declares the host-side settings the log records
 * (`gauge`, `randomLane`, `dpFlip`, `native`) next to the chart identity, and `replayInputs` re-drives a
 * recorded input stream.
 */
export interface PlayerPlayRecording {
  /**
   * Host-declared play settings merged into the recorded replay (`randomLane`, `dpFlip`, `native`, ...). The engine
   * itself knows mode / auto-scratch / judge-window override; everything host-side (which lane shuffle produced
   * `preparedChart`, ...) arrives through this bag. `gauge` here is a fallback for {@link PlayerPlaySettings.gauge}: the play runs on, and
   * the log records, one gauge. Only meaningful together with {@link onReplayRecorded}.
   */
  recordReplay?: ReplayRecordingOptions;
  /**
   * Enables replay recording: when set, the engine snapshots the resolved chart it actually played
   * (post-`#RANDOM`, post lane-shuffle via `preparedChart`), records every judged key press / release with
   * chart-relative timestamps, and hands the assembled {@link BeMusicReplay} here right before `autoPlay` /
   * `manualPlay` resolves — including the ESC (aborted) exit. A play that sought (`startAtSeconds`, a `seek` command)
   * records none: it is discarded at the first seek. The replay's `results.native` caches this run's
   * engine summary; see `@be-music/player-engine/replay` for the format and the LR2 / beatoraja / That-Which-Must-Not-Be-Named re-simulation
   * tools.
   */
  onReplayRecorded?: (replay: BeMusicReplay) => void;
  /**
   * Replay playback: a recorded replay input stream (`replay.inputs`) `manualPlay` re-drives DETERMINISTICALLY.
   * Each event fires at its exact chart-relative microsecond timestamp (no wall-clock jitter — the judge timestamp
   * is the recorded one), so replaying a log against the same resolved chart reproduces the original judgments.
   * While a replay is active, live lane / kitty input commands are ignored; pause, high-speed, and interrupt
   * commands keep working. The caller is responsible for mounting the SAME resolved chart the log was recorded
   * against (`preparedChart`, or a chart remapped to the log's note arrangement). `autoPlay` has no inputs to
   * re-drive, but a replay of an AUTO-played log passes its (empty) inputs too: either way the play is a replay, so
   * its `speed` and tempo changes only set how fast it is re-driven and a re-recorded log carries neither.
   */
  replayInputs?: readonly ReplayInputEvent[];
  /**
   * The tempo changes a replay follows (`play.tempoChanges` of its log, in chart time), on top of `speed` as the tempo
   * at the start (`play.tempo`). Each takes effect once the replay's chart time reaches it, as a live `{ kind: 'tempo' }`
   * command would. Read only in a replay ({@link replayInputs} set), by `manualPlay` and `autoPlay` alike; it changes no
   * judgment.
   */
  replayTempoChanges?: readonly ReplayTempoChange[];
  /**
   * Where the replayed play was aborted (`play.abortedAtUs` of a log with `play.aborted`), in chart microseconds: the
   * replay judges up to it and stops there, as an ESC, as the replay simulators stop there, instead of missing the
   * rest of the chart. Read only in a replay ({@link replayInputs} set).
   */
  replayAbortedAtUs?: number;
}

/**
 * Options of `autoPlay` / `manualPlay`: the union of the five categories above. Every field belongs to exactly one
 * of them (`engine-types.test.ts` enforces it), so a new option has to be classified when it is added.
 */
export interface PlayerOptions
  extends PlayerPlaySettings, PlayerPlayRuntime, PlayerPlayTuning, PlayerPlayDebug, PlayerPlayRecording {}

/** A tempo change during a play; see {@link PlayerOptions.onTempoChange}. */
export interface PlayerTempoChange {
  /** The new tempo (chart seconds per clock second). */
  tempo: number;
  /** The chart second the change took effect at. */
  seconds: number;
}

/** The judging setup a play resolved to; see {@link PlayerOptions.onRulesetResolved}. */
export interface PlayerRulesetInfo {
  /** Versioned ruleset id (`'lr2/0'`, `'beatoraja/0'`, `'____/0'`). */
  id: string;
  rulesetId: RulesetId;
  /** How the ruleset plays the chart's long notes (LN / per-note / charge). */
  longNoteStyle: LongNoteStyle;
  /**
   * Judgment windows (µs) at the start of the chart, in the ruleset convention `delta = noteTime - inputTime`: each pair
   * is `[lateBound <= 0, earlyBound >= 0]`, so a positive delta is an EARLY press.
   */
  windows: RulesetWindowTables;
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
  /** Missed notes, plus LR2 mine hits (`minePoor`). Empty POORs are counted separately. */
  poor: number;
  /**
   * Empty POOR (空POOR) — a press with no note in reach but one inside the ruleset's miss window. It costs gauge
   * and fires the POOR cue without consuming a note, so it never reaches EX-SCORE and is tracked apart from
   * `poor`. Whether a player's POOR counter displays the two summed is a per-ruleset presentation choice: LR2 does
   * (OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for it), which is why the split is exposed here.
   */
  emptyPoor: number;
  /** LR2 mine hits already included in `poor`; not judgment notes and never a combo break. */
  minePoor?: number;
  exScore: number;
  score: number;
  /**
   * The combo running now: the one the judge cues count, rebuilt with the rest of the summary when the play seeks. The
   * engine's summaries always carry it; it is optional so a summary a host builds itself need not.
   */
  combo?: number;
  /** Final combo eligibility when empty POOR can break combo; absent in legacy/count-only results. */
  fullCombo?: boolean;

  /** The highest combo of the play so far; see {@link combo}. */
  maxCombo?: number;
  gauge?: PlayerGaugeSummary;
  /** For a course stage: the course-wide combo running now and the course-wide max combo (carried across stages). */
  course?: { combo: number; maxCombo: number };
  /** The 2P player's summary of a two-player play (LR2 BATTLE); this summary is the 1P player's. */
  secondPlayer?: PlayerSummary;
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

/**
 * The host-provided audio playback contract. Node and browser adapters implement this shape and plug in via
 * {@link PlayerOptions.createAudioSession}.
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
  /**
   * Plays `event`'s sound as if it had started `offsetSeconds` ago, for a play that seeks (`PlayerOptions.startAtSeconds`,
   * a `seek` command). A sound shorter than the offset plays nothing. Without it, sounds that started before the second
   * sought stay silent.
   */
  triggerEventAt?: (event: BeMusicEvent, offsetSeconds: number) => void;
  /**
   * The play seeks to chart second `seconds`: the sounds playing now stop and the gains go back to the chart's start
   * (the engine then replays the volume changes before `seconds` and starts what still rings there through
   * {@link triggerEventAt}); a backend that schedules on the chart's time (fades, stage rates) moves it to `seconds`.
   * The play clock carries on: chart time re-bases in the engine. Without it, sounds playing at the seek ring on.
   */
  seek?: (seconds: number) => void;
  stopChannel?: (channel: string) => void;
  /**
   * The play tempo changed during the play (see {@link PlayerOptions.onTempoChange}): samples started from now on, and
   * the ones still playing, follow the new tempo as far as the backend can. The engine's clock re-anchors itself, so a
   * backend without it keeps playing at the tempo it started with.
   */
  setTempo?: (tempo: number) => void;
}

/**
 * Context handed to a {@link PlayerOptions.createAudioSession} factory. The resolved chart is shared with the engine
 * so adapters use the same timing, sample slices and chart facts.
 */
export interface CreateAudioSessionContext {
  json: BeMusicJSON;
  resolvedChart: ResolvedChart;
  options: PlayerOptions;
  mode: 'auto' | 'manual';
  onLoadProgress?: (progress: AudioSessionLoadProgress) => void;
}

export interface RandomPatternSelection {
  index: number;
  current: number;
  total: number;
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

/** A chart resolved for one play, with the `#RANDOM` / `#SWITCH` draws it was resolved with. */
export interface ResolvedPlayChart {
  /** The chart with the drawn branches applied; it carries no control flow. */
  chart: BeMusicJSON;
  /** The draws `chart` was resolved with: hand them to the engine (`PlayerOptions.randomDraws`) and the replay. */
  randomDraws: RandomDraws;
}

export interface ResolvePlayChartOptions {
  /** Random source for the draws, in `[0, 1)`. Defaults to `Math.random`. */
  random?: () => number;
  /** Draws to resolve with instead of drawing, e.g. the ones a replay recorded. */
  randomDraws?: RandomDraws;
}
