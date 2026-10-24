/**
 * The engine side of a play on the built-in and LR2 play screens (`PlaySession`): launches the shared engine
 * (`runEngineDriver`) on the prepared chart, drains its UI signals each frame into the score, gauge, judgement, combo
 * and lane-effect state the scene draws (key beams, bombs, POOR BGA, long-note holds), and starts the ending once
 * the chart settles. ESC / F5 / a teardown interrupt the engine here.
 *
 * The functions read and write the scene's state through {@link PlayEngineContext}; the play session passes itself.
 */

import type { RandomDraws, TimingResolver, ChartPlayVariant } from '@be-music/chart-model';
import type { BeMusicEvent, BeMusicJSON } from '@be-music/chart-source';
import {
  PlayerInterruptedError,
  type PlayerRulesetInfo,
  type PlayerSummary,
  type PreparedPlaybackChartData,
} from '@be-music/player-engine';
import { resolveLR2LaneIndex } from '@be-music/player-engine/lanes';
import type {
  PlayerInputSignalBus,
  PlayerGaugeSummary,
  PlayerUICommand,
  PlayerUIFramePayload,
  PlayerUISignalBus,
  PlayerJudgeComboSignalState,
  PlayerStateSignals,
} from '@be-music/player-engine/signals';
import type { TimedPlayableNote } from '@be-music/player-engine/display';
import type {
  BeMusicReplay,
  ReplayRecordingOptions,
  ReplayViewState,
  ReplayOptionState,
} from '@be-music/player-engine/replay';
import {
  resolveDisplayedPoor,
  type GaugeType,
  type JudgmentKind,
  type LongNoteStyle,
  type ScoreSummary,
} from '@be-music/player-engine/ruleset';
import {
  playEventFromUICommand,
  ReplayViewCursor,
  type LibraryChart,
  type PlayResult,
} from '@be-music/player-scene-model';
import type { BeMusicJudgeWindows } from '@be-music/player-skin-sdk';
import type { AudioBusHandle } from '../../runtime/audio-bus.ts';
import { runEngineDriver } from '../../runtime/engine-driver.ts';
import type { NonstopStageMixer } from '../../runtime/nonstop-audio.ts';
import { supportsLiveTempoChange, type ReplayTempo } from '../../runtime/play-tempo.ts';
import { drainWebUISignals, type WebUIRuntimeCallbacks } from '../../runtime/web-ui-runtime.ts';
import type { PlaySessionOptions } from './play-options.ts';
import { toBeMusicJudgeWindows } from './judge-windows.ts';
import type { LongNoteTracker } from './long-note-tracker.ts';
import type { LiveTempo } from './live-tempo.ts';
import { logger } from '../../logger.ts';
import { resolveBeMusicLaneKind } from '../../skin/be-music/registry.ts';
import type { BeMusicJudgmentKind } from '../../skin/be-music/types.ts';
import { beginExitSequence, resolvePlayEnding, type PlayEndingContext } from './play-ending.ts';
import type { PlayPresentation } from './play-presentation.ts';
import { resolveSeekWaiters, settleSeekWaiters } from './play-seek.ts';
import { applyPlayEvent } from './play-state.ts';
import { shouldSkipPlayKey } from './play-keys.ts';
import { samplePlaybackRate } from './play-media.ts';
import {
  flushReplayView,
  followTempoChange,
  startReplayView,
  updateReplayView,
  type PlayViewSettingsContext,
} from './play-view-settings.ts';

const log = logger('gameplay');

/** The scene's members the engine side reads and writes: the play session's members of these names. */
export interface PlayEngineContext
  extends PlayViewSettingsContext, PlayEndingContext, Omit<PlayPresentation, 'longNotes' | 'playMoments'> {
  readonly options: Readonly<
    Pick<
      PlaySessionOptions,
      | 'autoPlay'
      | 'allowSeek'
      | 'judgeAlgorithm'
      | 'longNoteModifier'
      | 'autoScratch1P'
      | 'autoScratch2P'
      | 'chartMD5'
      | 'chartSHA256'
      | 'course'
      | 'dpFlip'
      | 'gauge'
      | 'judgeRuleset'
      | 'nonstop'
      | 'onChartFinished'
      | 'onExit'
      | 'onRestart'
      | 'replayRecorder'
      | 'random1P'
      | 'random2P'
      | 'replay'
      | 'tempoPitchMode'
      | 'hsFix'
      | 'classicHiSpeed'
      | 'normalHiSpeedLevel'
      | 'hiSpeedLocked'
      | 'onHiSpeedChange'
      | 'onTempoChange'
      | 'replayView'
      | 'laneCover'
      | 'shutter'
      | 'hiddenSudden1P'
      | 'hiddenSudden2P'
    >
  >;
  readonly chart: LibraryChart | undefined;
  readonly resolvedChart: BeMusicJSON | undefined;
  readonly randomDraws: RandomDraws | undefined;
  readonly preparedChart: PreparedPlaybackChartData | undefined;
  readonly notes: TimedPlayableNote[];
  readonly timingResolver: TimingResolver | undefined;
  readonly chartPlayVariant: ChartPlayVariant;
  readonly audioContext: AudioContext | undefined;
  readonly audioBus: AudioBusHandle | undefined;
  readonly decodedSamples: Map<string, AudioBuffer>;
  readonly wavCmdVolumeMultipliers: Map<string, number>;
  readonly bmsonSlicePlayback:
    | Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>
    | undefined;
  readonly nonstopMixer: NonstopStageMixer | undefined;
  readonly replayTempo: ReplayTempo | undefined;
  readonly liveTempo: LiveTempo;
  sharedEnginePromise: Promise<unknown> | undefined;
  sharedEngineAbortController: AbortController | undefined;
  chartEndHold: AbortController | undefined;
  onHeldPlayEnded: ((summary: Readonly<PlayerSummary>) => void) | undefined;
  sharedEngineLastJudgeComboTick: number;
  sharedEngineSignals: { uiSignals: PlayerUISignalBus; stateSignals?: PlayerStateSignals } | undefined;
  sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  sharedEngineInterrupt: 'escape' | 'restart' | undefined;
  sharedEngineChartSettled: boolean;
  engineFrame: Readonly<PlayerUIFramePayload> | undefined;
  seekGeneration: number;
  practice: boolean;
  engineStartRequested: boolean;
  readonly paused: boolean;
  readonly seekWaiters: Array<{ seconds: number; resolve: () => void }>;
  bgaActiveVideos: { base?: { key: string; cueSeconds: number }; layer?: { key: string; cueSeconds: number } };
  chartEnded: boolean;
  chartEndTimeout: number | undefined;
  chartEndGate?: (seconds: number) => void;
  replay: BeMusicReplay | undefined;
  readonly replayWaiters: Array<(replay: BeMusicReplay) => void>;
  replayViewCursor: ReplayViewCursor | undefined;
  score: ScoreSummary;
  gaugeState: PlayerGaugeSummary;
  fastCount: number;
  slowCount: number;
  judgeWindows: BeMusicJudgeWindows | undefined;
  longNoteStyle: LongNoteStyle | undefined;
  readonly longNotes: LongNoteTracker;
  readonly playMoments: PlayPresentation['playMoments'];
  pauseAllBGAVideos(): void;
  resolveSelectedGauge(): GaugeType;
  getResultData(): PlayResult | undefined;
}

