/**
 * The play session: one play's behaviour, whatever skin family draws it (ADR 0001). It composes the play's parts around
 * one `PlayState` — the chart (`play-chart.ts`), the media (`play-media.ts`, through the audio service's play graph when
 * the host gives one), the engine (`play-engine.ts`), the play's own input (`play-input.ts`), the view settings
 * (`play-view-settings.ts`) and the ending (`play-ending.ts`) — and keeps the clocks, the pause, the recording and the
 * result. Each part takes the session as its context.
 *
 * The session draws nothing. What it needs of the view that draws it — the timing of its intro and fade-out, the scene
 * moments it animates against, the key-beam fade, the view's own loading and the GPU upload of the BGA — comes through
 * {@link PlaySessionTheme}; the view's touch lanes come back as `lane` intents. `createPlayScene` (`host/play.ts`) pairs a session with the
 * play view of the kit's family (built-in or LR2) and reads a `PlayFrame` off it every tick.
 */

import { mirrorBeatAtTempoReversal } from '@be-music/chart-model';
import { nonstopBPMAt } from '@be-music/player-engine/course';
import { DEFAULT_REPLAY_PLAYBACK_OPTIONS, type BeMusicReplay } from '@be-music/player-engine/replay';
import type { GaugeType } from '@be-music/player-engine/ruleset';
import { createHiSpeedState, createPlayState, type LibraryChart, type PlayResult } from '@be-music/player-scene-model';
import type { BeMusicLongNote } from '@be-music/player-skin-sdk';
import type { Application, Texture } from 'pixi.js';
import type { BrowserAssetSource } from '../../collection/types.ts';
import { logger } from '../../logger.ts';
import { GameplayRecorder, type GameplayRecorderResult } from '../../recording/gameplay-recorder.ts';
import type { RecordingFormat } from '../../recording/recording-format.ts';
import {
  sanitizeBusVolume,
  type AudioBusChannel,
  type CompressorParams,
  type CompressorStage,
  type TunableCompressor,
} from '../../runtime/audio-bus.ts';
import {
  clampPlayTempo,
  resolveReplayTempo,
  supportsLiveTempoChange,
  type ReplayTempo,
} from '../../runtime/play-tempo.ts';
import type { PlayDisposeOptions, PlaySessionOptions } from './play-options.ts';
import { resolveBeMusicLongNoteMode } from './long-note-tracker.ts';
import { FALLBACK_INTRO_DELAY_MS, KEY_ON_FADE_OUT_MS } from '../../stage/design.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import { LiveTempo } from './live-tempo.ts';
import { releaseTexturesOnHost } from '../../stage/pixi-utils.ts';
import { QuitHoldController } from './quit-hold.ts';
import type { BeMusicLaneCover } from '../../skin/be-music/types.ts';
import type { RuntimeNote } from '../../view/shared/playfield/context.ts';
import type { PlayViewTiming } from '../../view/types.ts';
import { prepareChart } from './play-chart.ts';
import { beginExitSequence, getResultData } from './play-ending.ts';
import { interruptSharedEngine, launchSharedEngine, stopSharedEngine } from './play-engine.ts';
import { chartSecondsFromFrame } from './play-clock.ts';
import { seekPlay } from './play-seek.ts';
import {
  attachPlayInput,
  detachPlayInput,
  handleSharedEngineExitKey,
  handleVisibilityChange,
  handleWindowBlur,
  handleWindowFocus,
  togglePause,
} from './play-input.ts';
import { disposeBGAVideos, disposePlayAudio, prepareAudio, prepareBGA } from './play-media.ts';
import { PlaySessionState } from './play-session-state.ts';
import type { PlaySessionTheme } from './play-session-theme.ts';
import { applyPlayEvent } from './play-state.ts';
import { resolveLaneCovers, resolveVisibleMs } from './play-view-settings.ts';

const log = logger('gameplay');

const NO_TIMING: PlayViewTiming = { loadEndOffsetMs: 0, playStartOffsetMs: 0, fadeOutMs: 0, closeMs: 0 };

/** The theme of a session without a view: skinless timing, no moments heard, the default beam fade. */
const NO_THEME: PlaySessionTheme = {
  timing: () => NO_TIMING,
  moment: () => {},
  keyOnFadeMs: () => KEY_ON_FADE_OUT_MS,
};

/** The play session. See the module comment. */
export class PlaySession extends PlaySessionState {
  /**
   * The play tempo in force ({@link PlaySessionOptions.tempo}, or a replay's recorded one, then every live change):
   * chart seconds per clock second.
   */
  tempo: number;
  /** The tempo a replay plays at and the changes it follows (`resolveReplayTempo`). */
  readonly replayTempo: ReplayTempo | undefined;
  /** The live tempo changes asked for ({@link setTempo}), pushed to the engine (held until its input bus is up). */
  readonly liveTempo: LiveTempo;
  readonly options: PlaySessionOptions;
  /** What the session asks of the view that draws it. */
  readonly theme: PlaySessionTheme;
  /**
   * Whether the view shows the play: from {@link start}, or from the chart's preparation when the play is already on
   * the stage (no splash covers the load), so the playfield draws in its loading state.
   */
  shown = false;

