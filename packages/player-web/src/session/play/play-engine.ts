/**
 * The engine side of a play on the built-in and LR2 gameplay scenes (`CoreGameplayView`): launches the shared engine
 * (`runEngineDriver`) on the prepared chart, drains its UI signals each frame into the score, gauge, judgement, combo
 * and lane-effect state the scene draws (key-on timers, bombs, POOR BGA, long-note holds), and starts the ending once
 * the chart settles. ESC / F5 / a teardown interrupt the engine here.
 *
 * The functions read and write the scene's state through {@link PlayEngineContext}; the scene passes itself.
 */

import type { TimingResolver } from '@be-music/audio-renderer/triggers';
import type { RandomDraws } from '@be-music/chart';
import type { BeMusicEvent, BeMusicJson } from '@be-music/json';
import {
  PlayerInterruptedError,
  type LongNoteStyle,
  type PlayerRulesetInfo,
  type PlayerSummary,
  type PreparedPlaybackChartData,
} from '@be-music/player/core/engine';
import type { ChartPlayVariant } from '@be-music/player/core/lane-layout';
import type { PlayerInputSignalBus } from '@be-music/player/core/input-signal-bus';
import type { ScoreTracker } from '@be-music/player/core/scoring';
import type {
  PlayerGaugeSummary,
  PlayerUiCommand,
  PlayerUiFramePayload,
  PlayerUiSignalBus,
} from '@be-music/player/core/ui-signal-bus';
import type { TimedPlayableNote } from '@be-music/player/playable-notes';
import type { BeMusicPlaylog } from '@be-music/player/playlog';
import { resolveDisplayedPoor, type GaugeType, type JudgeKind, type ScoreSummary } from '@be-music/player/ruleset';
import type { PlayerJudgeComboSignalState, PlayerStateSignals } from '@be-music/player/state-signals';
import { resolveLr2LaneIndex } from '../../scene/gameplay-lanes.ts';
import type { BeMusicJudgeWindows, BeMusicLaneKind } from '@be-music/skin-sdk';
import type { BrowserSongEntry } from '../../collection/types.ts';
import type { AudioBusHandle } from '../../runtime/audio-bus.ts';
import { runEngineDriver } from '../../runtime/engine-driver.ts';
import type { NonstopStageMixer } from '../../runtime/nonstop-audio.ts';
import { supportsLiveTempoChange, type ReplayTempo } from '../../runtime/play-tempo.ts';
import { drainWebUiSignals, type WebUiRuntimeCallbacks } from '../../runtime/web-ui-runtime.ts';
import { advanceCourseCombo, type CourseComboState } from '../../scene/core/course-combo.ts';
import type { CoreGameplayViewOptions } from '../../scene/core/gameplay-options.ts';
import { toBeMusicJudgeWindows } from '../../scene/core/judge-windows.ts';
import type { JudgeTimingLog } from '../../scene/core/judge-timing-log.ts';
import type { LongNoteTracker } from '../../scene/core/long-note-tracker.ts';
import type { PixiGameplayResultData } from '../../scene/core/result-data.ts';
import type { LiveTempo } from '../../scene/live-tempo.ts';
import { resolvePlayEnding } from '../../scene/play-ending.ts';
import { PlaylogViewCursor } from '../../scene/playlog-view.ts';
import { QUIT_HOLD_KEY_CODE } from '../../scene/quit-hold.ts';
import { logger } from '../../logger.ts';
import { resolveBeMusicLaneKind } from '../../skin/be-music/registry.ts';
import type { BeMusicJudge } from '../../skin/be-music/types.ts';
import { beginExitSequence, type PlayEndingContext } from './play-ending.ts';
import { samplePlaybackRate } from './play-media.ts';
import {
  flushPlaylogView,
  followTempoChange,
  startPlaylogView,
  type PlayViewSettingsContext,
} from './play-view-settings.ts';

const log = logger('gameplay');

/** The scene's members the engine side reads and writes: `CoreGameplayView`'s members of these names. */
export interface PlayEngineContext extends PlayViewSettingsContext, PlayEndingContext {
  readonly options: Readonly<
    Pick<
      CoreGameplayViewOptions,
      | 'autoPlay'
      | 'autoScratch1P'
      | 'autoScratch2P'
      | 'chartMd5'
      | 'chartSha256'
      | 'course'
      | 'dpFlip'
      | 'gauge'
      | 'judgeRuleset'
      | 'nonstop'
      | 'onChartFinished'
      | 'onExit'
      | 'onRestart'
      | 'playlogRecorder'
      | 'random1P'
      | 'random2P'
      | 'replay'
      | 'tempoPitchMode'
      | 'hsFix'
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
  readonly song: BrowserSongEntry | undefined;
  readonly resolvedChart: BeMusicJson | undefined;
  readonly randomDraws: RandomDraws | undefined;
  readonly preparedChart: PreparedPlaybackChartData | undefined;
  readonly notes: TimedPlayableNote[];
  readonly timingResolver: TimingResolver | undefined;
  readonly chartPlayVariant: ChartPlayVariant;
  readonly audioBus: AudioBusHandle | undefined;
  readonly decodedSamples: Map<string, AudioBuffer>;
  readonly wavCmdVolumeMultipliers: Map<string, number>;
  readonly bmsonSlicePlayback:
    | Map<BeMusicEvent, { offsetSeconds: number; durationSeconds?: number; sliceId: string }>
    | undefined;
  readonly nonstopMixer: NonstopStageMixer | undefined;
  audioContextStartTime: number;
  readonly replayTempo: ReplayTempo | undefined;
  readonly liveTempo: LiveTempo;
  sharedEnginePromise: Promise<unknown> | undefined;
  sharedEngineAbortController: AbortController | undefined;
  chartEndHold: AbortController | undefined;
  onHeldPlayEnded: ((summary: Readonly<PlayerSummary>) => void) | undefined;
  sharedEngineLastJudgeComboTick: number;
  sharedEngineSignals: { uiSignals: PlayerUiSignalBus; stateSignals?: PlayerStateSignals } | undefined;
  sharedEngineInputSignals: PlayerInputSignalBus | undefined;
  sharedEngineInterrupt: 'escape' | 'restart' | undefined;
  sharedEngineChartSettled: boolean;
  sharedEngineClockAnchored: boolean;
  chartEnded: boolean;
  chartEndTimeout: number | undefined;
  playlog: BeMusicPlaylog | undefined;
  readonly playlogWaiters: Array<(playlog: BeMusicPlaylog) => void>;
  replayViewCursor: PlaylogViewCursor | undefined;
  score: ScoreSummary;
  readonly tracker: ScoreTracker;
  maxCombo: number;
  readonly courseCombo: CourseComboState | undefined;
  gaugeState: PlayerGaugeSummary;
  fastCount: number;
  slowCount: number;
  fullComboFired: boolean;
  lastJudge: string;
  lastJudgeUntil: number;
  lastJudgeAt: number | undefined;
  judgeSideState: Record<'1P' | '2P', { judge: JudgeKind | ''; until: number; combo: number; courseCombo?: number }>;
  readonly judgeTimings: JudgeTimingLog;
  judgeWindows: BeMusicJudgeWindows | undefined;
  longNoteStyle: LongNoteStyle | undefined;
  readonly longNotes: LongNoteTracker;
  readonly playMoments: {
    failedAtMs?: number;
    allNotesDoneAtMs?: number;
    outroAtMs?: number;
    gaugeRiseAtMs?: number;
    gaugeMaxAtMs?: number;
  };
  lastPoorAt: number;
  lastImpulseAt: number | undefined;
  lastImpulseKind: BeMusicLaneKind | undefined;
  readonly lanePressedAt: Map<string, number>;
  readonly laneReleasedAt: Map<string, number>;
  readonly pressedChannels: Set<string>;
  readonly timerStartedAt: Map<number, number>;
  readonly keyOnFadeOutStart: Map<number, number>;
  readonly keyFlashTimeouts: Set<number>;
  readonly bombStartedAt: Map<string, number>;
  readonly bombJudge: Map<string, BeMusicJudge>;
  resolveSelectedGauge(): GaugeType;
  resolveEmptyPoorCountsInPoorDisplay(): boolean;
  resolveKeyOnTimerId(channel: string): number | undefined;
  getResultData(): PixiGameplayResultData | undefined;
}