/**
 * "Fully on" hold time before {@link flashKeyBeam} hands the lane laser to the release-fade path.
 * Without this hold the sprite would only stay at peak alpha for the first frame (≈16 ms at 60 fps) before the fade
 * tween kicked in, which made auto-judged short-note flashes look like a single-frame blink. ~60 ms is enough to
 * register visually as a deliberate "tap" without lingering through the next note.
 */
const KEY_ON_FLASH_HOLD_MS = 60;

/**
 * Hands the play over to the host once ({@link sharedEngineInterrupt}): a play still being judged is interrupted, so
 * the engine stops (and, for ESC, records the play as given up); a play whose chart already settled is complete, so
 * its hold is let go and it ends with its replay as usual. A no-op before the engine is running.
 */
export function interruptSharedEngine(ctx: PlayEngineContext, reason: 'escape' | 'restart'): void {
  if (ctx.sharedEngineInterrupt !== undefined) return;
  const signals = ctx.sharedEngineInputSignals;
  if (signals === undefined) return;
  ctx.sharedEngineInterrupt = reason;
  flushReplayView(ctx);
  if (ctx.sharedEngineChartSettled) {
    ctx.chartEndHold?.abort();
    return;
  }
  signals.pushCommand({ kind: 'interrupt', reason });
}

/**
 * Turns `channel`'s key beam on (`keyBeamStartedAt`, by channel; a view maps the channel onto its own timers, the LR2
 * view onto LR2's key-on bank).
 */
function startKeyBeam(ctx: PlayEngineContext, channel: string): void {
  const now = ctx.playClock();
  ctx.lanePressedAt.set(channel, now);
  ctx.keyBeamStartedAt.set(channel, now);
  // A fresh press cancels any in-flight release fade on the same lane; the laser is fully on again from this instant.
  ctx.keyBeamFadeStartedAt.delete(channel);
}

/**
 * Smoothly extinguishes the lane laser when a key (or auto LN head) releases: the lane's key beam stays on for the
 * view's key-beam fade (`PlaySessionTheme.keyOnFadeMs`) while a render-time alpha taper drives the visible amplitude
 * down to 0, then its entry is deleted. Anchored on `playClock` so the fade pauses cleanly with the rest of the scene.
 *
 * The taper is what makes manual key-ups, auto-judged short notes (via {@link flashKeyBeam}), and auto-LN releases
 * all decay at the same speed without restarting the key-on keyframe (which would blink the LR2 default skin's lane
 * laser back to its fade-in origin before the decay).
 */
function releaseKeyBeam(ctx: PlayEngineContext, channel: string): void {
  ctx.laneReleasedAt.set(channel, ctx.playClock());
  // Stamp the fade origin unconditionally — the render-side cleanup uses it as the authoritative clock for the
  // 1 → 0 alpha taper, and an early return on a missing `keyBeamStartedAt` entry would leave the LN-end path stuck at
  // full brightness whenever the deferred startKeyBeam / releaseKeyBeam interleaving had already retired the beam (a
  // racy setTimeout cleanup from a previous press could have wiped it between the LN's startKeyBeam and this
  // release). The `keyBeamStartedAt.has` gate controls only the deferred cleanup below — the fade start is committed
  // regardless so the render side (lane beam / skin key-on sprites) can taper any still-visible laser through to
  // alpha=0.
  ctx.keyBeamFadeStartedAt.set(channel, ctx.playClock());
  if (!ctx.keyBeamStartedAt.has(channel)) return;
  const fadeMs = ctx.theme.keyOnFadeMs(channel);
  const timeout = window.setTimeout(() => {
    ctx.keyFlashTimeouts.delete(timeout);
    if (ctx.disposed) return;
    // If the player (or autoplay) re-pressed the same lane during the fade window, leave the beam on and skip the
    // delete — the new press has its own lifecycle.
    if (!ctx.pressedChannels.has(channel)) {
      ctx.keyBeamStartedAt.delete(channel);
    }
    ctx.keyBeamFadeStartedAt.delete(channel);
  }, fadeMs);
  ctx.keyFlashTimeouts.add(timeout);
}

/**
 * Starts a bomb (hit explosion) on `channel`. The core scene draws it from `bombStartedAt`; themes react through the
 * `bomb` event (the LR2 family stamps its per-lane bomb timer at the same instant).
 */
function triggerBomb(ctx: PlayEngineContext, channel: string, judge?: BeMusicJudgmentKind): void {
  const now = ctx.playClock();
  ctx.bombStartedAt.set(channel, now);
  if (judge) ctx.bombJudge.set(channel, judge);
  else ctx.bombJudge.delete(channel);
  ctx.theme.moment({ kind: 'bomb', channel, at: now });
}

/**
 * Auto-play loop: when enabled, every playable note is judged as PERFECT exactly at its scheduled time. Background
 * lane sounds (`scheduleAutoSamples`) still handle non-input channels separately.
 *
 * Long notes are NOT judged on the head; instead the head time marks the LN as actively held (sample + bomb +
 * sustained key beam for the visual lane laser) and the actual scoreboard / gauge / combo commit is deferred to
 * {@link autoFinalizeLongNotes} when chart-time crosses `endSeconds`. This mirrors what real LR2 does (and what
 * `@be-music/player-engine`'s engine does via `pendingAutoLongNotes`): one judgement event per LN, fired at the tail timing
 * so the combo pulse aligns with the LN visually completing rather than at its start.
 */
/**
 * Brief key-on flash. We turn the lane's key beam on and schedule it to clear after a short interval so the laser
 * fades like a real keystroke. Used by autoplay (no real keyboard event) so the player still sees the lane / key
 * visuals react.
 *
 * Auto-judged short notes simulate a "press + release" in one tick: the lane laser lights up immediately (stamped at
 * `playClock()`, so the LR2 key-on keyframe begins) and stays at peak alpha for {@link KEY_ON_FLASH_HOLD_MS} before
 * handing off to the release-fade path. Without that brief hold the sprite would taper from full to invisible across
 * the first 1–2 render frames and the press would read as a single-frame blink rather than a deliberate flash.
 */
function flashKeyBeam(ctx: PlayEngineContext, channel: string): void {
  startKeyBeam(ctx, channel);
  const timeout = window.setTimeout(() => {
    ctx.keyFlashTimeouts.delete(timeout);
    if (ctx.disposed) return;
    // A real press took over during the hold — skip the auto-release, the press lifecycle is in charge. (LN
    // sustains drive their own `hold-lane-until-beat` timer keep-alive via `applyEngineCommand`.)
    if (ctx.pressedChannels.has(channel)) {
      return;
    }
    releaseKeyBeam(ctx, channel);
  }, KEY_ON_FLASH_HOLD_MS);
  ctx.keyFlashTimeouts.add(timeout);
}