  public constructor(options: PlaySessionOptions = {}, theme: PlaySessionTheme = NO_THEME) {
    super();
    this.options = options;
    this.theme = theme;
    // A replay plays back at the tempo it was played at, unless its viewer keeps their own (`replayView.tempo`).
    this.replayTempo =
      options.replay !== undefined
        ? resolveReplayTempo(options.replay.play, {
            ownTempo: options.tempo,
            pitchMode: options.tempoPitchMode ?? 'pitch',
            // The recorded tempo timeline only when the viewer's replay options reproduce the tempo (default on).
            reproduce: (options.replayView ?? DEFAULT_REPLAY_PLAYBACK_OPTIONS).tempo,
          })
        : undefined;
    this.tempo = this.replayTempo?.tempo ?? clampPlayTempo(options.tempo);
    // Only in pitch mode (kept pitch stretched the samples to the tempo they loaded at), and not for a replay.
    this.liveTempo = new LiveTempo(
      this.tempo,
      options.replay === undefined && supportsLiveTempoChange(options.tempoPitchMode ?? 'pitch'),
    );
    // The player's hi-speed, snapped to the 1/1000 grid the hotkey steps on, so a host-supplied `1.5000000000000002`
    // (the float drift of repeated +0.1 steps) lands on the canonical grid value; the default without a valid one.
    // HS-FIX applies once the chart is prepared.
    this.playState = createPlayState({
      view: {
        hiSpeed: createHiSpeedState({
          ...(options.initialHiSpeed !== undefined ? { hiSpeed: options.initialHiSpeed } : {}),
          locked: options.hiSpeedLocked === true,
        }),
      },
    });
    this.scrollHiSpeed.jump(this.playState.view.hiSpeed.drawn);
    this.autoPauseOnBlur = options.autoPauseOnBlur ?? false;
    this.audioVolumes = {
      key: sanitizeBusVolume(options.audioVolumes?.key ?? 1),
      bgm: sanitizeBusVolume(options.audioVolumes?.bgm ?? 1),
    };
    this.audioCompressorParams = { ...options.audioCompressorParams };
  }

  /**
   * Convenience accessor for the host's `Application`. Throws before the play has a host; this is intentional — every
   * code path that touches `this.app` runs once the play is prepared or shown.
   */
  get app(): Application {
    if (!this.host) {
      throw new Error('PlaySession: app accessed before the play has a host');
    }
    return this.host.app;
  }

  /**
   * Loads the play: parses the chart, and decodes every audio sample the chart references — the slow part of going from
   * "song picked" to "gameplay can begin". It touches no stage and adds no listeners. Returns once chart audio is
   * decoded; the BGA preload runs on in the background and {@link start} waits for it before the chart begins (the
   * ffmpeg.wasm fallback for unsupported codecs can take tens of seconds, and the play should show its LOADING
   * animation meanwhile instead of freezing the decide screen).
   */
  public async load(chartEntry: LibraryChart, source?: BrowserAssetSource): Promise<void> {
    this.chart = chartEntry;
    this.source = source;
    // Hidden until {@link start} fires, so a play shown before it begins draws nothing of it yet.
    this.shown = false;
    this.assetsLoading = true;
    prepareChart(this, chartEntry);
    if (this.entered) {
      // No splash covers the load window: hold the chart clock before its start (see `start()`) and draw the loading
      // playfield while assets decode, instead of a blank stage.
      this.startTime = Number.POSITIVE_INFINITY;
      this.shown = true;
    }
    // The view's own assets (an LR2 skin's images, fonts and timer spans) load now, before the samples decode.
    await this.theme.prepareView?.();
    if (this.disposed) return;
    await prepareAudio(this);
    if (this.disposed) return;
    this.bgaReadyPromise = prepareBGA(this).catch((error) => {
      log.warn('BGA preload failed; continuing without it', error);
    });
    void this.bgaReadyPromise.then(() => {
      this.assetsLoading = false;
    });
  }

  /**
   * The play goes on the stage: wires its keys (ESC / F5 / Space / arrows, the Backspace hold), canvas focus and the
   * auto-pause on losing focus (the touch lanes are the view's, sent as `lane` intents). The play itself starts with
   * {@link start}.
   */
  public attachInput(host: PixiSceneHost): void {
    if (this.disposed || this.entered) return;
    this.host ??= host;
    this.entered = true;
    attachPlayInput(this, host);
  }

  /** The play leaves the stage: its input stops. The engine and sound run on, a play that ended keeps its tail. */
  public detachInput(): void {
    if (!this.entered) return;
    this.entered = false;
    detachPlayInput(this);
  }