/**
 * "Fully on" hold time before {@link CoreGameplayView.flashKeyOnTimer} hands the lane laser to the release-fade path.
 * Without this hold the sprite would only stay at peak alpha for the first frame (≈16 ms at 60 fps) before the fade
 * tween kicked in, which made auto-judged short-note flashes look like a single-frame blink. ~60 ms is enough to
 * register visually as a deliberate "tap" without lingering through the next note.
 */
const KEY_ON_FLASH_HOLD_MS = 60;

/**
 * Hands the play over to the host once ({@link sharedEngineInterrupt}): a play still being judged is interrupted, so
 * the engine stops (and, for ESC, records the play as given up); a play whose chart already settled is complete, so
 * its hold is let go and it ends with its play log as usual. A no-op before the engine is running.
 */
export function interruptSharedEngine(this: PlayEngineContext, reason: 'escape' | 'restart'): void {
  if (this.sharedEngineInterrupt !== undefined) return;
  const signals = this.sharedEngineInputSignals;
  if (signals === undefined) return;
  this.sharedEngineInterrupt = reason;
  flushPlaylogView.call(this);
  if (this.sharedEngineChartSettled) {
    this.chartEndHold?.abort();
    return;
  }
  signals.pushCommand({ kind: 'interrupt', reason });
}

function startKeyOnTimer(this: PlayEngineContext, channel: string): void {
  this.lanePressedAt.set(channel, this.playClock());
  const timerId = this.resolveKeyOnTimerId(channel);
  if (timerId === undefined) {
    return;
  }
  this.timerStartedAt.set(timerId, this.playClock());
  // A fresh press cancels any in-flight release fade on the same lane; the laser is fully on again from this instant.
  this.keyOnFadeOutStart.delete(timerId);
}

/**
 * Smoothly extinguishes the lane laser when a key (or auto LN head) releases: the LR2 key-on timer (100..117) stays
 * in its currently-active state for {@link resolveKeyOnFadeMs} ms while a render-time alpha taper drives the visible
 * amplitude down to 0, then the timer entry itself is deleted. Anchored on `playClock` so the fade pauses cleanly
 * with the rest of the scene.
 *
 * The taper is what makes manual key-ups, auto-judged short notes (via {@link flashKeyOnTimer}), and auto-LN releases
 * all decay at the same speed without restarting the key-on keyframe (which would blink the LR2 default skin's lane
 * laser back to its fade-in origin before the decay).
 */
function releaseKeyOnTimer(this: PlayEngineContext, channel: string): void {
  this.laneReleasedAt.set(channel, this.playClock());
  const timerId = this.resolveKeyOnTimerId(channel);
  if (timerId === undefined) return;
  // Stamp the fade origin unconditionally — the render-side cleanup uses it as the authoritative clock for the
  // 1 → 0 alpha taper, and the previous early-return on a missing `timerStartedAt` left the LN-end path stuck at
  // full brightness whenever the deferred startKeyOnTimer / releaseKeyOnTimer interleaving had already retired
  // the slot (a racy setTimeout cleanup from a previous press could have wiped `timerStartedAt` between the LN's
  // startKeyOnTimer and this release). The `timerStartedAt.has` gate now controls only the deferred cleanup
  // below — the fade start is committed regardless so the render side (lane beam / theme key-on sprites) can taper
  // any still-visible laser through to alpha=0.
  this.keyOnFadeOutStart.set(timerId, this.playClock());
  if (!this.timerStartedAt.has(timerId)) return;
  const fadeMs = this.theme.resolveKeyOnFadeMs(timerId);
  const timeout = window.setTimeout(() => {
    this.keyFlashTimeouts.delete(timeout);
    if (this.disposed) return;
    // If the player (or autoplay) re-pressed the same lane during the fade window, leave the timer running and
    // skip the delete — the new press has its own lifecycle.
    if (!this.pressedChannels.has(channel)) {
      this.timerStartedAt.delete(timerId);
    }
    this.keyOnFadeOutStart.delete(timerId);
  }, fadeMs);
  this.keyFlashTimeouts.add(timeout);
}

/**
 * Starts a bomb (hit explosion) on `channel`. The core scene draws it from `bombStartedAt`; themes react through the
 * `bomb` event (the LR2 family stamps its per-lane bomb timer at the same instant).
 */