function publishJudge(
  ctx: PlayEngineContext,
  judge: JudgmentKind,
  seconds: number,
  state: Readonly<Pick<PlayerJudgeComboSignalState, 'channel' | 'deltaMs' | 'combo'>>,
): void {
  const until = seconds + 0.6;
  const channel = state.channel;
  ctx.lastJudge = judge;
  ctx.lastJudgeUntil = until;
  ctx.lastJudgeAt = ctx.playClock();
  // Themes restart their per-side judge animation on every judgement (LR2 timer 46 / 47 drives the attached
  // `#DST_NOWJUDGE` / `#DST_NOWCOMBO` chains from time=0 per hit). When `channel` isn't supplied (legacy callers) we
  // default to the 1P side. PMS / 9 KEY is single-side so every judgement collapses onto 1P regardless of the
  // sourcing channel — the LR2 9-key skin authors only the 1P judge plate (channels 22..25 belong to the central /
  // right half of the Pop'n nine-lane bank, not the second player).
  const isPlayer2 = ctx.chartPlayVariant !== '9' && typeof channel === 'string' && channel.startsWith('2');
  const side: '1P' | '2P' = isPlayer2 ? '2P' : '1P';
  // The judgment goes with the moment, so a view keeps each lane's and each plate's own (a beatoraja skin's).
  ctx.theme.moment({
    kind: 'judge',
    side,
    at: ctx.playClock(),
    judge,
    ...(channel !== undefined ? { channel } : {}),
    ...(typeof state.deltaMs === 'number' && Number.isFinite(state.deltaMs) ? { deltaMs: state.deltaMs } : {}),
    combo: state.combo,
  });
  // Snapshot the verdict + combo for this side so DP rendering shows each lane group's *own* combo number — frozen at
  // the moment that side last hit a note — rather than mirroring the global running combo on both sides.
  // A course stage also snapshots the course combo, which an LR2 skin shows there during an expert or grade course.
  const { combo, courseCombo } = ctx.playState;
  ctx.judgeSideState[side] = {
    judge,
    until,
    combo,
    ...(courseCombo !== undefined ? { courseCombo: courseCombo.combo } : {}),
  };
  // POOR / BAD judgements briefly swap the base BGA for the chart's POOR BGA. We trigger the same window for `BAD`
  // because the LR2 spec doesn't distinguish the two for the BGA channel.
  if (judge === 'POOR' || judge === 'BAD') {
    ctx.lastPoorAt = ctx.playClock();
  }
  maybeFireFullCombo(ctx);
}

/**
 * Raises the `full-combo` theme event (LR2 timers 48 = 1P, 49 = 2P) the moment the player's running combo equals the
 * chart's playable note count — i.e. every note has been hit GREAT-or-better and the chain never broke. Latches
 * `fullComboFired` so subsequent judges don't re-raise it (which would replay the skin's FC slide-in animation from
 * time=0).
 *
 * AUTO mode also reaches this state on the very last note (every judge is auto-PERFECT, so combo === total at the
 * end) — the player specifically asked for the FC presentation to fire in AUTO too, which falls out for free since
 * the path is the same `publishJudge` chain manual play uses.
 *
 * One event covers both sides because we don't yet model per-side combos. For DP this is correct (one player, one
 * combo). Battle mode would split.
 */
function maybeFireFullCombo(ctx: PlayEngineContext): void {
  if (ctx.fullComboFired) return;
  if (ctx.score.bad > 0 || ctx.score.poor > 0) return;
  if (ctx.score.total <= 0) return;
  if (ctx.playState.combo < ctx.score.total) return;
  ctx.fullComboFired = true;
  ctx.theme.moment({ kind: 'full-combo', at: ctx.playClock() });
  log.info('FULL COMBO');
}

/** Records the latest key press / autoplay hit for input-reactive skin visuals. */
function noteImpulse(ctx: PlayEngineContext, channel: string): void {
  ctx.lastImpulseAt = ctx.playClock();
  ctx.lastImpulseKind = resolveBeMusicLaneKind(
    channel,
    resolveLR2LaneIndex(channel, ctx.chartPlayVariant),
    ctx.chartPlayVariant,
  );
}

/**
 * Kicks off the shared-engine playback loop in the background. Called from the play-start gate inside
 * {@link start}. The returned promise is captured on `this.sharedEnginePromise` so a defensive re-entry
 * doesn't spawn a second engine; we don't `await` it because the chart can run for several minutes and
 * `start()` must return synchronously to the host's setVisible chain.
 *
 * Catches {@link PlayerInterruptedError} so the engine's `interrupt(escape)` / `interrupt(restart)` commands
 * route to the host's `onExit` / `onRestart` callbacks the same way the legacy DOM keyhandler did.
 */
/**
 * The chart the engine plays in shared-engine mode: the one `prepareChart` resolved. Since the renderer hands the
 * engine its own `PreparedPlaybackChartData` instance (which already encodes shuffle / DP-flip), the chart events
 * here only feed engine-internal helpers (timing resolver, BGM / BGA / dynamic-volume realtime audio scheduling),
 * none of which care about the shuffled lane channels. The resolved chart carries no control flow, so the engine
 * plays it as is; {@link randomDraws} travel with it for the RANDOM summary.
 */
function buildSharedEngineChart(ctx: PlayEngineContext): BeMusicJSON {
  return ctx.resolvedChart ?? ctx.chart!.chart;
}

/**
 * What a recorded play's log says of its settings and chart, for every family: the gauge, the file hashes and the
 * recorder the host gave, the lane options and DP FLIP it played with, the view at the start, and the chart path in
 * `native` so a dropped log can be matched back to its song. The engine plays the chart the session resolved (and
 * flipped); the song's chart is the source both fingerprints describe (`#RANDOM` unresolved, no lane option applied).
 */