  /**
   * Shows the play and starts the intro timeline (the theme's `scene-start`, `load-end` and `play-start` moments). Must
   * be called after {@link load} resolves; calling it before skips the chart-start scheduling because
   * `audioContextStartTime` only lands in the right ballpark when the audio context is up.
   *
   * Idempotent — repeated calls after the play has already started no-op.
   */
  public start(): void {
    if (this.disposed) return;
    if (this.sceneStartTime !== 0) return;
    this.shown = true;
    // The intro timeline comes from the theme (the LR2 family maps `#LOADSTART` / `#LOADEND` / `#PLAYSTART`). `start()`
    // only runs when `paused` is false and `pauseTotal` is still 0, so `playClock()` and `performance.now()` are
    // equivalent here — but seeding through `playClock()` keeps the animation clocks all in the same coordinate system
    // as the pause-aware reads further below.
    const now = this.playClock();
    this.sceneStartTime = now;
    const { loadEndOffsetMs, playStartOffsetMs } = this.theme.timing();
    // Skinless / non-LR2 demos have no timing directives; fall back to the legacy 3-second wait so the slide-in chrome
    // of the built-in fallback frame still has room to land before notes begin.
    const introMs = playStartOffsetMs > 0 ? playStartOffsetMs : FALLBACK_INTRO_DELAY_MS;
    this.scheduledIntroMs = introMs;
    // The chart waits on BOTH the configured PLAY START delay AND the BGA preload (which may still be transcoding video
    // in the background — see `load()`). Until the gate opens below, `startTime = +Infinity` keeps `isIntroPlaying`
    // true and the play in the intro (LR2 LOADING) phase.
    this.startTime = Number.POSITIVE_INFINITY;
    // Scene start fires immediately; load-end and play-start — the events that drive "READY" / chart-start cues — fire
    // later via the `Promise.all` gates below so they wait for the BGA preload too. Exit-phase events are deliberately
    // NOT raised here: `beginExitSequence` raises them at the actual transition moment (ESC / chart end / failure).
    this.theme.moment({ kind: 'scene-start', at: now });
    // The `start()` invocation we belong to — captured so the gate handlers below can detect a dispose-and-re-mount and
    // bail out instead of mutating a fresh play's state.
    const sceneEpoch = this.sceneStartTime;
    const bgaReady = this.bgaReadyPromise ?? Promise.resolve();
    // LOAD END gate — both the configured load-end delay AND the BGA preload need to finish.
    void Promise.all([bgaReady, this.delaySceneStage(loadEndOffsetMs)]).then(() => {
      if (this.disposed) return;
      if (this.sceneStartTime !== sceneEpoch) return;
      this.theme.moment({ kind: 'load-end', at: this.playClock() });
    });
    // PLAY START gate — same pattern, but for the configured play-start (or fallback intro). Raises the theme's
    // play-start event (animation clock) and anchors the wall-clock + audio-context start times (chart-engine clock) so
    // the chart engine and BGM samples share a single t=0.
    void Promise.all([bgaReady, this.delaySceneStage(introMs)]).then(() => {
      if (this.disposed) return;
      if (this.sceneStartTime !== sceneEpoch) return;
      this.theme.moment({ kind: 'play-start', at: this.playClock() });
      // `startTime` is consumed by `isIntroPlaying` and `currentSeconds`, both of which work in raw wall-clock units
      // (with `currentSeconds` subtracting `pauseTotal` explicitly), so it MUST stay on `performance.now()`.
      this.startTime = performance.now();
      // The chart's clock until the engine's first frame; the engine's audio session schedules a NONSTOP chart's fades.
      if (this.audioContext) this.audioContextStartTime = this.audioContext.currentTime;
      // Hand chart playback over to `@be-music/player-engine`'s engine. Fires only after the play-start gate, so the engine's
      // chart-time t=0 lines up with the gate — no double lead-in.
      launchSharedEngine(this);
    });
    this.host?.app.canvas.focus();
  }

  private delaySceneStage(offsetMs: number): Promise<void> {
    return new Promise((resolve) => this.setSceneStageTimeout(resolve, Math.max(0, offsetMs)));
  }

  /** Schedules `callback` after `offsetMs`, tracked so {@link dispose} cancels it. */
  private setSceneStageTimeout(callback: () => void, offsetMs: number): void {
    let handle = 0;
    handle = window.setTimeout(
      () => {
        this.sceneStageTimeouts.delete(handle);
        callback();
      },
      Math.max(0, offsetMs),
    );
    this.sceneStageTimeouts.add(handle);
  }

  /**
   * Pauses or resumes the play, as Space does. For hosts that offer on-screen controls — a touch device has no keyboard
   * to press Space or Escape on.
   */
  public requestTogglePause(): void {
    if (this.disposed || this.exiting) return;
    togglePause(this);
  }