function triggerBomb(this: PlayEngineContext, channel: string, judge?: BeMusicJudge): void {
  const now = this.playClock();
  this.bombStartedAt.set(channel, now);
  if (judge) this.bombJudge.set(channel, judge);
  else this.bombJudge.delete(channel);
  this.theme.onThemeEvent({ kind: 'bomb', channel, at: now });
}

/**
 * Auto-play loop: when enabled, every playable note is judged as PERFECT exactly at its scheduled time. Background
 * lane sounds (`scheduleAutoSamples`) still handle non-input channels separately.
 *
 * Long notes are NOT judged on the head; instead the head time marks the LN as actively held (sample + bomb +
 * sustained key-on timer for the visual lane laser) and the actual scoreboard / gauge / combo commit is deferred to
 * {@link autoFinalizeLongNotes} when chart-time crosses `endSeconds`. This mirrors what real LR2 does (and what
 * `@be-music/player`'s engine does via `pendingAutoLongNotes`): one judgement event per LN, fired at the tail timing
 * so the combo pulse aligns with the LN visually completing rather than at its start.
 */
/**
 * Brief key-on flash. We start the per-lane LR2 key-on timer (100..107 / 110..117) and schedule it to clear after a
 * short interval so the laser fades like a real keystroke. Used by autoplay (no real keyboard event) so the player
 * still sees the lane / key visuals react.
 */
/**
 * Auto-judged short notes simulate a "press + release" in one tick: the lane laser lights up immediately (timer set
 * to `playClock()` so the LR2 key-on keyframe begins) and stays at peak alpha for {@link KEY_ON_FLASH_HOLD_MS} before
 * handing off to the release-fade path. Without that brief hold the sprite would taper from full to invisible across
 * the first 1–2 render frames and the press would read as a single-frame blink rather than a deliberate flash.
 */
function flashKeyOnTimer(this: PlayEngineContext, channel: string): void {
  startKeyOnTimer.call(this, channel);
  const timeout = window.setTimeout(() => {
    this.keyFlashTimeouts.delete(timeout);
    if (this.disposed) return;
    // A real press took over during the hold — skip the auto-release, the press lifecycle is in charge. (LN
    // sustains drive their own `hold-lane-until-beat` timer keep-alive via `applyEngineCommand`.)
    if (this.pressedChannels.has(channel)) {
      return;
    }
    releaseKeyOnTimer.call(this, channel);
  }, KEY_ON_FLASH_HOLD_MS);
  this.keyFlashTimeouts.add(timeout);
}

function publishJudge(this: PlayEngineContext, judge: JudgeKind, seconds: number, channel?: string): void {
  const until = seconds + 0.6;
  this.lastJudge = judge;
  this.lastJudgeUntil = until;
  this.lastJudgeAt = this.playClock();
  // Themes restart their per-side judge animation on every judgement (LR2 timer 46 / 47 drives the attached
  // `#DST_NOWJUDGE` / `#DST_NOWCOMBO` chains from time=0 per hit). When `channel` isn't supplied (legacy callers) we
  // default to the 1P side. PMS / 9 KEY is single-side so every judgement collapses onto 1P regardless of the
  // sourcing channel — the LR2 9-key skin authors only the 1P judge plate (channels 22..25 belong to the central /
  // right half of the Pop'n nine-lane bank, not the second player).
  const isPlayer2 = this.chartPlayVariant !== '9' && typeof channel === 'string' && channel.startsWith('2');
  const side: '1P' | '2P' = isPlayer2 ? '2P' : '1P';
  this.theme.onThemeEvent({ kind: 'judge', side, at: this.playClock() });
  // Snapshot the verdict + combo for this side so DP rendering shows each lane group's *own* combo number — frozen at
  // the moment that side last hit a note — rather than mirroring the global running combo on both sides.
  // A course stage also snapshots the course combo, which an LR2 skin shows there during an expert or grade course.
  this.judgeSideState[side] = {
    judge,
    until,
    combo: this.tracker.combo,
    ...(this.courseCombo !== undefined ? { courseCombo: this.courseCombo.combo } : {}),
  };
  // POOR / BAD judgements briefly swap the base BGA for the chart's POOR BGA. We trigger the same window for `BAD`
  // because the LR2 spec doesn't distinguish the two for the BGA channel.
  if (judge === 'POOR' || judge === 'BAD') {
    this.lastPoorAt = this.playClock();
  }
  // Mirror the running combo into our high-water mark. `tracker.combo` resets on every BAD/POOR, so this captures the
  // longest unbroken GREAT-or-better streak the player has reached so far. Used as the "MAX COMBO" readout for the
  // result screen — see `getResultData`.
  if (this.tracker.combo > this.maxCombo) {
    this.maxCombo = this.tracker.combo;
  }
  // Append a sample to the result-screen polyline histories. We do this in `publishJudge` (rather than at each judge
  // call site) because every gauge / EX-score change funnels through the same judgement path — adding the sample once
  // here keeps the three judge sites (manual hit, auto-PERFECT, auto-miss) symmetric.
  const totalSeconds = this.resolveSongDurationSeconds();
  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 0;
  this.gaugeHistory.push({ progress, value: this.gaugeState.current });
  this.scoreHistory.push({ progress, exScore: this.score.exScore });
  maybeFireFullCombo.call(this);
}

/**
 * Raises the `full-combo` theme event (LR2 timers 48 = 1P, 49 = 2P) the moment the player's running combo equals the
 * chart's playable note count — i.e. every note has been hit GREAT-or-better and the chain never broke. Latches
 * `fullComboFired` so subsequent judges don't re-raise it (which would replay the skin's FC slide-in animation from
 * time=0).
 *
 * AUTO mode also reaches this state on the very last note (every judge is auto-PERFECT, so combo === total at the
 * end) — the player specifically asked for the FC presentation to fire in AUTO too, which falls out for free since
 * the path is the same `applyJudgeToSummary` → `publishJudge` chain manual play uses.
 *
 * One event covers both sides because we don't yet model per-side combos. For DP this is correct (one player, one
 * combo). Battle mode would split.
 */
function maybeFireFullCombo(this: PlayEngineContext): void {
  if (this.fullComboFired) return;
  if (this.score.bad > 0 || this.score.poor > 0) return;
  if (this.score.total <= 0) return;
  if (this.tracker.combo < this.score.total) return;
  this.fullComboFired = true;
  this.theme.onThemeEvent({ kind: 'full-combo', at: this.playClock() });
  log.info('FULL COMBO');
}