export function resolveReplayRecording(
  options: Pick<
    PlaySessionOptions,
    | 'gauge'
    | 'chartSHA256'
    | 'chartMD5'
    | 'replayRecorder'
    | 'random1P'
    | 'random2P'
    | 'dpFlip'
    | 'recordingOptionState'
    | 'autoPlay'
    | 'initialHiSpeed'
    | 'hsFix'
    | 'classicHiSpeed'
    | 'normalHiSpeedLevel'
    | 'judgeTimingMs'
    | 'visualConstant'
    | 'lift1P'
    | 'lift2P'
    | 'liftOn1P'
    | 'liftOn2P'
    | 'noteDurationMs'
    | 'constantFadeMs'
    | 'bpmGuide'
    | 'hiddenSudden1P'
    | 'hiddenSudden2P'
    | 'shutter'
    | 'laneCover'
    | 'judgeAlgorithm'
    | 'longNoteModifier'
    | 'autoScratch1P'
    | 'autoScratch2P'
  >,
  chartEntry: Pick<LibraryChart, 'chart' | 'chartPath'> | undefined,
  view: ReplayViewState,
  effectivePlayerHiSpeed?: number,
): ReplayRecordingOptions {
  if (options.random1P === 'SCATTER' || options.random2P === 'SCATTER') {
    throw new RangeError('SCATTER is disabled until placement and assist policy are implemented.');
  }
  const effectiveOptions: ReplayOptionState = {};
  for (const [key, value] of Object.entries({
    autoPlay: options.autoPlay,
    hiSpeed: effectivePlayerHiSpeed ?? options.initialHiSpeed,
    hsFix: options.classicHiSpeed || (options.normalHiSpeedLevel ?? 0) > 0 ? 'OFF' : options.hsFix,
    classicHiSpeed: options.classicHiSpeed,
    normalHiSpeedLevel: options.classicHiSpeed ? 0 : options.normalHiSpeedLevel,
    ...(!options.classicHiSpeed && (options.normalHiSpeedLevel ?? 0) > 0
      ? { normalHiSpeedProfile: 'AC32-measured' }
      : {}),
    bpmGuide: options.bpmGuide,
    judgeTimingMs: options.judgeTimingMs,
    visualConstant: options.visualConstant,
    noteDurationMs: options.noteDurationMs,
    lift1P: options.lift1P,
    lift2P: options.lift2P,
    liftOn1P: options.liftOn1P,
    liftOn2P: options.liftOn2P,

    constantFadeMs: options.constantFadeMs,
    hiddenSudden1P: options.hiddenSudden1P,
    hiddenSudden2P: options.hiddenSudden2P,
    shutter: options.shutter,
    laneCover: options.laneCover,
    gauge1P: options.gauge,
    random1P: options.random1P,
    random2P: options.random2P,
    dpFlip: options.dpFlip,
    judgeAlgorithm: options.judgeAlgorithm,
    longNoteModifier: options.longNoteModifier,
    autoScratch1P: options.autoScratch1P,
    autoScratch2P: options.autoScratch2P,
  })) {
    if (value !== undefined) effectiveOptions[key] = value;
  }
  return {
    gauge: options.gauge,
    options: { ...options.recordingOptionState, ...effectiveOptions },
    ...(options.chartSHA256 !== undefined ? { chartSHA256: options.chartSHA256 } : {}),
    ...(options.chartMD5 !== undefined ? { chartMD5: options.chartMD5 } : {}),
    ...(options.replayRecorder !== undefined ? { recorder: options.replayRecorder } : {}),
    ...(chartEntry !== undefined ? { sourceChart: chartEntry.chart } : {}),
    ...(options.random1P !== undefined || options.random2P !== undefined
      ? {
          randomLane: {
            ...(options.random1P !== undefined ? { p1: options.random1P } : {}),
            ...(options.random2P !== undefined ? { p2: options.random2P } : {}),
          },
        }
      : {}),
    ...(options.dpFlip !== undefined ? { dpFlip: options.dpFlip } : {}),
    view,
    ...(chartEntry?.chartPath !== undefined ? { native: { chartPath: chartEntry.chartPath } } : {}),
  };
}