  /**
   * Moves an AUTO play to chart second `seconds` (`seekPlay`): the engine seeks the running play, and the promise resolves
   * once it has (its frames are of the new seek generation). A paused play stays paused there. Other plays ignore it.
   */
  public seek(seconds: number): Promise<void> {
    return seekPlay(this, seconds);
  }

  /** Whether the play is paused (by Space, {@link requestTogglePause}, or the auto-pause on losing focus). */
  public isPaused(): boolean {
    return this.paused;
  }

  /**
   * The replay of this play once the engine has recorded it — also after Escape, which records the play as given up
   * (`play.aborted`) a moment after `onExit` fires. Resolves `undefined` when none arrives within `timeoutMs` (a replay
   * records none).
   */
  public waitForReplay(timeoutMs = 2000): Promise<BeMusicReplay | undefined> {
    if (this.replay !== undefined) return Promise.resolve(this.replay);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.replayWaiters.indexOf(settle);
        if (index >= 0) this.replayWaiters.splice(index, 1);
        resolve(undefined);
      }, timeoutMs);
      const settle = (replay: BeMusicReplay): void => {
        clearTimeout(timer);
        resolve(replay);
      };
      this.replayWaiters.push(settle);
    });
  }

  /** Leaves the play the way Escape does: the theme's fade-out runs, then the host's `onExit` fires. */
  public requestExit(): void {
    beginExitSequence(this, () => {
      interruptSharedEngine(this, 'escape');
      this.sharedEngineAbortController?.abort();
      this.options.onExit?.();
    });
  }

  /** Plays the chart again the way F5 does: the theme's fade-out runs, then the host's `onRestart` fires. */
  public requestRestart(): void {
    beginExitSequence(this, () => {
      interruptSharedEngine(this, 'restart');
      this.sharedEngineAbortController?.abort();
      this.options.onRestart?.();
    });
  }

  /**
   * Toggles the dynamics compressor stack on the audio bus at runtime. Mid-play safe: the bus's `setMode` only re-wires
   * downstream stages, so in-flight `BufferSourceNode`s keep playing through the unchanged `keyMixer` / `bgmMixer`
   * nodes.
   *
   * - `setAudioCompressor(false)` → bus mode `'off'` (every stage bypassed; both mixers connect directly to
   *   destination).
   * - `setAudioCompressor(true)` → bus mode is restored to the architecture the constructor chose
   *   (`audioCompressorMode`, default `'split'`). To switch architectures at runtime use {@link setAudioCompressorMode}
   *   instead.
   *
   * Idempotent and a no-op before `prepareAudio` has run; the constructor's `audioCompressor` option seeds the initial
   * state at mount time.
   */
  public setAudioCompressor(enabled: boolean): void {
    if (!this.audioBus) {
      // Bus will be wired with the right mode the next time `prepareAudio` runs. We can't pre-seed
      // `audioCompressorMode` here either: the constructor option is the source of truth until then.
      return;
    }
    const next = enabled ? this.audioCompressorMode : 'off';
    this.audioBus.setMode(next);
  }

  /**
   * Toggles the auto-pause-on-blur behavior at runtime. Future `visibilitychange` / `blur` events will only auto-pause
   * when `enabled` is true; the auto-RESUME path stays unconditional so a user who blurs (auto-pauses) then disables
   * this option still gets back to play state on the next focus.
   *
   * Idempotent — calling with the same value no-ops.
   */
  public setAutoPauseOnBlur(enabled: boolean): void {
    this.autoPauseOnBlur = enabled;
  }

  /**
   * Switches the compressor architecture between `'split'` (default 3-stage) and `'legacy'` (original
   * single-compressor) at runtime. Mostly useful for the demo's `?compressor=` URL flag and for live A/B comparison
   * while debugging.
   *
   * Calling this while `setAudioCompressor(false)` has the bus in `'off'` mode just remembers the choice — the new
   * architecture will be applied next time compression is re-enabled.
   */
  public setAudioCompressorMode(mode: 'split' | 'legacy'): void {
    this.audioCompressorMode = mode;
    if (this.audioBus && this.audioBus.getMode() !== 'off') {
      this.audioBus.setMode(mode);
    }
  }

  /**
   * Toggle one compressor stage (`'key'` / `'bgm'` / `'master'`) within the split-bus architecture. The stage flag is
   * remembered even when the active mode isn't `'split'` — a future toggle to split mode will pick the user's choice
   * back up.
   *
   * No-op before `prepareAudio` has run; the stage state will be applied via the bus's defaults the next time gameplay
   * mounts.
   */
  public setAudioCompressorStageEnabled(stage: CompressorStage, enabled: boolean): void {
    this.audioBus?.setStageEnabled(stage, enabled);
  }

  /**
   * Sets the user volume of the keysound (`'key'`) or BGM (`'bgm'`) bus, as a linear gain (1 = unity, clamped to
   * `0..2`). Applies live to a running chart; before the audio bus exists the value is kept for when it is built.
   */
  public setAudioVolume(channel: AudioBusChannel, volume: number): void {
    this.audioVolumes[channel] = sanitizeBusVolume(volume);
    this.audioBus?.setBusVolume(channel, volume);
  }

  /**
   * Retunes one compressor (`'key'` / `'bgm'` / `'master'` split stages or `'legacy'`); unspecified fields keep their
   * current value. Applies live to a running chart; before the audio bus exists the tuning is kept for when it is built.
   */
  public setAudioCompressorParams(compressor: TunableCompressor, params: Partial<CompressorParams>): void {
    this.audioCompressorParams[compressor] = { ...this.audioCompressorParams[compressor], ...params };
    this.audioBus?.setCompressorParams(compressor, params);
  }

  /**
   * Begins recording the play (canvas video + bus audio mix) into a WebM Blob. Throws when the play's audio is not up
   * yet, or when the browser doesn't expose `MediaRecorder` / `canvas.captureStream` / a usable codec — UI hosts should
   * surface these failures to the user (the codec case is common on older Safari).
   *
   * Idempotent in the sense that calling while a recording is already active is a no-op (`isRecording()` is the
   * canonical gate hosts should check).
   */
  public startRecording(options: { format?: RecordingFormat } = {}): void {
    if (this.recorder?.isActive()) return;
    if (!this.host || !this.audioContext || !this.audioBus) {
      throw new Error('PlaySession.startRecording: gameplay audio is not ready yet');
    }
    // Recreate the recorder per session — instances are one-shot by design (chunk buffer + audio tap lifecycle), so the
    // host gets a clean blob on every start.
    const host = this.host;
    this.recorder = new GameplayRecorder({
      canvas: host.app.canvas,
      subscribeFrame: (onFrame) => host.onAfterRender(onFrame),
      audioContext: this.audioContext,
      audioOutput: this.audioBus.outputNode,
      format: options.format,
    });
    this.recorder.start();
  }

  /**
   * Ends the active recording and resolves with the assembled Blob plus its MIME type / duration. Resolves with
   * `undefined` when no recording is in progress, so callers can call this unconditionally on chart end / unmount.
   */
  public async stopRecording(): Promise<GameplayRecorderResult | undefined> {
    const recorder = this.recorder;
    if (!recorder) return undefined;
    this.recorder = undefined;
    return recorder.stop();
  }

  public isRecording(): boolean {
    return this.recorder?.isActive() ?? false;
  }

  /**
   * Ends the play: its input, timers, BGA videos, recording, engine and audio (kept until the tail has rung out after a
   * natural end with `preserveAudioTail`), then the BGA textures, released over the next frames, and the per-song state.
   */
  public dispose(options: PlayDisposeOptions = {}): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detachInput();
    this.stopPlay(options);
    const textures = [...this.bgaTextures.values(), ...this.bgaLayerTextures.values()];
    this.bgaTextures.clear();
    this.bgaLayerTextures.clear();
    this.releaseTextures(textures);
    this.clearPlay();
  }

  /**
   * Stops what runs on as the play is disposed: the exit and stage timers, the key flashes, the BGA videos, a
   * recording, the engine, and the audio graph (after its tail with `preserveAudioTail`). The textures stay.
   */
  private stopPlay(options: PlayDisposeOptions): void {
    if (this.exitFadeOutHandle !== undefined) {
      window.clearTimeout(this.exitFadeOutHandle);
      this.exitFadeOutHandle = undefined;
    }
    if (this.exitCloseHandle !== undefined) {
      window.clearTimeout(this.exitCloseHandle);
      this.exitCloseHandle = undefined;
    }
    for (const timeout of this.sceneStageTimeouts) {
      window.clearTimeout(timeout);
    }
    this.sceneStageTimeouts.clear();
    if (this.chartEndTimeout !== undefined) {
      window.clearTimeout(this.chartEndTimeout);
      this.chartEndTimeout = undefined;
    }
    for (const timeout of this.keyFlashTimeouts) {
      window.clearTimeout(timeout);
    }
    this.keyFlashTimeouts.clear();
    log.info('listeners detached');
    disposeBGAVideos(this);
    // Hard-stop any active recording before tearing down the bus. `GameplayRecorder.dispose` calls
    // `MediaRecorder.stop()` synchronously (no chunk-flush wait) and disconnects its audio tap from the bus's output
    // node, so the bus can be disposed cleanly afterwards.
    this.recorder?.dispose();
    this.recorder = undefined;
    stopSharedEngine(this);
    disposePlayAudio(this, options);
  }

  /**
   * Destroys `textures` a few per frame on the host's ticker (a macrotask loop without one), all at once when the host
   * itself is going: a sync sweep over a play's textures stalls the next scene's first frames on lower-end devices.
   */
  private releaseTextures(textures: readonly (Texture | undefined)[]): void {
    try {
      releaseTexturesOnHost(this.host, textures);
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
  }

  /**
   * Drops the large per-song reference holders. Async gates and cancelled browser decode tasks can retain the play for
   * a little while after `dispose()` returns; clearing these keeps that short tail from pinning a full chart bundle,
   * decoded PCM and BGA timelines.
   */
  private clearPlay(): void {
    this.decodedSamples.clear();
    this.bmsonSlicePlayback = undefined;
    this.autoSampleTriggers = [];
    this.pressedChannels.clear();
    this.lanePressedAt.clear();
    this.laneReleasedAt.clear();
    this.longNotes.clear();
    this.longNoteStyle = undefined;
    this.judgeWindows = undefined;
    this.keyBeamStartedAt.clear();
    this.bombStartedAt.clear();
    this.bombJudge.clear();
    this.keyBeamFadeStartedAt.clear();
    this.wavCmdVolumeMultipliers.clear();
    this.switchingBGAs.clear();
    this.bgaSubRegionOrigins.clear();
    this.playState = createPlayState();
    this.notes = [];
    this.mineNotes = [];
    this.invisibleNotes.length = 0;
    this.preparedChart = undefined;
    this.engineFrame = undefined;
    this.touchTokenByChannel = undefined;
    this.resolvedChart = undefined;
    this.resolvedPlayChart = undefined;
    this.randomDraws = undefined;
    this.beatAtSeconds = undefined;
    this.scrollMapper = undefined;
    this.timingResolver = undefined;
    this.bgaTimeline = { base: [], layer: [], poor: [] };
    this.laneChannels = [];
    this.laneX.clear();
    this.poorBGAFallbackKey = undefined;
    this.poorBGAFallbackUntilSeconds = Number.POSITIVE_INFINITY;
    this.hasBGA = false;
    this.bgaReadyPromise = undefined;
    this.chart = undefined;
    this.source = undefined;
    this.host = undefined;
  }

  /**
   * The gauge this run actually plays on. A replay restores the recorded pick so the played-back run judges, drains,
   * and clears exactly as the original did; otherwise it is the host's selection, defaulting to LR2 GROOVE.
   */
  resolveSelectedGauge(): GaugeType {
    return this.options.replay?.play.gauge ?? this.options.gauge ?? 'GROOVE';
  }

  /**
   * Does the ruleset this run judges under show empty POORs inside its POOR counter? LR2 does; beatoraja shows a
   * figure of its own, and IIDX's counter is unmeasured, so both keep them apart.
   */
  resolveEmptyPoorCountsInPoorDisplay(): boolean {
    const ruleset = this.options.replay?.play.judgeRuleset ?? this.options.judgeRuleset ?? 'lr2';
    return ruleset === 'lr2';
  }

  /** The compat ruleset judging the play (a replay's recorded one wins). */
  resolveJudgeRuleset(): string {
    return this.options.replay?.play.judgeRuleset ?? this.options.judgeRuleset ?? 'lr2';
  }

  /** Whether the engine plays `channel`'s notes itself: every lane under autoplay, the scratch under auto-scratch. */
  isAutoplayedChannel(channel: string): boolean {
    return this.options.autoPlay === true || this.autoScratchChannels.has(channel);
  }

  /** True while the wall-clock playhead is still inside the intro buffer. */
  isIntroPlaying(): boolean {
    if (this.startTime === 0) {
      return true;
    }
    return performance.now() < this.startTime;
  }

  /**
   * The tempo the BPM readouts show at `seconds`. Past an LR2 negative-BPM reversal (issue #134) it holds the value at
   * the reversal — LR2's frozen event pump never applies a later BPM event — even though the reverse scroll itself
   * keeps following the forward tempo map.
   */
  nowBPM(seconds: number): number | undefined {
    const resolver = this.timingResolver;
    if (!resolver) return undefined;
    // `displayBPMAtBeat`: a negative `#BPMxx` reads as |trunc(BPM)|, LR2's int NOWBPM.
    return resolver.displayBPMAtBeat(
      this.currentBeat(Math.min(seconds, resolver.reversal?.seconds ?? Number.POSITIVE_INFINITY)),
    );
  }

  /**
   * The BPM the readouts (NOWBPM, the HUD) show at `seconds`: for a stitched NONSTOP chart, whose scroll runs at a
   * constant 150 BPM, the BPM of the stage being played, scaled by its FIT rate (`NonstopStitchMap.tempo`), as LR2
   * shows it; otherwise {@link nowBPM}.
   */
  displayBPM(seconds: number): number | undefined {
    const tempo = this.options.nonstop?.tempo;
    return tempo !== undefined && tempo.length > 0 ? nonstopBPMAt(tempo, seconds) : this.nowBPM(seconds);
  }

  /**
   * The song's beat at `seconds`, from the BPM- and STOP-aware tempo map: charts change tempo mid-song (`#BPM`), and
   * the initial BPM alone would drift notes after a change out of sync with the audio.
   */
  currentBeat(seconds: number): number {
    // LR2 negative-BPM reversal (issue #134): past the first negative `#BPMxx` the chart *visually* scrolls backwards.
    // LR2 mirrors the chart POSITION around the reversal (`2 * pos(R) - pos(now)`), so the reverse scroll runs at the
    // post-reversal |BPM| and pauses through post-reversal STOPs. Every display consumer — renderNotes, measure
    // lines, beatPhase — funnels through this method, so mirroring here covers them all; the forward beat underneath
    // keeps `beatAtSeconds`'s monotonic stop-window cursor intact.
    return mirrorBeatAtTempoReversal(this.timingResolver?.reversal, seconds, this.forwardBeat(seconds));
  }

  private forwardBeat(seconds: number): number {
    // Prefer the proper STOP-aware resolver (built once per song in `prepareChart`). Falls back to a flat-BPM
    // extrapolation when the resolver isn't ready yet (very early frames during mount).
    const resolver = this.timingResolver;
    if (this.beatAtSeconds && resolver && resolver.tempoPoints.length > 0) {
      return this.beatAtSeconds(seconds);
    }
    if (!resolver || resolver.tempoPoints.length === 0) {
      const bpm = this.chart?.bpm ?? 130;
      return Math.max(0, seconds * (bpm / 60));
    }
    let active = resolver.tempoPoints[0]!;
    for (const point of resolver.tempoPoints) {
      if (point.seconds <= seconds) {
        active = point;
      } else {
        break;
      }
    }
    return Math.max(0, active.beat + ((seconds - active.seconds) * active.bpm) / 60);
  }

  /** Uploads `textures` to the GPU through the view (the BGA the session loaded), so the first cue does not stall. */
  preparePixiUpload(textures: Iterable<Texture | undefined>): Promise<void> {
    return this.theme.uploadTextures?.(textures) ?? Promise.resolve();
  }

  readonly handleVisibilityChange = (): void => handleVisibilityChange(this);

  readonly handleWindowBlur = (): void => handleWindowBlur(this);

  readonly handleWindowFocus = (): void => handleWindowFocus(this);

  readonly focus = (): void => {
    this.app.canvas.focus();
  };

  /** Holding Backspace for `QUIT_HOLD_THRESHOLD_MS` leaves the play the way Escape does. */
  readonly quitHold: QuitHoldController = new QuitHoldController({
    onComplete: () => this.requestExit(),
    now: () => performance.now(),
  });

  readonly handleQuitHoldKeyUp = (event: KeyboardEvent): void => {
    this.quitHold.handleKeyUp(event);
  };

  readonly cancelQuitHold = (): void => {
    this.quitHold.cancel();
  };

  readonly handleSharedEngineExitKey = (event: KeyboardEvent): void => handleSharedEngineExitKey(this, event);

  /**
   * Sets the hi-speed from the host (e.g. a settings menu) during the play. `value` is on the scale of
   * {@link PlaySessionOptions.initialHiSpeed}: the chart's HS-FIX multiplier is applied on top, as at the start.
   * Snapped and clamped like the in-game hotkey; non-finite values are ignored.
   */
  public setHiSpeed(value: number): void {
    applyPlayEvent(this, { type: 'hi-speed-set', value });
  }

  /**
   * Pause-aware monotonic clock used by every "time since X" animation of the play (LR2 timer keyframes,
   * scratch-disc rotation, bomb / FC / POOR-BGA windows, NOWJUDGE / NOWCOMBO decay, …). Returns wall clock minus the
   * accumulated pause duration, and freezes at `pauseTime - pauseTotal` while the play is paused. Seed sites that
   * drive these animations store `playClock()` values, and the read sites compute `playClock() - seed` — so animations
   * resume exactly where they left off rather than jumping forward by the pause duration.
   */
  playClock(): number {
    if (this.paused) {
      return this.pauseTime - this.pauseTotal;
    }
    return performance.now() - this.pauseTotal;
  }

  /**
   * Pauses every BGA video element in the chart's video pool. The `<video>` element doesn't honor the audio-context
   * suspend, so without this the video keeps playing during a pause overlay.
   */
  pauseAllBGAVideos(): void {
    for (const handle of this.bgaVideos.values()) {
      if (!handle.video.paused) {
        handle.video.pause();
      }
    }
  }

  /**
   * Resumes only the videos tied to currently-active base / layer cues. Avoids touching videos that were paused for a
   * different reason (e.g. an earlier cue switched away from them in `syncBGAVideo`).
   */
  resumeActiveBGAVideos(): void {
    for (const track of ['base', 'layer'] as const) {
      const active = this.bgaActiveVideos[track];
      if (!active) continue;
      const handle = this.bgaVideos.get(active.key);
      if (!handle || !handle.video.paused) continue;
      void handle.video.play().catch(() => {
        // Autoplay-policy / codec rejections — ignore silently.
      });
    }
  }

  /**
   * Lerps the displayed score toward the real score so the SCORE panel rolls up after each judgement instead of
   * jumping. Speed is tuned so a single PERFECT (~1000 score) catches up in ~6 frames at 60 fps.
   */
  updateDisplayedScore(): void {
    const target = this.score.score;
    if (this.displayedScore === target) {
      return;
    }
    const diff = target - this.displayedScore;
    if (Math.abs(diff) < 1) {
      this.displayedScore = target;
      return;
    }
    // Frame-rate independent ease: cover ~30 % of remaining distance per frame.
    const next = this.displayedScore + diff * 0.3;
    this.displayedScore = diff > 0 ? Math.min(next, target) : Math.max(next, target);
  }

  /**
   * The play as a result so far ({@link PlayResult}): read off the play state, a plain object a result
   * screen that outlives the play can keep. `undefined` before a chart is prepared.
   */
  public getResultData(): PlayResult | undefined {
    return getResultData(this);
  }

  /**
   * The chart second the play is at now. The engine owns chart time: each of its frames carries the second it shows and
   * the audio-clock reading that second holds at (`chartSecondsFromFrame`), so the playfield runs on from the latest
   * frame on `audioContext.currentTime` — bit-exact with the scheduled sounds, through pauses, tempo changes and seeks.
   * Before the engine's first frame, the chart runs from the play-start gate at the play's tempo (audio clock, else wall
   * clock while the audio context is not up).
   */
  currentSeconds(): number {
    const context = this.audioContext;
    const frame = this.engineFrame;
    if (context !== undefined && frame !== undefined) {
      const seconds = chartSecondsFromFrame(frame, context.currentTime);
      if (seconds !== undefined) return seconds;
    }
    if (context !== undefined && this.audioContextStartTime > 0) {
      return (context.currentTime - this.audioContextStartTime) * this.tempo;
    }
    const nowMs = this.paused ? this.pauseTime : performance.now();
    return ((nowMs - this.startTime - this.pauseTotal) / 1000) * this.tempo;
  }

  /** The play tempo in force: the one the play started at, or the last change. */
  public getTempo(): number {
    return this.tempo;
  }

  /** The player's hi-speed in force (on the scale of `initialHiSpeed`), a replay's recorded one included. */
  public getHiSpeed(): number {
    return this.playState.view.hiSpeed.player;
  }

  /**
   * Changes the play tempo during the play (clamped by `clampPlayTempo`). Only in `pitch` mode: the samples follow it
   * through their playback rate, playing ones included, and so do the BGA videos and a NONSTOP chart's fades. Keep
   * pitch stretched the samples to the tempo they loaded at, and a replay follows its log, so both refuse it. The
   * engine applies it at the chart time it takes the command and records it in the replay; the view follows from the
   * chart second the engine reports. Returns whether the change was taken.
   */
  public setTempo(tempo: number): boolean {
    return !this.disposed && this.liveTempo.request(tempo);
  }

  /**
   * Milliseconds since the chart's first beat for chrome count-ins. Before the play-start gate opens (`startTime` is
   * still +Infinity) it counts toward the scheduled intro end and holds just below zero if the BGA preload runs long.
   */
  resolveChartMs(): number | undefined {
    if (this.startTime === 0) return undefined;
    if (Number.isFinite(this.startTime)) return this.currentSeconds() * 1000;
    return Math.min(-1, this.playClock() - this.sceneStartTime - this.scheduledIntroMs);
  }

  /** The lane covers each play side shows (`resolveLaneCovers` in `play-view-settings.ts`), for the playfield and chrome. */
  resolveLaneCovers(): readonly BeMusicLaneCover[] {
    return resolveLaneCovers(this);
  }

  /** How long a note stays visible below `cover` (`resolveVisibleMs` in `play-view-settings.ts`), for the chrome. */
  resolveVisibleMs(
    cover: BeMusicLaneCover | undefined,
    bpm: number | undefined,
    scrollRate: number,
  ): number | undefined {
    return resolveVisibleMs(this, cover, bpm, scrollRate);
  }

  /** Approximate total duration of the loaded chart in seconds. */
  resolveChartDurationSeconds(): number {
    if (!this.chart) {
      return 0;
    }
    return this.chartDurationSeconds;
  }

  /**
   * The mode a long note plays in: the one the engine announced while it is held, otherwise worked out from the
   * ruleset's long-note style (unknown until the engine reports its ruleset).
   */
  resolveLongNoteMode(note: RuntimeNote): BeMusicLongNote['mode'] {
    const held = this.longNotes.heldMode(note.channel, note.beat);
    if (held !== undefined) return held;
    return this.longNoteStyle === undefined
      ? undefined
      : resolveBeMusicLongNoteMode(this.longNoteStyle, note.longNoteMode);
  }
}