/** Records the latest key press / autoplay hit for input-reactive skin visuals. */
function noteImpulse(this: PlayEngineContext, channel: string): void {
  this.lastImpulseAt = this.playClock();
  this.lastImpulseKind = resolveBeMusicLaneKind(
    channel,
    resolveLr2LaneIndex(channel, this.chartPlayVariant),
    this.chartPlayVariant,
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
 * The chart the engine plays in shared-engine mode: the one `prepareSong` resolved. Since the renderer hands the
 * engine its own `PreparedPlaybackChartData` instance (which already encodes shuffle / DP-flip), the chart events
 * here only feed engine-internal helpers (timing resolver, BGM / BGA / dynamic-volume realtime audio scheduling),
 * none of which care about the shuffled lane channels. The resolved chart carries no control flow, so the engine
 * plays it as is; {@link randomDraws} travel with it for the RANDOM summary.
 */
function buildSharedEngineChart(this: PlayEngineContext): BeMusicJson {
  return this.resolvedChart ?? this.song!.chart;
}

export function launchSharedEngine(this: PlayEngineContext): void {
  if (this.disposed || this.sharedEnginePromise) return;
  if (!this.song || !this.audioContext || !this.audioBus) return;
  // Build the chart the engine sees from the view's already-shuffled notes / mines / invisibles. The view's
  // `applyRandomMode` mutates `runtimeNote.channel` (NOT `event.channel`), so without this remap the engine
  // would extract notes from `chart.events` with their ORIGINAL pre-shuffle channels — its judge would target
  // a different lane than the visual the player is reading, so RANDOM / MIRROR / S-RANDOM / SCATTER would
  // make the chart unplayable. Rebuilding `events` with the post-shuffle channel keeps the engine and the
  // renderer on the same shuffle.
  const chart = buildSharedEngineChart.call(this);
  const callbacks: WebUiRuntimeCallbacks = {
    onFrame: (frame) => applyEngineFrame.call(this, frame),
    onCommand: (command) => applyEngineCommand.call(this, command),
    onJudgeCombo: (state) => applyEngineJudgeCombo.call(this, state),
    onSignalsReady: (signals) => {
      this.sharedEngineSignals = signals;
    },
  };
  // A replay shows its recorded view along the playhead; a recorded play logs its own from the start.
  this.playlogViewCoalescer = undefined;
  this.replayCovers = undefined;
  this.replayViewCursor =
    this.options.replay !== undefined
      ? new PlaylogViewCursor(this.options.replay.play.view, this.options.replay.play.viewChanges)
      : undefined;
  this.sharedEnginePromise = runEngineDriver({
    chart,
    audio: {
      audioContext: this.audioContext,
      audioBus: this.audioBus,
      decodedSamples: this.decodedSamples,
      wavCmdVolumeMultipliers: this.wavCmdVolumeMultipliers,
      bmsonSlicePlayback: this.bmsonSlicePlayback,
      // The engine plays through its own session: a stitched NONSTOP chart's stage rates (FIT) and fades go with it.
      ...(this.nonstopMixer !== undefined ? { stageMixer: this.nonstopMixer } : {}),
      playbackRate: samplePlaybackRate(this),
      playbackRateFollowsTempo: supportsLiveTempoChange(this.options.tempoPitchMode ?? 'pitch'),
    },
    mode: this.options.autoPlay ? 'auto' : 'manual',
    ui: callbacks,
    onInputSignalsReady: (signals) => {
      this.sharedEngineInputSignals = signals.inputSignals;
      this.sharedEngineInterrupt = undefined;
      this.sharedEngineChartSettled = false;
      // A tempo asked for while the engine was starting.
      this.liveTempo.attach(signals.inputSignals);
    },
    // Listen on the window (default) so the runtime sees keyboard events regardless of which DOM element
    // currently holds focus — matches the legacy `window.addEventListener('keydown', ...)` behaviour. The
    // canvas's `tabIndex = 0` only makes it focusable, not auto-focused, so a canvas-scoped listener would
    // only fire after the user clicked the canvas first.
    shouldSkipKey: (event) => {
      // Suppress lane-input dispatch when the user is typing into a focused text input (search box, etc.).
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
        if (target.isContentEditable === true) return true;
      }
      // ESC and F5 are handled by the view's own listener (set up in `enter`) so the LR2 `#FADEOUT` animation
      // runs to completion BEFORE the engine's `PlayerInterruptedError` flow disposes the audio session. If
      // we let the runtime push `interrupt(escape)` directly, the engine's `dispose()` would `node.stop()`
      // every in-flight BufferSource immediately, killing the chart audio mid-fade. Same idea for Space:
      // routing the toggle through the view's `togglePause` keeps the view's `paused` flag, the audio bus's
      // suspend, the BGA video pause, and the engine's playback clock all on the same single entry-point.
      if (event.code === 'Escape' || event.code === 'F5' || event.code === 'Space') return true;
      // Backspace is the view's hold-to-quit key (`QuitHoldController`), never a lane.
      if (event.code === QUIT_HOLD_KEY_CODE) return true;
      if (event.code === 'ArrowUp' || event.code === 'ArrowDown') return true;
      return false;
    },
    engineOptions: {
      // The draws `resolvedChart` was resolved with; the engine plays that chart as is and names them in its summary.
      ...(this.randomDraws !== undefined ? { randomDraws: this.randomDraws } : {}),
      // The view's own intro timing already gated the chart to PLAYSTART; tell the engine to start its chart
      // immediately so its t=0 lines up with our `audioContextStartTime` anchor instead of imposing the
      // engine's default 1.5 s lead-in on top.
      leadInMs: 0,
      // The play tempo: the engine's clock runs `tempo` times as fast and judges in chart time. A change during the
      // play comes back through `onTempoChange`, at the chart second the engine took it.
      speed: this.tempo,
      onTempoChange: (change) => followTempoChange.call(this, change),
      // Forward AUTO SCRATCH: engine has a single boolean rather than per-side, so either-side AUTO SCRATCH
      // turns scratch auto on for both 16 / 26 channels. That's a per-side fidelity loss for rare DP charts
      // where only one player's scratch should auto-spin (the demo's lil-gui surfaces them as two separate
      // toggles), but the alternative — leaving auto off — was worse: scratch notes the user expected to be
      // auto-spun would just sit there as misses, and the legacy `autoScratchJudge` path is gated off in
      // shared-engine mode. A future engine extension could split the flag per side.
      autoScratch: this.options.autoScratch1P === true || this.options.autoScratch2P === true,
      // Hand the engine the same `PreparedPlaybackChartData` instance the renderer is already pointing at
      // (`this.notes` / `this.mineNotes` / `this.invisibleNotes` are references into this bundle). The
      // engine's `autoPlay` / `manualPlay` use it verbatim instead of running their own
      // `preparePlaybackChartData` pass, so the renderer's parallel arrays and the engine's playable note
      // arrays are guaranteed to be the same instances — no `inferBmsLnTypeWhenMissing` flag to keep in
      // sync, no `laneModeExtension` to forward separately (the bundle already encodes the lane bindings
      // computed under the right extension), no `bms.controlFlow` re-resolve to deduplicate, no
      // `random1P: 'OFF'` truthy-check to fix. Every "view extracted differently than engine" bug is
      // structurally impossible because there is only one extract.
      preparedChart: this.preparedChart,
      // The gauge is part of the judging setup, not just a skin colour: the engine resolves it against the active
      // ruleset's gauge line-up and runs its curve, so HARD really drains and DEATH really ends the run.
      // `resolveSelectedGauge` prefers the replay's recorded pick, so a played-back log runs its original gauge.
      gauge: this.resolveSelectedGauge(),
      ...(this.options.replay === undefined && this.options.course !== undefined
        ? { course: this.options.course }
        : {}),
      // A stitched NONSTOP chart's later stages take over the judge rank (a replay restores the recorded changes).
      ...(this.options.replay === undefined && this.options.nonstop !== undefined
        ? { stageRanks: this.options.nonstop.stageRanks }
        : {}),
      ...(this.options.replay?.chart.judgeRank.stageRanks !== undefined
        ? {
            stageRanks: this.options.replay.chart.judgeRank.stageRanks.map((change) => ({
              ...change,
              seconds: change.timeUs / 1_000_000,
            })),
          }
        : {}),
      // The engine reports the ruleset after applying the judge ruleset, the debug window override, and (for a
      // replay) the recorded settings below, so the windows skins see are the ones the run is judged with.
      onRulesetResolved: (info) => applyResolvedRuleset.call(this, info),
      signal: (this.sharedEngineAbortController = new AbortController()).signal,
      // Keys stay live after the last note until the fade-out is over; the outro starts when the chart settles.
      holdAfterChart: {
        signal: (this.chartEndHold = new AbortController()).signal,
        onSettled: () => {
          this.sharedEngineChartSettled = true;
          drainSharedEngineSignals.call(this);
          handleSharedEngineChartFinished.call(this, undefined, true);
        },
      },
      ...(this.options.replay !== undefined
        ? {
            // Replay playback — feed the recorded input stream; the engine ignores live lane input, and the run
            // records no new play-log (replaying a replay would only duplicate the file). Auto scratch, the
            // judge ruleset, the debug judge-window override, the end-on-failure flag and the course stage are
            // restored from the log so the judging setup matches the recording.
            replayInputs: this.options.replay.inputs,
            // The tempo changes of the play, followed as the replay reaches them (`resolveReplayTempo`).
            ...(this.replayTempo !== undefined && this.replayTempo.changes.length > 0
              ? { replayTempoChanges: this.replayTempo.changes }
              : {}),
            // A play given up with ESC replays up to where it was given up, as its re-simulations do.
            ...(this.options.replay.play.aborted === true && this.options.replay.play.abortedAtUs !== undefined
              ? { replayAbortedAtUs: this.options.replay.play.abortedAtUs }
              : {}),
            autoScratch: this.options.replay.play.autoScratch,
            judgeRuleset: this.options.replay.play.judgeRuleset ?? 'lr2',
            // Logs from before plays ended on failure kept judging to the end; replay them that way.
            endOnFailure: this.options.replay.play.endOnFailure === true,
            ...(this.options.replay.play.course !== undefined ? { course: this.options.replay.play.course } : {}),
            ...(this.options.replay.play.judgeWindowOverrideMs !== undefined
              ? { judgeWindowMs: this.options.replay.play.judgeWindowOverrideMs }
              : {}),
          }
        : {
            ...(this.options.judgeRuleset !== undefined ? { judgeRuleset: this.options.judgeRuleset } : {}),
            // Play-log recording: the engine snapshots the resolved (post-shuffle) chart and the raw input
            // replay, then hands the assembled log here right before the play promise settles. The host reads it
            // back through `getResultData().playlog` for the result screen's auto-save.
            recordPlaylog: {
              gauge: this.options.gauge,
              ...(this.options.chartSha256 !== undefined ? { chartSha256: this.options.chartSha256 } : {}),
              ...(this.options.chartMd5 !== undefined ? { chartMd5: this.options.chartMd5 } : {}),
              ...(this.options.playlogRecorder !== undefined ? { recorder: this.options.playlogRecorder } : {}),
              // The engine plays the chart this view resolved; the song's chart is the source both fingerprints
              // describe (`#RANDOM` unresolved, no lane option applied).
              ...(this.song !== undefined ? { sourceChart: this.song.chart } : {}),
              ...(this.options.random1P !== undefined || this.options.random2P !== undefined
                ? {
                    randomLane: {
                      ...(this.options.random1P !== undefined ? { p1: this.options.random1P } : {}),
                      ...(this.options.random2P !== undefined ? { p2: this.options.random2P } : {}),
                    },
                  }
                : {}),
              ...(this.options.dpFlip !== undefined ? { dpFlip: this.options.dpFlip } : {}),
              // What the player sees at the start; the changes during the play go in as `view` commands.
              view: startPlaylogView.call(this),
              ...(this.song?.chartPath !== undefined ? { native: { chartPath: this.song.chartPath } } : {}),
            },
            onPlaylogRecorded: (playlog) => {
              this.playlog = playlog;
              const waiters = this.playlogWaiters.splice(0);
              for (const resolve of waiters) resolve(playlog);
            },
          }),
    },
  })
    .then((summary) => {
      log.info('shared engine driver finished');
      drainSharedEngineSignals.call(this);
      applyEngineSummary.call(this, summary);
      applyFinalComboSummary.call(this, summary);
      // A play the view interrupted (ESC / F5 / teardown) has already handed the host over; it does not finish.
      if (this.sharedEngineInterrupt !== undefined) return;
      // A held play ends when its outro lets go; one that ended on its own (a failed gauge, a replay stopping where its
      // log was given up) starts it now.
      const waiting = this.onHeldPlayEnded;
      if (waiting !== undefined) {
        this.onHeldPlayEnded = undefined;
        waiting(summary);
        return;
      }
      handleSharedEngineChartFinished.call(this, summary);
    })
    .catch((error: unknown) => {
      // The view's own ESC / F5 handler (`handleSharedEngineExitKey`) drives the LR2 fadeout animation, calls
      // the host's `onExit` / `onRestart` from the fade-completion callback, and then aborts the engine's
      // signal — which is what produced this rejection. The view is already disposing (or about to), so the
      // catch handler short-circuits to avoid double-firing the host transition. Same logic for any rejection
      // landing after `dispose` has flipped `disposed` (e.g. parent component teardown without ESC).
      if (this.disposed) return;
      if (this.sharedEngineAbortController?.signal.aborted) return;
      if (error instanceof PlayerInterruptedError) {
        if (error.reason === 'escape') {
          beginExitSequence.call(this, () => this.options.onExit?.());
        } else if (error.reason === 'restart') {
          this.options.onRestart?.();
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
export function drainSharedEngineSignals(this: PlayEngineContext): void {
  if (!this.sharedEngineSignals) return;
  const result = drainWebUiSignals(
    this.sharedEngineSignals.uiSignals,
    {
      onFrame: (frame) => applyEngineFrame.call(this, frame),
      onCommand: (command) => applyEngineCommand.call(this, command),
      onJudgeCombo: (state) => applyEngineJudgeCombo.call(this, state),
    },
    {
      stateSignals: this.sharedEngineSignals.stateSignals,
      lastJudgeComboTick: this.sharedEngineLastJudgeComboTick,
    },
  );
  this.sharedEngineLastJudgeComboTick = result.lastJudgeComboTick;
}

/**
 * Mirrors the engine's per-frame snapshot into the view's score / gauge / fast-slow fields so the LR2 NUMBER
 * elements + score-graph keep rendering from the existing source paths — they don't need to know the engine
 * replaced the in-tree judge ladder. The summary's optional `gauge` payload populates `this.gaugeState` so the
 * skin's `#DST_GAUGE` chrome animates against the same value the engine considers authoritative.
 */
function applyEngineFrame(this: PlayEngineContext, frame: Readonly<PlayerUiFramePayload>): void {
  // Re-anchor the view's chart-time clock to the engine's the very first time the engine publishes a frame.
  // The engine's `playbackClock` (and therefore the chart-time it stamps on every judge / sample / ui-signal
  // event) anchors at the moment the engine creates the clock — which lands a few ms to a few hundred ms
  // AFTER the view set `audioContextStartTime` in its PLAYSTART gate, since `manualPlay` runs through its
  // entire prepare phase between those two points. Without re-anchoring, every note appears to pass the
  // judgment line slightly EARLIER (in view time) than the engine actually judges it, so the visual hit
  // doesn't line up with the score event.
  //
  // Using the first non-zero `frame.currentSeconds` snaps the view's `audioContextStartTime` so that
  // `currentSeconds() === frame.currentSeconds` from now on. Subsequent frames don't re-anchor — both
  // clocks tick on the AudioContext now, so the offset stays locked.
  if (!this.sharedEngineClockAnchored && frame.currentSeconds > 0 && this.audioContext) {
    this.audioContextStartTime = this.audioContext.currentTime - this.tempoClock.clockMsAt(frame.currentSeconds) / 1000;
    this.sharedEngineClockAnchored = true;
    this.nonstopMixer?.schedule(this.audioContextStartTime);
  }
  applyEngineSummary.call(this, frame.summary);
}

function applyEngineSummary(this: PlayEngineContext, summary: Readonly<PlayerSummary>): void {
  // `summary.total` is the engine's authoritative scorable-note count (`scorableNotes.length`, which excludes
  // Free-Zone channels). The view's own initial `score.total` is computed independently in `prepareSong` from
  // `notes.filter(isPlayableInputChannel).length`, which DOES include Free-Zone — so on charts that use
  // channel `17` / `27` as Free-Zone the two diverge by the Free-Zone count. That mismatch makes
  // `maybeFireFullCombo`'s `tracker.combo === score.total` predicate unreachable (combo can only ever climb to
  // the engine's smaller scorable count) and the FC presentation never fires. Sync `score.total` to the
  // engine's value here so the view always agrees with the authority on the scorable population.
  this.score.total = summary.total;
  this.score.perfect = summary.perfect;
  this.score.great = summary.great;
  this.score.good = summary.good;
  this.score.bad = summary.bad;
  this.score.emptyPoor = summary.emptyPoor;
  // `this.score` is the DISPLAY copy: under LR2 the POOR counter folds empty POORs in, matching the real thing
  // (OpenLR2 `ApplyJudgeNote` increments `playerstat.poor` for the empty-POOR branch, and LR2 exposes no
  // separate stat). Every LR2 read-out — the POOR row, BP, the per-judge rates, the skin's num 84 / 89 / 114 —
  // goes through this object, so folding here keeps them all consistent. `summary.poor` itself stays split.
  this.score.poor = resolveDisplayedPoor(summary, this.resolveEmptyPoorCountsInPoorDisplay());
  this.score.exScore = summary.exScore;
  this.score.score = summary.score;
  this.fastCount = summary.fast;
  this.slowCount = summary.slow;
  if (summary.gauge) {
    const previous = this.gaugeState.current;
    this.gaugeState = { ...summary.gauge };
    // Gauge-rise / gauge-max theme feedback (LR2 timers 42 / 44). Mirrors what the legacy `applyGaugeDelta` did —
    // raise on every transition so authored skin elements (rise sparkle, max-glow overlay) animate. We compare against the previous frame's value rather than against an "EMPTY_POOR-
    // sized delta" because the engine drives gauge updates monotonically through `summary.gauge.current`,
    // not through judge deltas.
    const next = summary.gauge.current;
    if (next !== previous) {
      this.theme.onThemeEvent({ kind: 'gauge', previous, next });
      // Latch the first rise above the starting value and the first time the gauge tops out.
      const moments = this.playMoments;
      if (next > summary.gauge.initial) moments.gaugeRiseAtMs ??= this.playClock();
      if (next >= summary.gauge.max) moments.gaugeMaxAtMs ??= this.playClock();
    }
    if (summary.gauge.failedMidPlay === true) this.playMoments.failedAtMs ??= this.playClock();
  }
  // `poor` excludes empty POORs, so this counts judged notes only.
  const judged = summary.perfect + summary.great + summary.good + summary.bad + summary.poor;
  if (summary.total > 0 && judged >= summary.total) this.playMoments.allNotesDoneAtMs ??= this.playClock();
  // Note: the per-note `judged` flag is no longer synced here. The renderer's `this.notes` /
  // `this.mineNotes` are references into the same `PreparedPlaybackChartData` instance the engine is
  // judging against (handed in via `engineOptions.preparedChart`), so when the engine sets
  // `note.judged = true` the renderer sees it on the next paint with no copy step. The fragile
  // index-based sync this used to perform was the source of the Phase-4c HIDE-on-judge dropout, the
  // mid-chart full-combo cue, and the AUTO PLAY < 200_000 score regressions — every one of them was
  // really "engine extract produced a different array than view extract." With the shared instance
  // there is no second extract.
}

function applyFinalComboSummary(this: PlayEngineContext, summary: Readonly<PlayerSummary>): void {
  if (this.options.autoPlay !== true) return;
  if (summary.total <= 0) return;
  if (summary.perfect + summary.great + summary.good < summary.total) return;
  if (summary.bad > 0 || summary.poor > 0) return;
  this.tracker.combo = Math.max(this.tracker.combo, summary.total);
  this.maxCombo = Math.max(this.maxCombo, summary.total);
  if (this.courseCombo !== undefined) advanceCourseCombo(this.courseCombo, this.tracker.combo);
}

/**
 * Maps an engine UI command to the matching view-side visual effect. The visual-effect helpers
 * (`flashKeyOnTimer`, `startKeyOnTimer`, `releaseKeyOnTimer`, `triggerBomb`) are kept in shared-engine mode because
 * they own the per-lane timer book-keeping the lane beams animate against — only the judge / sample-trigger code
 * paths above were removed. Every command is then forwarded to the theme as a `lane-command` event (the LR2 family
 * drives its LN-hold timers and turntable from it).
 */
function applyEngineCommand(this: PlayEngineContext, command: PlayerUiCommand): void {
  switch (command.kind) {
    case 'flash-lane':
      noteImpulse.call(this, command.channel);
      flashKeyOnTimer.call(this, command.channel);
      break;
    case 'press-lane':
      noteImpulse.call(this, command.channel);
      this.pressedChannels.add(command.channel);
      startKeyOnTimer.call(this, command.channel);
      break;
    case 'release-lane':
      this.pressedChannels.delete(command.channel);
      releaseKeyOnTimer.call(this, command.channel);
      break;
    case 'hold-lane-until-beat':
      // Mark the lane as held for the LN's duration. Without this, a `flash-lane` command that arrives in
      // the same tick (typical for the LN HEAD: autoplay emits BOTH `flash-lane` and `hold-lane-until-beat`
      // on every LN start) schedules a `flashKeyOnTimer` setTimeout that calls `releaseKeyOnTimer` after
      // `KEY_ON_FLASH_HOLD_MS` because `pressedChannels.has(channel)` is `false`, and the lane laser fades
      // out ~150 ms into the LN even though the LN body is still scrolling. Adding the channel to
      // `pressedChannels` here makes the auto-release skip path fire the same way it does for a real key
      // press, and the laser stays lit for the full LN sustain. The matching `release-lane` (emitted by
      // `drainPendingAutoLongNotes` / `drainPendingAutoScratchLongNotes` at the LN tail) deletes the
      // channel and lets the lane laser fade out at the tail timing.
      this.pressedChannels.add(command.channel);
      startKeyOnTimer.call(this, command.channel);
      // The engine's hold-until-beat command implicitly says "the LN is firing now"; bomb-flash on the head
      // mirrors the legacy autoJudge behavior so the lane still blinks a positive-feedback explosion at LN
      // start in autoplay.
      triggerBomb.call(this, command.channel);
      break;
    case 'trigger-poor-bga':
      this.lastPoorAt = command.seconds;
      // Empty POOR (the engine fires `trigger-poor-bga` for both real POOR judges AND for empty presses /
      // unjudged-misses-past-window) doesn't go through `publishJudgeCombo` for empty-press cases, so the
      // result-screen gauge / score polylines would skip those samples in shared-engine mode and the graph
      // wouldn't match the legacy view's. Append history points here so the graph stays smooth across both
      // paths. Real POOR judges that ALSO publish a judge-combo will get a second sample from
      // `applyEngineJudgeCombo`'s `publishJudge` call — that's a no-op visually (both samples land at almost
      // the same `progress`) and keeps the contract "every gauge / EX-score change records a sample."
      recordSharedEngineHistorySample.call(this, command.seconds);
      break;
    case 'clear-poor-bga':
      this.lastPoorAt = -Number.POSITIVE_INFINITY;
      break;
    case 'long-note-start':
      this.longNotes.start(command.channel, command.beat, command.mode, this.playClock());
      break;
    case 'long-note-end':
      this.longNotes.end(command.channel, command.outcome);
      break;
  }
  this.theme.onThemeEvent({ kind: 'lane-command', command });
}

/** Keeps the engine's long-note style and its judge windows (converted to ms) for the skin runtime. */
function applyResolvedRuleset(this: PlayEngineContext, info: PlayerRulesetInfo): void {
  this.longNoteStyle = info.longNoteStyle;
  this.judgeWindows = toBeMusicJudgeWindows(info.windows);
}

/**
 * Pushes one sample to {@link gaugeHistory} / {@link scoreHistory} using the current engine-derived
 * \`gaugeState.current\` and \`score.exScore\` snapshots. Called from the shared-engine command handler when
 * the engine reports a gauge / score change that doesn't flow through \`publishJudgeCombo\` (= empty POOR).
 * In legacy mode the same arrays are pushed exclusively from \`publishJudge\`.
 */
function recordSharedEngineHistorySample(this: PlayEngineContext, seconds: number): void {
  const totalSeconds = this.resolveSongDurationSeconds();
  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, seconds / totalSeconds)) : 0;
  this.gaugeHistory.push({ progress, value: this.gaugeState.current });
  this.scoreHistory.push({ progress, exScore: this.score.exScore });
}

/**
 * Drives every per-judge visual the LR2 skin animates against from the engine's stateSignals judge-combo bus:
 *
 * - `tracker.combo` mirrors the engine's running combo so `#SRC_NUMBER,st=70` (NOWCOMBO) renders the right
 *   number, and the `maxCombo` high-water mark feeds the result screen's MAX COMBO readout.
 * - `publishJudge` does the rest of the legacy per-judge work — it stamps timer 46 (1P) or 47 (2P) so the
 *   `#DST_NOWJUDGE` / `#DST_NOWCOMBO` keyframe chains animate from time=0 on every hit (without this, the
 *   plate stays invisible because the timer's playhead is parked at scene start), latches `lastJudge` /
 *   `lastJudgeUntil` so the fallback `#SRC_TEXT` paints the verdict, snapshots `judgeSideState[side]` for DP
 *   per-side rendering, swaps to the POOR BGA on POOR/BAD, appends a sample to gauge / score histories for
 *   the result graph, and fires `maybeFireFullCombo` for timers 48/49.
 * - On PERFECT / GREAT we additionally fire the lane bomb (the engine's `flash-lane` command is severity-
 *   independent so we can't piggy-back on it; the bomb is a positive-feedback cue specifically for clean
 *   hits). The legacy `commitFinalJudge` ran the same gate.
 */
function applyEngineJudgeCombo(this: PlayEngineContext, state: Readonly<PlayerJudgeComboSignalState>): void {
  if (state.judge === 'READY') return;
  this.tracker.combo = state.combo;
  if (state.combo > this.maxCombo) this.maxCombo = state.combo;
  if (this.courseCombo !== undefined) advanceCourseCombo(this.courseCombo, state.combo);
  const judgeKind = state.judge as JudgeKind;
  // Autoplay hits, mine BADs, and missed notes carry no `deltaMs`; the log skips them.
  this.judgeTimings.push(this.playClock(), state.judge, state.deltaMs, state.channel);
  publishJudge.call(this, judgeKind, this.currentSeconds(), state.channel);
  if ((judgeKind === 'PERFECT' || judgeKind === 'GREAT') && state.channel) {
    triggerBomb.call(this, state.channel, judgeKind);
  }
}

/**
 * Fires when the engine driver's `manualPlay` / `autoPlay` promise resolves cleanly (= chart played to its end
 * without an interrupt). The host's `onChartFinished` callback receives a `PixiGameplayResultData` snapshot and
 * the LR2 `#FADEOUT` → `#CLOSE` exit timeline runs before the result-screen transition. The engine's resolution
 * is the authoritative end-of-chart signal — the view's `currentSeconds` clock lags slightly behind the engine's
 * own bookkeeping, so we don't gate on it.
 */
/**
 * Starts the outro once the chart is over. `held` means the engine's play is still open (keys still live): the fade-out
 * runs first, then the play is let go and the result waits for its final summary.
 */
function handleSharedEngineChartFinished(
  this: PlayEngineContext,
  finalSummary: Readonly<PlayerSummary> | undefined,
  held = false,
): void {
  if (this.disposed || this.chartEnded) return;
  this.chartEnded = true;
  this.playMoments.outroAtMs ??= this.playClock();
  // The end-of-play policy both gameplay families share (`scene/play-ending.ts`): a lead-out after the last note, or —
  // for a play cut short by its gauge emptying — no lead-out and a sound + picture fade-out before the result.
  const ending = resolvePlayEnding({
    summary: finalSummary,
    notes: this.notes,
    timing: this.timingResolver,
    currentSeconds: this.currentSeconds(),
    tempo: this.tempo,
    themeFadeOutMs: this.theme.themeTiming().fadeOutMs,
  });
  // Hold the play scene for roughly two measures after the final note. This keeps the last hit / final keysound from
  // being swallowed by an immediate result transition while still falling back to a one-frame defer on empty charts or
  // charts whose non-note tail has already carried us past the target.
  this.chartEndTimeout = window.setTimeout(() => {
    this.chartEndTimeout = undefined;
    if (this.disposed) return;
    drainSharedEngineSignals.call(this);
    if (finalSummary !== undefined) {
      applyEngineSummary.call(this, finalSummary);
      applyFinalComboSummary.call(this, finalSummary);
    }
    const finish = (): void => {
      const result = this.getResultData();
      if (this.options.onChartFinished && result) {
        this.options.onChartFinished(result);
        return;
      }
      this.options.onExit?.();
    };
    beginExitSequence.call(
      this,
      () => {
        if (!held) {
          finish();
          return;
        }
        // The outro is over: let the held play end, and show the result with its final summary.
        this.onHeldPlayEnded = () => {
          if (!this.disposed) finish();
        };
        flushPlaylogView.call(this);
        this.chartEndHold?.abort();
      },
      { fadeAudio: ending.fadeAudio, minFadeOutMs: ending.fadeOutMs },
    );
  }, ending.leadOutMs);
}

/** Stops the shared engine as the scene is disposed (`CoreGameplayView.dispose`) and lets go of its buses. */
export function stopSharedEngine(this: PlayEngineContext): void {
  // Abort the shared engine driver BEFORE the audio session tear-down so engine ticks don't fire fresh
  // sample triggers onto a session that's about to lose its bus references. The engine catches the abort via
  // `throwIfAborted` and unwinds; our launchSharedEngine catch swallows the resulting `AbortError` because
  // the host already initiated dispose.
  // A play torn down mid-chart is interrupted too, so the engine stops instead of running on to the chart's end.
  interruptSharedEngine.call(this, 'escape');
  if (this.sharedEngineAbortController) {
    try {
      this.sharedEngineAbortController.abort();
    } catch {
      // Already aborted or unsupported environment — swallow.
    }
    this.sharedEngineAbortController = undefined;
  }
  this.sharedEngineSignals = undefined;
  this.sharedEngineInputSignals = undefined;
  this.liveTempo.attach(undefined);
  this.sharedEngineClockAnchored = false;
  this.sharedEnginePromise = undefined;
}