export function launchSharedEngine(ctx: PlayEngineContext): void {
  if (ctx.disposed || ctx.sharedEnginePromise) return;
  if (!ctx.chart || !ctx.audioContext || !ctx.audioBus) return;
  // Build the chart the engine sees from the view's already-shuffled notes / mines / invisibles. The view's
  // `applyRandomMode` mutates `runtimeNote.channel` (NOT `event.channel`), so without this remap the engine
  // would extract notes from `chart.events` with their ORIGINAL pre-shuffle channels — its judge would target
  // a different lane than the visual the player is reading, so RANDOM / MIRROR / S-RANDOM / SCATTER would
  // make the chart unplayable. Rebuilding `events` with the post-shuffle channel keeps the engine and the
  // renderer on the same shuffle.
  const chart = buildSharedEngineChart(ctx);
  const callbacks: WebUIRuntimeCallbacks = {
    onFrame: (frame) => applyEngineFrame(ctx, frame),
    onCommand: (command) => applyEngineCommand(ctx, command),
    onJudgeCombo: (state) => applyEngineJudgeCombo(ctx, state),
    onSignalsReady: (signals) => {
      ctx.sharedEngineSignals = signals;
    },
  };
  ctx.engineFrame = undefined;
  // A replay shows its recorded view along the playhead; a recorded replays its own from the start.
  ctx.replayViewCoalescer = undefined;
  ctx.replayViewCursor =
    ctx.options.replay !== undefined
      ? new ReplayViewCursor(ctx.options.replay.play.view, ctx.options.replay.play.viewChanges)
      : undefined;
  ctx.sharedEnginePromise = runEngineDriver({
    chart,
    audio: {
      audioContext: ctx.audioContext,
      audioBus: ctx.audioBus,
      decodedSamples: ctx.decodedSamples,
      wavCmdVolumeMultipliers: ctx.wavCmdVolumeMultipliers,
      bmsonSlicePlayback: ctx.bmsonSlicePlayback,
      // The engine plays through its own session: a stitched NONSTOP chart's stage rates (FIT) and fades go with it.
      ...(ctx.nonstopMixer !== undefined ? { stageMixer: ctx.nonstopMixer } : {}),
      playbackRate: samplePlaybackRate(ctx),
      playbackRateFollowsTempo: supportsLiveTempoChange(ctx.options.tempoPitchMode ?? 'pitch'),
      tempo: ctx.tempo,
    },
    mode: ctx.options.autoPlay ? 'auto' : 'manual',
    ui: callbacks,
    onInputSignalsReady: (signals) => {
      ctx.sharedEngineInputSignals = signals.inputSignals;
      ctx.sharedEngineInterrupt = undefined;
      ctx.sharedEngineChartSettled = false;
      // A tempo asked for while the engine was starting.
      ctx.liveTempo.attach(signals.inputSignals);
      if (ctx.paused) signals.inputSignals.pushCommand({ kind: 'toggle-pause' });
      if (ctx.engineStartRequested) signals.inputSignals.pushCommand({ kind: 'start' });
    },
    // Listen on the window (default) so the runtime sees keyboard events regardless of which DOM element
    // currently holds focus — matches the legacy `window.addEventListener('keydown', ...)` behaviour. The
    // canvas's `tabIndex = 0` only makes it focusable, not auto-focused, so a canvas-scoped listener would
    // only fire after the user clicked the canvas first.
    shouldSkipKey: shouldSkipPlayKey,
    engineOptions: {
      // The draws `resolvedChart` was resolved with; the engine plays that chart as is and names them in its summary.
      ...(ctx.randomDraws !== undefined ? { randomDraws: ctx.randomDraws } : {}),
      // Prepare during the skin intro; chart time and audio wait for its PLAY START command.
      leadInMs: 0,
      waitForStart: true,
      // The play tempo: the engine's clock runs `tempo` times as fast and judges in chart time. A change during the
      // play comes back through `onTempoChange`, at the chart second the engine took it.
      speed: ctx.tempo,
      onTempoChange: (change) => followTempoChange(ctx, change),
      // Only the selected side's scratch lanes are assisted by the engine.
      autoScratch: ctx.options.autoScratch1P === true || ctx.options.autoScratch2P === true,
      judgeAlgorithm: ctx.options.replay?.play.judgeAlgorithm ?? ctx.options.judgeAlgorithm,
      longNoteModifier: ctx.options.replay?.play.longNoteModifier ?? ctx.options.longNoteModifier,
      autoScratch1P: ctx.options.autoScratch1P === true,
      autoScratch2P: ctx.options.autoScratch2P === true,
      // Hand the engine the same `PreparedPlaybackChartData` instance the renderer is already pointing at
      // (`this.notes` / `this.mineNotes` / `this.invisibleNotes` are references into this bundle). The
      // engine's `autoPlay` / `manualPlay` use it verbatim instead of running their own
      // `preparePlaybackChartData` pass, so the renderer's parallel arrays and the engine's playable note
      // arrays are guaranteed to be the same instances — no `inferBmsLNTypeWhenMissing` flag to keep in
      // sync, no `laneModeExtension` to forward separately (the bundle already encodes the lane bindings
      // computed under the right extension), no `bms.controlFlow` re-resolve to deduplicate, no
      // `random1P: 'OFF'` truthy-check to fix. Every "view extracted differently than engine" bug is
      // structurally impossible because there is only one extract.
      preparedChart: ctx.preparedChart,
      // The gauge is part of the judging setup, not just a skin colour: the engine resolves it against the active
      // ruleset's gauge line-up and runs its curve, so HARD really drains and DEATH really ends the run.
      // `resolveSelectedGauge` prefers the replay's recorded pick, so a played-back log runs its original gauge.
      gauge: ctx.resolveSelectedGauge(),
      ...(ctx.options.replay === undefined && ctx.options.course !== undefined ? { course: ctx.options.course } : {}),
      // A stitched NONSTOP chart's later stages take over the judge rank (a replay restores the recorded changes).
      ...(ctx.options.replay === undefined && ctx.options.nonstop !== undefined
        ? { stageRanks: ctx.options.nonstop.stageRanks }
        : {}),
      ...(ctx.options.replay?.chart.judgeRank.stageRanks !== undefined
        ? {
            stageRanks: ctx.options.replay.chart.judgeRank.stageRanks.map((change) => ({
              ...change,
              seconds: change.timeUs / 1_000_000,
            })),
          }
        : {}),
      // The engine reports the ruleset after applying the judge ruleset, the debug window override, and (for a
      // replay) the recorded settings below, so the windows skins see are the ones the run is judged with.
      onRulesetResolved: (info) => applyResolvedRuleset(ctx, info),
      signal: (ctx.sharedEngineAbortController = new AbortController()).signal,
      // Keys stay live after the last note until the fade-out is over; the outro starts when the chart settles.
      holdAfterChart: {
        signal: (ctx.chartEndHold = new AbortController()).signal,
        onSettled: () => {
          ctx.sharedEngineChartSettled = true;
          drainSharedEngineSignals(ctx);
          handleSharedEngineChartFinished(ctx, undefined, true);
        },
      },
      ...(ctx.options.replay !== undefined
        ? {
            // Replay playback — feed the recorded input stream; the engine ignores live lane input, and the run
            // records no new replay (replaying a replay would only duplicate the file). Auto scratch, the
            // judge ruleset, the debug judge-window override, the end-on-failure flag and the course stage are
            // restored from the log so the judging setup matches the recording.
            replayInputs: ctx.options.replay.inputs,
            // The tempo changes of the play, followed as the replay reaches them (`resolveReplayTempo`).
            ...(ctx.replayTempo !== undefined && ctx.replayTempo.changes.length > 0
              ? { replayTempoChanges: ctx.replayTempo.changes }
              : {}),
            // A play given up with ESC replays up to where it was given up, as its re-simulations do.
            ...(ctx.options.replay.play.aborted === true && ctx.options.replay.play.abortedAtUs !== undefined
              ? { replayAbortedAtUs: ctx.options.replay.play.abortedAtUs }
              : {}),
            autoScratch: ctx.options.replay.play.autoScratch,
            autoScratch1P: ctx.options.replay.play.autoScratch1P,
            autoScratch2P: ctx.options.replay.play.autoScratch2P,
            judgeRuleset: ctx.options.replay.play.judgeRuleset ?? 'lr2',
            // Logs from before plays ended on failure kept judging to the end; replay them that way.
            endOnFailure: ctx.options.replay.play.endOnFailure === true,
            ...(ctx.options.replay.play.course !== undefined ? { course: ctx.options.replay.play.course } : {}),
            ...(ctx.options.replay.play.judgeWindowOverrideMs !== undefined
              ? { judgeWindowMs: ctx.options.replay.play.judgeWindowOverrideMs }
              : {}),
          }
        : {
            ...(ctx.options.judgeRuleset !== undefined ? { judgeRuleset: ctx.options.judgeRuleset } : {}),
            // Replay recording: the engine snapshots the resolved (post-shuffle) chart and the raw input
            // replay, then hands the assembled log here right before the play promise settles. The host reads it
            // back through `getResultData().replay` for the result screen's auto-save.
            // What the player sees at the start; the changes during the play go in as `view` commands. A play that
            // seeks records none: the engine discards its recorder at the first seek.
            recordReplay: resolveReplayRecording(
              ctx.options,
              ctx.chart,
              startReplayView(ctx),
              ctx.playState.view.hiSpeed.player,
            ),
            onReplayRecorded: ctx.practice
              ? undefined
              : (replay: BeMusicReplay) => {
                  ctx.replay = replay;
                  const waiters = ctx.replayWaiters.splice(0);
                  for (const resolve of waiters) resolve(replay);
                },
          }),
    },
  })
    .then((summary) => {
      log.info('shared engine driver finished');
      drainSharedEngineSignals(ctx);
      settleSeekWaiters(ctx);
      applyFinalSummary(ctx, summary);
      // A play the view interrupted (ESC / F5 / teardown) has already handed the host over; it does not finish.
      if (ctx.sharedEngineInterrupt !== undefined) return;
      // A held play ends when its outro lets go; one that ended on its own (a failed gauge, a replay stopping where its
      // log was given up) starts it now.
      const waiting = ctx.onHeldPlayEnded;
      if (waiting !== undefined) {
        ctx.onHeldPlayEnded = undefined;
        waiting(summary);
        return;
      }
      handleSharedEngineChartFinished(ctx, summary);
    })
    .catch((error: unknown) => {
      settleSeekWaiters(ctx);
      // The view's own ESC / F5 handler (`handleSharedEngineExitKey`) drives the LR2 fadeout animation, calls
      // the host's `onExit` / `onRestart` from the fade-completion callback, and then aborts the engine's
      // signal — which is what produced this rejection. The view is already disposing (or about to), so the
      // catch handler short-circuits to avoid double-firing the host transition. Same logic for any rejection
      // landing after `dispose` has flipped `disposed` (e.g. parent component teardown without ESC).
      if (ctx.disposed) return;
      if (ctx.sharedEngineAbortController?.signal.aborted) return;
      if (error instanceof PlayerInterruptedError) {
        if (error.reason === 'escape') {
          beginExitSequence(ctx, () => ctx.options.onExit?.());
        } else if (error.reason === 'restart') {
          ctx.options.onRestart?.();
        }
        return;
      }
      log.warn('shared engine driver threw', error);
    });
}

/**
 * Pulls the latest frame snapshot + queued commands + judge-combo state from the engine's signal buses. Called
 * from {@link tick} when shared-engine mode is on; the per-call callbacks were registered at engine launch.
 */
export function drainSharedEngineSignals(ctx: PlayEngineContext): void {
  if (!ctx.sharedEngineSignals) return;
  const result = drainWebUISignals(
    ctx.sharedEngineSignals.uiSignals,
    {
      onFrame: (frame) => applyEngineFrame(ctx, frame),
      onCommand: (command) => applyEngineCommand(ctx, command),
      onJudgeCombo: (state) => applyEngineJudgeCombo(ctx, state),
    },
    {
      stateSignals: ctx.sharedEngineSignals.stateSignals,
      lastJudgeComboTick: ctx.sharedEngineLastJudgeComboTick,
    },
  );
  ctx.sharedEngineLastJudgeComboTick = result.lastJudgeComboTick;
}

/**
 * Mirrors the engine's per-frame snapshot into the view's score / gauge / fast-slow fields so the LR2 NUMBER
 * elements + score-graph keep rendering from the existing source paths — they don't need to know the engine
 * replaced the in-tree judge ladder. The summary's optional `gauge` payload populates `this.gaugeState` so the
 * skin's `#DST_GAUGE` chrome animates against the same value the engine considers authoritative. The frame is also
 * what the chart's clock runs on from (`PlaySession.currentSeconds`); one of a seek generation older than the last
 * `seek` command is stale and dropped.
 */
function applyEngineFrame(ctx: PlayEngineContext, frame: Readonly<PlayerUIFramePayload>): void {
  if ((frame.generation ?? 0) < ctx.seekGeneration) return;
  // The signal bus reuses its frame object. Keep the applied clock metadata owned by this
  // session, so publishing a seek cannot move time before its score snapshot is drained.
  ctx.engineFrame = { ...frame };
  applyEngineSummary(ctx, frame.summary);
  ctx.chartEndGate?.(frame.currentSeconds);
}

function applyEngineSummary(ctx: PlayEngineContext, summary: Readonly<PlayerSummary>): void {
  // `summary.total` is the engine's authoritative scorable-note count (`scorableNotes.length`, which excludes
  // Free-Zone channels). The view's own initial `score.total` is computed independently in `prepareChart` from
  // `notes.filter(isPlayableInputChannel).length`, which DOES include Free-Zone — so on charts that use
  // channel `17` / `27` as Free-Zone the two diverge by the Free-Zone count. That mismatch makes
  // `maybeFireFullCombo`'s `combo === score.total` predicate unreachable (combo can only ever climb to
  // the engine's smaller scorable count) and the FC presentation never fires. Sync `score.total` to the
  // engine's value here so the view always agrees with the authority on the scorable population.
  ctx.score.total = summary.total;
  if (summary.fullCombo !== undefined) ctx.score.fullCombo = summary.fullCombo;
  else delete ctx.score.fullCombo;
  ctx.score.perfect = summary.perfect;
  ctx.score.great = summary.great;
  ctx.score.good = summary.good;
  ctx.score.bad = summary.bad;
  ctx.score.emptyPoor = summary.emptyPoor;
  if (summary.minePoor !== undefined) ctx.score.minePoor = summary.minePoor;
  else delete ctx.score.minePoor;
  // `this.score` is the DISPLAY copy: under LR2 the POOR counter folds empty POORs in, matching the real thing
  // (OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for the empty-POOR branch, and LR2 exposes no
  // separate stat). Every LR2 read-out — the POOR row, BP, the per-judge rates, the skin's num 84 / 89 / 114 —
  // goes through this object, so folding here keeps them all consistent. `summary.poor` itself stays split, and the
  // result carries it beside the folded count (`judgedPoor`, `getResultData`) for a record's BP.
  ctx.score.poor = resolveDisplayedPoor(summary, ctx.resolveEmptyPoorCountsInPoorDisplay());
  ctx.score.exScore = summary.exScore;
  ctx.score.score = summary.score;
  ctx.fastCount = summary.fast;
  ctx.slowCount = summary.slow;
  // The play state's gauge and EX score, the graphs' next samples. The graphs run over the scene's own chart length.
  applyPlayEvent(ctx, { type: 'frame', frame: { totalSeconds: ctx.resolveChartDurationSeconds(), summary } });
  if (summary.gauge) {
    const previous = ctx.gaugeState.current;
    ctx.gaugeState = { ...summary.gauge };
    // Gauge-rise / gauge-max theme feedback (LR2 timers 42 / 44). Mirrors what the legacy `applyGaugeDelta` did —
    // raise on every transition so authored skin elements (rise sparkle, max-glow overlay) animate. We compare against the previous frame's value rather than against an "EMPTY_POOR-
    // sized delta" because the engine drives gauge updates monotonically through `summary.gauge.current`,
    // not through judge deltas.
    const next = summary.gauge.current;
    if (next !== previous) {
      ctx.theme.moment({ kind: 'gauge', previous, next, at: ctx.playClock() });
      // Latch the first rise above the starting value and the first time the gauge tops out.
      const moments = ctx.playMoments;
      if (next > summary.gauge.initial) moments.gaugeRiseAtMs ??= ctx.playClock();
      if (next >= summary.gauge.max) moments.gaugeMaxAtMs ??= ctx.playClock();
    }
    if (summary.gauge.failedMidPlay === true) ctx.playMoments.failedAtMs ??= ctx.playClock();
  }
  // `poor` excludes empty POORs, so this counts judged notes only.
  const judged = summary.perfect + summary.great + summary.good + summary.bad + summary.poor;
  if (summary.total > 0 && judged >= summary.total) ctx.playMoments.allNotesDoneAtMs ??= ctx.playClock();
  // Note: the per-note `judged` flag is no longer synced here. The renderer's `this.notes` /
  // `this.mineNotes` are references into the same `PreparedPlaybackChartData` instance the engine is
  // judging against (handed in via `engineOptions.preparedChart`), so when the engine sets
  // `note.judged = true` the renderer sees it on the next paint with no copy step. The fragile
  // index-based sync this used to perform was the source of the Phase-4c HIDE-on-judge dropout, the
  // mid-chart full-combo cue, and the AUTO PLAY < 200_000 score regressions — every one of them was
  // really "engine extract produced a different array than view extract." With the shared instance
  // there is no second extract.
}

/**
 * The play's final summary, as the engine hands it over: its scores and gauge, and its final judgment counts
 * (`finish`): a full combo makes the max combo every note, for any play, even where the engine published no combo for
 * some of them (an autoplayed chord).
 */
export function applyFinalSummary(ctx: PlayEngineContext, summary: Readonly<PlayerSummary>): void {
  applyEngineSummary(ctx, summary);
  applyPlayEvent(ctx, { type: 'finish', summary });
}

/**
 * Maps an engine UI command to the matching view-side visual effect. The visual-effect helpers
 * (`flashKeyBeam`, `startKeyBeam`, `releaseKeyBeam`, `triggerBomb`) are kept in shared-engine mode because
 * they own the per-lane book-keeping the lane beams animate against — only the judge / sample-trigger code
 * paths above were removed. Every command is then forwarded to the theme as a `lane-command` event (the LR2 family
 * drives its LN-hold timers and turntable from it).
 */
function applyEngineCommand(ctx: PlayEngineContext, command: PlayerUICommand): void {
  if (command.kind === 'seek') {
    applyEngineSeek(ctx, command);
    return;
  }
  switch (command.kind) {
    case 'flash-lane':
      noteImpulse(ctx, command.channel);
      flashKeyBeam(ctx, command.channel);
      break;
    case 'press-lane':
      noteImpulse(ctx, command.channel);
      ctx.pressedChannels.add(command.channel);
      startKeyBeam(ctx, command.channel);
      break;
    case 'release-lane':
      ctx.pressedChannels.delete(command.channel);
      releaseKeyBeam(ctx, command.channel);
      break;
    case 'hold-lane-until-beat':
      // Mark the lane as held for the LN's duration. Without this, a `flash-lane` command that arrives in
      // the same tick (typical for the LN HEAD: autoplay emits BOTH `flash-lane` and `hold-lane-until-beat`
      // on every LN start) schedules a `flashKeyBeam` setTimeout that calls `releaseKeyBeam` after
      // `KEY_ON_FLASH_HOLD_MS` because `pressedChannels.has(channel)` is `false`, and the lane laser fades
      // out ~150 ms into the LN even though the LN body is still scrolling. Adding the channel to
      // `pressedChannels` here makes the auto-release skip path fire the same way it does for a real key
      // press, and the laser stays lit for the full LN sustain. The matching `release-lane` (emitted by
      // `drainPendingAutoLongNotes` / `drainPendingAutoScratchLongNotes` at the LN tail) deletes the
      // channel and lets the lane laser fade out at the tail timing.
      ctx.pressedChannels.add(command.channel);
      startKeyBeam(ctx, command.channel);
      // The engine's hold-until-beat command implicitly says "the LN is firing now"; bomb-flash on the head
      // mirrors the legacy autoJudge behavior so the lane still blinks a positive-feedback explosion at LN
      // start in autoplay.
      triggerBomb(ctx, command.channel);
      break;
    case 'trigger-poor-bga': {
      // Commands carry chart seconds, but the shared miss-image window runs on the pause-aware play clock.
      ctx.lastPoorAt = ctx.playClock();
      // An empty POOR (the engine fires `trigger-poor-bga` for real POOR judgments too, and for empty presses and
      // misses past the window) moves the gauge without a judgment: the play state samples its graphs here. A real
      // POOR that also publishes a judgment gets a second sample at almost the same progress.
      const event = playEventFromUICommand(command);
      if (event !== undefined) applyPlayEvent(ctx, event);
      break;
    }
    case 'clear-poor-bga':
      ctx.lastPoorAt = -Number.POSITIVE_INFINITY;
      break;
    case 'long-note-start':
      ctx.longNotes.start(command.channel, command.beat, command.mode, ctx.playClock());
      break;
    case 'long-note-end':
      ctx.longNotes.end(command.channel, command.outcome);
      break;
  }
  ctx.theme.moment({ kind: 'lane-command', command });
}

/**
 * The engine sought: what the play showed of the old position is void — the lane effects, the held long notes, the
 * plates, the POOR image and the latched moments ({@link PlayPresentation.resetPresentation}), the lead-out and the
 * BGA videos — and the score, the gauge and the play state become the snapshot it rebuilt (the combo, the max combo,
 * the graphs and the timings of the judgments before the second sought included). The long notes held across it come
 * next, as the commands that follow. The view hears of it (`seek` moment), and the seeks waiting on it settle.
 */
function applyEngineSeek(ctx: PlayEngineContext, command: Extract<PlayerUICommand, { kind: 'seek' }>): void {
  const { snapshot, seconds, generation } = command;
  ctx.seekGeneration = generation;
  if (
    (ctx.options.autoPlay !== true && ctx.options.replay === undefined) ||
    ctx.options.course !== undefined ||
    ctx.options.nonstop !== undefined
  )
    ctx.practice = true;
  ctx.resetPresentation();
  // A play sought back out of its lead-out plays on: the engine settles the chart again.
  if (ctx.chartEndTimeout !== undefined) {
    window.clearTimeout(ctx.chartEndTimeout);
    ctx.chartEndTimeout = undefined;
  }
  ctx.chartEndGate = undefined;
  ctx.chartEnded = false;
  ctx.sharedEngineChartSettled = false;
  ctx.onHeldPlayEnded = undefined;
  // The next BGA sync starts each video at the chart time sought.
  ctx.pauseAllBGAVideos();
  ctx.bgaActiveVideos = {};
  applyEngineSummary(ctx, snapshot.summary);
  ctx.displayedScore = ctx.score.score;
  applyPlayEvent(ctx, { type: 'seek', snapshot, seconds, atMs: ctx.playClock(), tempo: ctx.tempo });
  ctx.lastPoorAt = -Number.POSITIVE_INFINITY;
  ctx.theme.moment({
    kind: 'seek',
    seconds,
    gauge: ctx.playState.gauge,
    judgments: snapshot.judgments,
    at: ctx.playClock(),
  });
  updateReplayView(ctx, seconds, true);
  resolveSeekWaiters(ctx, seconds);
}

/** Keeps the engine's long-note style and its judge windows (converted to ms) for the skin runtime. */
function applyResolvedRuleset(ctx: PlayEngineContext, info: PlayerRulesetInfo): void {
  ctx.longNoteStyle = info.longNoteStyle;
  ctx.judgeWindows = toBeMusicJudgeWindows(info.windows);
}

/**
 * Drives every per-judge visual the LR2 skin animates against from the engine's stateSignals judge-combo bus:
 *
 * - The play state takes the judgment (`reducePlayState`): the running combo `#SRC_NUMBER,st=70` (NOWCOMBO) renders,
 *   the max combo and course combo, the timed judgment with its early / late count, and a sample of the graphs.
 * - `publishJudge` does the rest of the legacy per-judge work — it stamps timer 46 (1P) or 47 (2P) so the
 *   `#DST_NOWJUDGE` / `#DST_NOWCOMBO` keyframe chains animate from time=0 on every hit (without this, the
 *   plate stays invisible because the timer's playhead is parked at scene start), latches `lastJudge` /
 *   `lastJudgeUntil` so the fallback `#SRC_TEXT` paints the verdict, snapshots `judgeSideState[side]` for DP
 *   per-side rendering, swaps to the POOR BGA on POOR/BAD, and fires `maybeFireFullCombo` for timers 48/49.
 * - On PERFECT / GREAT we additionally fire the lane bomb (the engine's `flash-lane` command is severity-
 *   independent so we can't piggy-back on it; the bomb is a positive-feedback cue specifically for clean
 *   hits). The legacy `commitFinalJudge` ran the same gate.
 */
function applyEngineJudgeCombo(ctx: PlayEngineContext, state: Readonly<PlayerJudgeComboSignalState>): void {
  if (state.judge === 'READY') return;
  const judgeKind = state.judge as JudgmentKind;
  const seconds = ctx.currentSeconds();
  // Autoplay hits, mine BADs, and missed notes carry no `deltaMs`: the play state keeps no timing for them.
  applyPlayEvent(ctx, { type: 'judge', judge: state, seconds, atMs: ctx.playClock() });
  publishJudge(ctx, judgeKind, seconds, state);
  if ((judgeKind === 'PERFECT' || judgeKind === 'GREAT') && state.channel) {
    triggerBomb(ctx, state.channel, judgeKind);
  }
}

/**
 * Fires when the engine driver's `manualPlay` / `autoPlay` promise resolves cleanly (= chart played to its end
 * without an interrupt). The host's `onChartFinished` callback receives a `PlayResult` snapshot and the theme's exit
 * (its fade-out, or a failed play's stop) runs before the result-screen transition. The engine's resolution is the
 * authoritative end-of-chart signal — the view's `currentSeconds` clock lags slightly behind the engine's
 * own bookkeeping, so we don't gate on it.
 */
/**
 * Starts the outro once the chart is over. `held` means the engine's play is still open (keys still live): the fade-out
 * runs first, then the play is let go and the result waits for its final summary.
 */
function handleSharedEngineChartFinished(
  ctx: PlayEngineContext,
  finalSummary: Readonly<PlayerSummary> | undefined,
  held = false,
): void {
  if (ctx.disposed || ctx.chartEnded) return;
  ctx.chartEnded = true;
  ctx.playMoments.outroAtMs ??= ctx.playClock();
  // The end-of-play policy every gameplay family shares (`resolvePlayEnding`): a lead-out after the last note, then the
  // fade-out, or — for a play cut short by its gauge emptying — a stop at once (`beginExitSequence`).
  const viewTiming = ctx.theme.timing();
  const ending = resolvePlayEnding({
    summary: finalSummary,
    notes: ctx.notes,
    timing: ctx.timingResolver,
    currentSeconds: ctx.currentSeconds(),
    tempo: ctx.tempo,
    musicEndDelayMs: viewTiming.musicEndDelayMs,
    finishMarginMs: viewTiming.finishMarginMs,
    ...(ctx.options.autoPlay ? { chartEndSeconds: ctx.resolveChartDurationSeconds() } : {}),
  });
  // Families without a music-end stage retain the two-measure lead-out. A family with that stage waits on the
  // engine's chart clock, then holds its finish margin on the scene clock before fading.
  const beginFade = () => {
    ctx.chartEndTimeout = undefined;
    if (ctx.disposed || ctx.exiting) return;
    drainSharedEngineSignals(ctx);
    if (finalSummary !== undefined) applyFinalSummary(ctx, finalSummary);
    const finish = (): void => {
      const result = ctx.getResultData();
      if (ctx.options.onChartFinished && result) {
        ctx.options.onChartFinished(result);
        return;
      }
      ctx.options.onExit?.();
    };
    beginExitSequence(
      ctx,
      () => {
        if (!held) {
          finish();
          return;
        }
        // The outro is over: let the held play end, and show the result with its final summary.
        ctx.onHeldPlayEnded = () => {
          if (!ctx.disposed) finish();
        };
        flushReplayView(ctx);
        ctx.chartEndHold?.abort();
      },
      // A normal end lets its last keysounds ring through the fade-out; a failure cuts them.
      { failed: ending.failed, fadeAudio: false },
    );
  };
  if (ending.musicEndAtSeconds !== undefined) {
    const target = ending.musicEndAtSeconds;
    const musicEnd = () => {
      ctx.chartEndGate = undefined;
      if (ctx.disposed || ctx.exiting || !ctx.chartEnded) return;
      ctx.theme.moment({ kind: 'music-end', at: ctx.playClock() });
      ctx.chartEndTimeout = window.setTimeout(beginFade, ending.finishMarginMs ?? 0);
    };
    if (held) {
      // The one engine loop drives this gate: pause, tempo changes and seeks keep their chart-time meaning.
      ctx.chartEndGate = (seconds) => {
        if (seconds >= target) musicEnd();
      };
      ctx.chartEndGate(ctx.currentSeconds());
    } else {
      ctx.chartEndTimeout = window.setTimeout(musicEnd, Math.max(0, ending.leadOutMs - (ending.finishMarginMs ?? 0)));
    }
  } else {
    ctx.chartEndTimeout = window.setTimeout(beginFade, ending.leadOutMs);
  }
}

/** Stops the shared engine as the play is disposed (`PlaySession.dispose`) and lets go of its buses. */
export function stopSharedEngine(ctx: PlayEngineContext): void {
  ctx.chartEndGate = undefined;
  // Abort the shared engine driver BEFORE the audio session tear-down so engine ticks don't fire fresh
  // sample triggers onto a session that's about to lose its bus references. The engine catches the abort via
  // `throwIfAborted` and unwinds; our launchSharedEngine catch swallows the resulting `AbortError` because
  // the host already initiated dispose.
  // A play torn down mid-chart is interrupted too, so the engine stops instead of running on to the chart's end.
  interruptSharedEngine(ctx, 'escape');
  if (ctx.sharedEngineAbortController) {
    try {
      ctx.sharedEngineAbortController.abort();
    } catch {
      // Already aborted or unsupported environment — swallow.
    }
    ctx.sharedEngineAbortController = undefined;
  }
  ctx.sharedEngineSignals = undefined;
  ctx.sharedEngineInputSignals = undefined;
  ctx.liveTempo.attach(undefined);
  ctx.sharedEnginePromise = undefined;
  settleSeekWaiters(ctx);
}
