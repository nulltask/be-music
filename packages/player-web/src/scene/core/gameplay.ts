import { Application, Texture, VideoSource } from 'pixi.js';
// Side-effect import: registers Pixi's `PrepareSystem` on the renderer so {@link CoreGameplayView.preparePixiUpload}
// can drive eager GPU uploads. Pixi v8 deliberately ships the prepare module out of the default bundle (it's a
// large optional system that not every app needs); the import has to land before any `Application.init` runs that
// expects `renderer.prepare` to exist.
import 'pixi.js/prepare';
import { mirrorBeatAtTempoReversal, type TimingResolver } from '@be-music/audio-renderer/triggers';
import {
  createTempoClock,
  PlayerInterruptedError,
  type PlayerSummary,
  type PlayerTempoChange,
  type TempoClock,
} from '@be-music/player/core/engine';
import { resolveLr2LaneTimer } from '@be-music/lr2-skin/state';
import { resolveClearLamp, resolveDisplayedPoor, type GaugeType, type JudgeKind } from '@be-music/player/ruleset';
import type { PlayerRulesetInfo } from '@be-music/player/core/engine';
import type { PlayerJudgeComboSignalState } from '@be-music/player/state-signals';
import type { PlayerUiCommand, PlayerUiFramePayload } from '@be-music/player/core/ui-signal-bus';
import {
  createPlaylogViewCoalescer,
  DEFAULT_PLAYLOG_VIEW_REPLAY,
  resolveReplayHiSpeed,
  resolveReplayView,
  roundPlaylogView,
  type BeMusicPlaylog,
  type PlaylogViewState,
} from '@be-music/player/playlog';
import type { BrowserSongAssetSource, BrowserSongEntry } from '../../collection/types.ts';
import {
  type AudioBusChannel,
  type CompressorParams,
  type TunableCompressor,
  type CompressorStage,
  sanitizeBusVolume,
} from '../../runtime/audio-bus.ts';
import { GameplayRecorder, type GameplayRecorderResult } from '../../recording/gameplay-recorder.ts';
import type { RecordingFormat } from '../../recording/recording-format.ts';
import { toBeMusicJudgeWindows } from './judge-windows.ts';
import { resolveBeMusicLongNoteMode } from './long-note-tracker.ts';
import { advanceCourseCombo } from './course-combo.ts';
import { nonstopBpmAt } from '@be-music/player/course';
import { LiveTempo } from '../live-tempo.ts';
import {
  chartToElapsedSeconds,
  clampPlayTempo,
  resolveReplayTempo,
  setVideoPlaybackTempo,
  supportsLiveTempoChange,
  type ReplayTempo,
} from '../../runtime/play-tempo.ts';
import { fillLaneCover, resolveHiSpeedForVisibleMs, resolveNoteVisibleMs } from './lane-cover.ts';
import { BE_MUSIC_HI_SPEED_SCALE, PlaylogViewCursor } from '../playlog-view.ts';
import type { PixiScene, PixiSceneHost } from '../host.ts';
import type { SceneIdentity } from '../../host/family-kit.ts';
import { staggerDestroyTextures } from '../pixi-utils.ts';
import { runEngineDriver } from '../../runtime/engine-driver.ts';
import { drainWebUiSignals, type WebUiRuntimeCallbacks } from '../../runtime/web-ui-runtime.ts';
import type { BeMusicJson } from '@be-music/json';
import {
  BG,
  BGA,
  DESIGN_HEIGHT,
  DESIGN_WIDTH,
  HISPEED_STEP,
  FALLBACK_INTRO_DELAY_MS,
  PIXELS_PER_BEAT,
} from '../gameplay-constants.ts';
import { snapHiSpeed, stepPlayerHiSpeed } from '../hi-speed.ts';
import { resolveLr2LaneIndex, resolveSideRelativeLaneIndex } from '../gameplay-lanes.ts';
import { resolveGameplayAudioTailCleanupDelayMs } from './gameplay-result-delay.ts';
import { resolvePlayEnding } from '../play-ending.ts';
import type { BeMusicGameplayLayout, BeMusicJudge, BeMusicLaneCover, BeMusicStage } from '../../skin/be-music/types.ts';
import { resolveBeMusicLaneKind } from '../../skin/be-music/registry.ts';
import {
  resolveGameplayLayout,
  resolveStageOrientation,
  type BeMusicLongNote,
  type GameplayLayoutMode,
} from '@be-music/skin-sdk';
import { BeMusicGameplayBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import { PHANTOM_BOMB_DURATION_MS } from '../../skins/phantom/playfield.ts';
import {
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
} from './viewport.ts';
import type { PixiGameplayResultData } from './result-data.ts';
import {
  canvasPointToDesign,
  hitTestTouchLane,
  isTouchPlayPointer,
  resolveTouchLaneZones,
  type TouchLaneChange,
} from './touch-lanes.ts';
import { logger } from '../../logger.ts';
import { QUIT_HOLD_KEY_CODE, QuitHoldController } from '../quit-hold.ts';
import { isChannelOnSide, prepareSong } from '../../session/play/play-chart.ts';
import {
  disposeGameplayAudioGraphAfterDelay,
  prepareAudio,
  prepareBga,
  samplePlaybackRate,
} from '../../session/play/play-media.ts';
import { resolveLaneGeometry, resolveSkinlessGameplayChromeRuntime } from '../../view/built-in/play-chrome.ts';
import { renderBga } from '../../view/shared/bga-renderer.ts';
import { renderBombEffects, renderBombs } from '../../view/shared/playfield/bombs.ts';
import type { RuntimeNote } from '../../view/shared/playfield/context.ts';
import { renderLanes } from '../../view/shared/playfield/lanes.ts';
import { renderNotes } from '../../view/shared/playfield/notes.ts';
import { renderShutter } from '../../view/shared/playfield/shutter.ts';
import { renderText } from '../../view/shared/playfield/text.ts';
import type {
  GameplayBgaTarget,
  GameplayLaneRect,
  GameplayMeasureLineFrame,
  GameplayStageSize,
  GameplayThemeEvent,
  GameplayThemeHooks,
  GameplayThemeNoteCell,
  GameplayThemeNoteKind,
  GameplayThemeTiming,
} from './gameplay-theme.ts';
import type { CoreGameplayDisposeOptions, CoreGameplayViewOptions } from './gameplay-options.ts';
import { CoreGameplayState } from './gameplay-state.ts';

export type { CoreGameplayDisposeOptions, CoreGameplayViewOptions } from './gameplay-options.ts';
export type {
  GameplayBgaTarget,
  GameplayLaneRect,
  GameplayMeasureLineFrame,
  GameplayStageSize,
  GameplayThemeEvent,
  GameplayThemeNoteCell,
  GameplayThemeNoteKind,
  GameplayThemeTiming,
} from './gameplay-theme.ts';

const log = logger('gameplay');

const IDENTITY: SceneIdentity = { kind: 'play', family: 'built-in' };

/** Design px above a lane's top through which notes keep drawing as they scroll in (standard layout). */
const NOTE_OVERSCAN = 48;

/**
 * Fallback lane-laser release fade duration in ms. Themes can author a per-lane span through
 * {@link CoreGameplayView.resolveKeyOnFadeMs} (the LR2 family derives it from the skin's key-on keyframes); this
 * constant kicks in when a key-on slot has no themed span (skinless mode, or a slot the skin doesn't author). 120 ms
 * matches the LR2 default skin's typical key-on keyframe span and is a perceptually comfortable decay for auto-judge
 * feedback.
 */
export const KEY_ON_FADE_OUT_MS = 120;

/**
 * "Fully on" hold time before {@link CoreGameplayView.flashKeyOnTimer} hands the lane laser to the release-fade path.
 * Without this hold the sprite would only stay at peak alpha for the first frame (≈16 ms at 60 fps) before the fade
 * tween kicked in, which made auto-judged short-note flashes look like a single-frame blink. ~60 ms is enough to
 * register visually as a deliberate "tap" without lingering through the next note.
 */
const KEY_ON_FLASH_HOLD_MS = 60;

/** Default-family BGA rect: the fixed {@link BGA} square, drawn opaque and untinted. */
const DEFAULT_BGA_TARGET: GameplayBgaTarget = createDefaultBgaTarget(BGA);

function createDefaultBgaTarget(rect: { x: number; y: number; w: number; h: number }): GameplayBgaTarget {
  return {
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    noBase: false,
    noLayer: false,
    noPoor: false,
    applyToSprite: (sprite) => {
      sprite.alpha = 1;
      sprite.tint = 0xffffff;
      sprite.blendMode = 'normal';
    },
  };
}

/** The LR2-compatible 640x480 canvas. */
const LEGACY_STAGE_SIZE: GameplayStageSize = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };
/** The 640x480 stage with the fixed default-family BGA square, for skins that declare no stage of their own. */
const LEGACY_STAGE: BeMusicStage = { ...LEGACY_STAGE_SIZE, resolveBgaRect: () => ({ ...BGA }) };

const DEFAULT_THEME_TIMING: GameplayThemeTiming = {
  loadEndOffsetMs: 0,
  playStartOffsetMs: 0,
  fadeOutMs: 0,
  closeMs: 0,
};

/**
 * Scene transitions for be-music skins: the play screen fades up from black as it appears (every select outro ends
 * dark) and fades back to black, with the audio, before the result or select screen takes over — instead of cutting
 * in and out mid-animation.
 */
const BE_MUSIC_ENTER_FADE_MS = 400;
const BE_MUSIC_THEME_TIMING: GameplayThemeTiming = { ...DEFAULT_THEME_TIMING, fadeOutMs: 450 };

/**
 * Family-neutral gameplay scene: engine driver, input, judging, Web Audio, BGA compositing, lane geometry, note / LN /
 * bomb / lane drawing through the be-music skin, skinless chrome, pause / restart / exit, recording, and result data.
 *
 * Theme families (the LR2 family's `PixiGameplayView`) extend this class and override the `protected` theme hooks —
 * `prepareTheme`, `renderThemeLayer`, `collectBgaTargets`, `resolveThemeLaneRect`, `resolveThemeNoteCell`,
 * `renderThemeMeasureLines`, `renderThemeText`, `renderBombEffects`, `themeTiming`, `onThemeEvent`, … — each of which
 * defaults to the skinless behaviour, so the class paints a complete scene on its own.
 *
 * The play's parts live in their own modules (`session/play/*`, `view/shared/*`, `view/built-in/*`), which take the
 * scene as their context and read and write its state through their own interfaces (`PlayChartContext`,
 * `PlayfieldContext`, …). The state lives in {@link CoreGameplayState}, which the scene extends; it has no `private` /
 * `protected` modifier so the scene satisfies those interfaces, and it is not part of the scene's API. The theme hooks
 * stay `protected`; the modules call them through {@link theme}.
 */
export class CoreGameplayView<TOptions extends CoreGameplayViewOptions = CoreGameplayViewOptions>
  extends CoreGameplayState
  implements PixiScene
{
  /**
   * The play tempo in force ({@link CoreGameplayViewOptions.tempo}, or a replay's recorded one, then every live change):
   * chart seconds per clock second.
   */
  tempo: number;
  /** The tempo a replay plays at and the changes it follows (`resolveReplayTempo`). */
  readonly replayTempo: ReplayTempo | undefined;
  /**
   * The play tempo over the view's clock (seconds since `audioContextStartTime`, in ms): re-anchored at the chart second
   * of every change the engine reports, so the view's chart time stays the engine's.
   */
  tempoClock: TempoClock;
  /** The live tempo changes asked for ({@link setTempo}), pushed to the engine (held until its input bus is up). */
  readonly liveTempo: LiveTempo;
  readonly options: TOptions;

  public constructor(options: TOptions = {} as TOptions) {
    super();
    this.options = options;
    this.beMusicSkinSettings = options.beMusicSkinSettings;
    // A replay plays back at the tempo it was played at, unless its viewer keeps their own (`replayView.tempo`).
    this.replayTempo =
      options.replay !== undefined
        ? resolveReplayTempo(options.replay.play, {
            ownTempo: options.tempo,
            pitchMode: options.tempoPitchMode ?? 'pitch',
            // The recorded tempo timeline only when the viewer's replay options reproduce the tempo (default on).
            reproduce: (options.replayView ?? DEFAULT_PLAYLOG_VIEW_REPLAY).tempo,
          })
        : undefined;
    this.tempo = this.replayTempo?.tempo ?? clampPlayTempo(options.tempo);
    this.tempoClock = createTempoClock(this.tempo);
    // Only in pitch mode (kept pitch stretched the samples to the tempo they loaded at), and not for a replay.
    this.liveTempo = new LiveTempo(
      this.tempo,
      options.replay === undefined && supportsLiveTempoChange(options.tempoPitchMode ?? 'pitch'),
    );
    if (options.initialHiSpeed !== undefined && Number.isFinite(options.initialHiSpeed)) {
      // Snap to the same 1/1000 grid `adjustHiSpeed` uses so a host-supplied `1.5000000000000002` (the obvious
      // float-drift failure mode of repeated +0.1 steps) lands on the canonical grid value the in-game adjust hotkey
      // would produce.
      this.hiSpeed = snapHiSpeed(options.initialHiSpeed) ?? this.hiSpeed;
      this.playerHiSpeed = this.hiSpeed;
      this.scrollHiSpeed.jump(this.hiSpeed);
    }
    this.autoPauseOnBlur = options.autoPauseOnBlur ?? false;
    this.audioVolumes = {
      key: sanitizeBusVolume(options.audioVolumes?.key ?? 1),
      bgm: sanitizeBusVolume(options.audioVolumes?.bgm ?? 1),
    };
    this.audioCompressorParams = { ...options.audioCompressorParams };
  }

  public get identity(): SceneIdentity {
    return IDENTITY;
  }

  /**
   * Convenience accessor for the host's `Application`. Throws if called before {@link prepare} / {@link enter}; this is
   * intentional — every code path that touches `this.app` runs after one of them.
   */
  get app(): Application {
    if (!this.host) {
      throw new Error('CoreGameplayView: app accessed before prepare / enter');
    }
    return this.host.app;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Theme hooks. Each default is the skinless behaviour; theme families (the LR2 family's `PixiGameplayView`) override
  // the ones they need. They run on the scene's own schedule — see the call sites for the exact ordering.
  // ---------------------------------------------------------------------------------------------------------------

  /**
   * Adds theme-owned sub-layers (e.g. a bitmap-text container inside `skinLayer`) during {@link prepare}, before the
   * scene graph is assembled. Default: nothing.
   */
  protected attachThemeLayers(): void {}

  /**
   * Loads theme assets (textures, fonts, timing spans, …) right after the song is prepared and before audio decoding
   * starts. Implementations should bail out early once {@link disposed} flips. Default: nothing to load.
   */
  protected async prepareTheme(): Promise<void> {}

  /** Intro gates and exit fade / close lengths the scene should follow. Default: all zero (skinless timing). */
  protected get themeTiming(): GameplayThemeTiming {
    return this.paintsThroughBeMusicSkin ? BE_MUSIC_THEME_TIMING : DEFAULT_THEME_TIMING;
  }

  /** Whether the scene paints through a be-music skin (rather than a theme or a host chrome renderer). */
  private get paintsThroughBeMusicSkin(): boolean {
    return this.options.beMusicSkin !== undefined && this.options.skinlessChromeRenderer === undefined;
  }

  /**
   * Notified at scene moments a theme animates against (scene stages, exit phases, judgements, full combo, gauge
   * changes, bombs, lane commands). Default: ignored.
   */
  protected onThemeEvent(_event: GameplayThemeEvent): void {}

  /** Per-frame theme bookkeeping that must run before {@link render} (e.g. LR2 ops / turntable). Default: nothing. */
  protected updateThemeState(): void {}

  /**
   * Pushes the rectangles the chart's BGA should be composited into this frame. Default: the fixed default-family BGA
   * rect. Pushing nothing hides the BGA for the frame.
   */
  protected collectBgaTargets(out: GameplayBgaTarget[]): void {
    const stage = this.beMusicStage;
    if (!stage) {
      out.push(DEFAULT_BGA_TARGET);
      return;
    }
    const geometry = resolveLaneGeometry(this);
    // The landscape touch layout gives the BGA's room to the lanes.
    if (geometry.mode === 'touch' && geometry.orientation === 'landscape') return;
    const rect = stage.resolveBgaRect(geometry.right);
    const cached = this.stageBgaTarget;
    if (cached && cached.x === rect.x && cached.y === rect.y && cached.w === rect.w && cached.h === rect.h) {
      out.push(cached);
      return;
    }
    this.stageBgaTarget = createDefaultBgaTarget(rect);
    out.push(this.stageBgaTarget);
  }

  /**
   * Design canvas the scene renders into. The be-music path uses its skin's {@link BeMusicSkin.stage} (16:9 for the
   * built-in skins); a host-supplied `skinlessChromeRenderer` and themes keep the LR2-compatible 640x480.
   */
  protected get stageSize(): GameplayStageSize {
    return this.beMusicStage ?? LEGACY_STAGE_SIZE;
  }

  /**
   * The layout mode in effect: `'touch'` only when asked for and the be-music skin's own stage is painted (a host chrome
   * renderer or theme brings its own geometry). The play mode may still fall back to standard — see
   * {@link resolveLaneGeometry}.
   */
  get layoutMode(): GameplayLayoutMode {
    return this.options.layoutMode === 'touch' && this.beMusicStage !== undefined ? 'touch' : 'standard';
  }

  /**
   * How far above a lane's top notes still draw while they scroll in. The standard lanes start at the stage's top edge,
   * so notes enter from off-stage; the touch and portrait lanes start below the skin's header band (or the BGA and HUD
   * above them), so notes there appear at the lane top instead of drawing over the chrome.
   */
  get noteOverscan(): number {
    return this.layoutMode === 'touch' || resolveStageOrientation(this.stageSize) === 'portrait' ? 0 : NOTE_OVERSCAN;
  }

  /**
   * The be-music skin's stage while the scene paints through it, otherwise `undefined`: its portrait stage while the
   * screen is upright and the chart fits a portrait playfield, its landscape stage otherwise. Read every frame, so a
   * rotation mid-play re-lays the screen out on the next frame.
   */
  get beMusicStage(): BeMusicStage | undefined {
    if (this.options.skinlessChromeRenderer) return undefined;
    const skin = this.options.beMusicSkin;
    if (!skin) return undefined;
    const screen = this.host?.app.screen;
    return resolveBeMusicSkinStage(skin, screen && screen.width > 0 && screen.height > 0 ? screen : undefined, {
      laneChannels: this.laneChannels,
      playVariant: this.chartPlayVariant,
    });
  }

  /**
   * When true the theme draws the lane backgrounds / beams and the bombs itself, so the scene skips its be-music-skin
   * versions (lane geometry is still computed for notes and shutters). Default: false.
   */
  protected get themeOwnsPlayfield(): boolean {
    return false;
  }

  /**
   * Theme-authored rect for `channel`'s lane in design pixels (`width` / `height` are the design canvas), or
   * `undefined` to use the default-family layout for that channel. Default: `undefined`.
   */
  protected resolveThemeLaneRect(_channel: string, _width: number, _height: number): GameplayLaneRect | undefined {
    return undefined;
  }

  /**
   * Theme sprite cell for one note part on the given LR2-spec lane index, or `undefined` when the theme doesn't author
   * the slot (the scene then draws its own). See {@link GameplayThemeNoteCell} for the `texture: undefined` case.
   * Default: `undefined`.
   */
  protected resolveThemeNoteCell(_kind: GameplayThemeNoteKind, _laneIndex: number): GameplayThemeNoteCell | undefined {
    return undefined;
  }

  /**
   * Draws the measure lines for this frame into `noteLayerPool` and returns true, or returns false to let the scene
   * draw its fallback bar. Default: false.
   */
  protected renderThemeMeasureLines(_frame: GameplayMeasureLineFrame): boolean {
    return false;
  }

  /**
   * Late-frame theme pass, run after the bombs and inside the `textLayerPool` begin / end bracket (e.g. a fallback
   * judge string). Default: nothing.
   */
  protected renderThemeText(_seconds: number): void {}

  /** How long the bomb on `channel` stays alive, in ms. Default: the be-music skin's own effect length. */
  protected resolveBombDurationMs(_channel: string): number {
    return this.skinBinding?.bombDurationMs ?? PHANTOM_BOMB_DURATION_MS;
  }

  /** Release-fade span in ms for key-on timer `timerId` (100..119). Default: {@link KEY_ON_FADE_OUT_MS}. */
  protected resolveKeyOnFadeMs(_timerId: number): number {
    return KEY_ON_FADE_OUT_MS;
  }

  /**
   * Releases theme-owned per-view state during {@link dispose}. Returned textures are destroyed together with the
   * scene's own (after {@link textures} and the BGA textures). Default: nothing to release.
   */
  protected disposeTheme(): Iterable<Texture | undefined> {
    return [];
  }

  /**
   * The theme hooks above, for the modules the scene's parts live in (`view/shared/playfield/*`, …): the hooks stay
   * `protected` for the theme families that override them, so the modules call them through this object.
   */
  readonly theme: GameplayThemeHooks = {
    themeTiming: () => this.themeTiming,
    stageSize: () => this.stageSize,
    themeOwnsPlayfield: () => this.themeOwnsPlayfield,
    resolveThemeLaneRect: (channel, width, height) => this.resolveThemeLaneRect(channel, width, height),
    resolveThemeNoteCell: (kind, laneIndex) => this.resolveThemeNoteCell(kind, laneIndex),
    renderThemeMeasureLines: (frame) => this.renderThemeMeasureLines(frame),
    renderThemeText: (seconds) => this.renderThemeText(seconds),
    renderBombEffects: () => this.renderBombEffects(),
    resolveBombDurationMs: (channel) => this.resolveBombDurationMs(channel),
    resolveKeyOnFadeMs: (timerId) => this.resolveKeyOnFadeMs(timerId),
    collectBgaTargets: (out) => this.collectBgaTargets(out),
    onThemeEvent: (event) => this.onThemeEvent(event),
  };

  /**
   * Loads the play: parses the chart, and decodes every audio sample the chart references — the slow part of going from
   * "song picked" to "gameplay can begin". It attaches nothing to the stage and no listeners, so a Decide splash can
   * show while it runs; the host then shows the scene ({@link enter}) and calls {@link start}. Run while the scene is
   * already showing (a play with no splash), it draws the playfield in its loading state as assets decode instead.
   *
   * Returns once chart audio is decoded (timer / chart-start scheduling is deferred to {@link start}). BGA preload runs
   * concurrently and is allowed to land mid-play; the playfield is up by the time `start()` fires regardless.
   */
  public async prepare(host: PixiSceneHost, song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<void> {
    this.build(host);
    this.song = song;
    this.source = source;
    // Hidden until {@link start} fires, so a scene shown before the play begins draws nothing of it yet.
    this.root.visible = false;
    this.assetsLoading = true;
    prepareSong(this, song);
    if (this.entered) {
      // No splash covers the load window: hold the chart clock before its start (see `start()`) and draw the loading
      // playfield while assets decode, instead of a blank stage.
      this.startTime = Number.POSITIVE_INFINITY;
      this.root.visible = true;
      this.startAnimationLoop();
    }
    await this.prepareTheme();
    if (this.disposed) return;
    await prepareAudio(this);
    if (this.disposed) return;
    // BGA preload runs IN THE BACKGROUND — `prepare()` resolves here even if `prepareBga()` is still decoding videos.
    // The ffmpeg.wasm fallback for unsupported codecs (e.g. legacy `.mpg`) can take ~tens of seconds, and the user
    // wants the PLAY scene to transition in immediately and play its LR2 LOADING animation during that wait rather than
    // freezing the Decide splash. {@link start} gates the actual chart start (LR2 timer 40 → 41 / op 80 → 81) on
    // `bgaReadyPromise`, so notes still don't begin until the BGA is in place.
    this.bgaReadyPromise = prepareBga(this).catch((error) => {
      log.warn('BGA preload failed; continuing without it', error);
    });
    void this.bgaReadyPromise.then(() => {
      this.assetsLoading = false;
    });
  }

  /**
   * Shows the play (see {@link PixiScene.enter}): wires its keys (ESC / F5 / Space / arrows, the Backspace hold),
   * touch lanes, canvas focus and the auto-pause on losing focus, and resumes drawing if {@link exit} stopped it. The
   * play itself starts with {@link start}.
   */
  public enter(host: PixiSceneHost): void {
    if (this.disposed || this.entered) return;
    this.build(host);
    this.entered = true;
    // ESC / F5 / Space / ArrowUp / ArrowDown stay on the view so the LR2 `#FADEOUT` exit animation runs to
    // completion BEFORE the engine's interrupt flow disposes the audio session, and so HiSpeed adjustment
    // affects the visual scroll speed (which the engine doesn't own). The WebInputRuntime's `shouldSkipKey`
    // filter mirrors this list so it doesn't also push duplicate `interrupt` / `toggle-pause` commands. Lane
    // input goes through the WebInputRuntime's own `keydown` listener to the engine's input bus.
    window.addEventListener('keydown', this.handleSharedEngineExitKey);
    // Holding Backspace quits like Escape (`QuitHoldController`); the keyup / blur listeners end the hold.
    window.addEventListener('keyup', this.handleQuitHoldKeyUp);
    window.addEventListener('blur', this.cancelQuitHold);
    host.app.canvas.addEventListener('pointerdown', this.focus);
    // Touch play: fingers on the lanes press them. `touch-action: none` keeps the page from scrolling or zooming under
    // the fingers while the play is up.
    this.previousCanvasTouchAction = host.app.canvas.style.touchAction;
    host.app.canvas.style.touchAction = 'none';
    host.app.canvas.addEventListener('pointerdown', this.handleTouchPointer);
    host.app.canvas.addEventListener('pointermove', this.handleTouchPointer);
    host.app.canvas.addEventListener('pointerup', this.handleTouchPointerUp);
    host.app.canvas.addEventListener('pointercancel', this.handleTouchPointerUp);
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    // `visibilitychange` covers tab switching but not always app switching (Cmd-Tab / Alt-Tab) — fall back to window
    // blur/focus so the gameplay also pauses when the user moves to another OS app entirely. Use the capture phase so
    // we still see the events even if PixiJS or another listener decides to stop propagation along the bubbling path.
    window.addEventListener('blur', this.handleWindowBlur, true);
    window.addEventListener('focus', this.handleWindowFocus, true);
    window.addEventListener('pagehide', this.handleWindowBlur);
    window.addEventListener('pageshow', this.handleWindowFocus);
    // Polling safety net. Some embedded environments / OS-window managers suppress the `visibilitychange` and `blur`
    // events entirely (notably when the dev-tools panel takes focus on the same window). A 250 ms poll on
    // `document.hidden` and `document.hasFocus()` catches those cases without measurable cost.
    this.lastHidden = document.hidden;
    this.lastFocus = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
    this.visibilityPollHandle = window.setInterval(() => {
      const hiddenNow = document.hidden;
      const focusNow = typeof document.hasFocus === 'function' ? document.hasFocus() : true;
      if (hiddenNow !== this.lastHidden) {
        this.lastHidden = hiddenNow;
        log.info('poll detected hidden change', { hidden: hiddenNow });
        if (hiddenNow) {
          this.handleWindowBlur();
        } else {
          this.handleWindowFocus();
        }
      } else if (focusNow !== this.lastFocus) {
        this.lastFocus = focusNow;
        log.info('poll detected focus change', { focus: focusNow });
        if (!focusNow) {
          this.handleWindowBlur();
        } else {
          this.handleWindowFocus();
        }
      }
    }, 250);
    log.info('listeners attached', {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      hasFocus: typeof document.hasFocus === 'function' ? document.hasFocus() : 'n/a',
    });
    if (this.resumeAnimationOnEnter) this.startAnimationLoop();
  }

  /**
   * Stops drawing and taking input (see {@link PixiScene.exit}). The play's engine and sound run on — a play that has
   * ended keeps its audio tail until {@link dispose}.
   */
  public exit(): void {
    if (!this.entered) return;
    this.entered = false;
    this.resumeAnimationOnEnter = this.tickerAttached;
    this.stopAnimationLoop();
    // Detach window-level event listeners so a stray keypress doesn't hit a view that is off stage.
    window.removeEventListener('keydown', this.handleSharedEngineExitKey);
    window.removeEventListener('keyup', this.handleQuitHoldKeyUp);
    window.removeEventListener('blur', this.cancelQuitHold);
    this.quitHold.cancel();
    if (this.host) {
      this.host.app.canvas.removeEventListener('pointerdown', this.focus);
      const canvas = this.host.app.canvas;
      canvas.removeEventListener('pointerdown', this.handleTouchPointer);
      canvas.removeEventListener('pointermove', this.handleTouchPointer);
      canvas.removeEventListener('pointerup', this.handleTouchPointerUp);
      canvas.removeEventListener('pointercancel', this.handleTouchPointerUp);
      if (this.previousCanvasTouchAction !== undefined) canvas.style.touchAction = this.previousCanvasTouchAction;
      this.touchLanes.upAll();
    }
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('blur', this.handleWindowBlur, true);
    window.removeEventListener('focus', this.handleWindowFocus, true);
    window.removeEventListener('pagehide', this.handleWindowBlur);
    window.removeEventListener('pageshow', this.handleWindowFocus);
    if (this.visibilityPollHandle !== undefined) {
      window.clearInterval(this.visibilityPollHandle);
      this.visibilityPollHandle = undefined;
    }
  }

  /** Builds the scene graph under {@link root} on the first {@link prepare} or {@link enter}; later calls no-op. */
  private build(host: PixiSceneHost): void {
    if (this.host !== undefined) return;
    this.host = host;
    // Label every top-level node so the PixiJS Devtools "Scene Graph" panel reads as `gameplay > {bga,skin,lane,…}`
    // instead of a wall of `Container` rows. Layer ordering matches `addChild` below.
    this.root.label = 'gameplay/scene';
    this.designRoot.label = 'gameplay/root';
    this.viewportBackground.label = 'gameplay/viewport-bg';
    this.background.label = 'gameplay/background';
    this.bgaLayer.label = 'gameplay/bga';
    this.skinLayer.label = 'gameplay/skin';
    this.laneLayer.label = 'gameplay/lanes';
    this.noteLayer.label = 'gameplay/notes';
    this.bombLayer.label = 'gameplay/bombs';
    this.overlayLayer.label = 'gameplay/overlay';
    this.textLayer.label = 'gameplay/text';
    this.overlay.label = 'gameplay/pause-overlay';
    this.designClipMask.label = 'gameplay/design-clip';
    // The mask and design background only change shape with the stage (a rotation can switch a skin between its
    // landscape and portrait stages), so they are stamped here and restamped by `render` only when the stage changes,
    // skipping the per-frame rebuild that was contributing to the rAF handler's runtime.
    this.stampDesignRect(this.stageSize);
    // The gameplay scene owns its own pointerdown listener on the canvas itself (`this.focus`) and a window-level
    // keydown listener — none of the per-layer children need to participate in Pixi's interaction system. Marking
    // each render-only Container as `eventMode = 'none'` lets the interaction manager skip the entire subtree
    // during hit-testing every pointermove / pointerdown, which is otherwise an O(N) walk over hundreds of skin
    // children per event.
    //
    // CAUTION: `this.background` and `this.designClipMask` are intentionally NOT marked `'none'`. The mask is
    // referenced via `this.designRoot.mask = this.designClipMask` and Pixi v8's mask resolution path interacts with the
    // event-mode setting in subtle ways — clearing it on the mask Graphics has been observed to leave the root
    // unclipped (residual previous-frame content visible, e.g. the LR2 intro title strip stays painted across
    // subsequent frames) and has the side effect of dropping the rendered frame rate. The mask + the static
    // `background` Graphics don't carry interactive children either way, so leaving their `eventMode` at the
    // default is the safest choice.
    for (const layer of [
      this.bgaLayer,
      this.skinLayer,
      this.laneLayer,
      this.noteLayer,
      this.shutterLayer,
      this.bombLayer,
      this.overlayLayer,
      this.textLayer,
    ]) {
      layer.eventMode = 'none';
    }
    // Theme sub-layers (e.g. the LR2 bitmap-text layer) must be parked inside `skinLayer` before the scene graph is
    // assembled so their z-order matches the theme's own layering.
    this.attachThemeLayers();
    this.designRoot.addChild(
      this.background,
      this.bgaLayer,
      this.skinLayer,
      this.laneLayer,
      this.noteLayer,
      this.shutterLayer,
      this.bombLayer,
      this.overlayLayer,
      this.textLayer,
      this.overlay,
      this.designClipMask,
    );
    // Clip every child of `designRoot` to the design rectangle. The mask graphic itself is a child of `designRoot`, so
    // the same viewport scale / translate applies to both the mask and the masked content — Pixi clips against the
    // mask's world-space bounds, which matches the on-screen design rectangle.
    this.designRoot.mask = this.designClipMask;
    this.shutterLayer.label = 'gameplay/shutter';
    this.root.addChild(this.viewportBackground, this.designRoot);
  }

  /**
   * Reveals the prepared scene, starts the intro timeline (theme `scene-start` / `load-end` / `play-start` events), and
   * starts the rAF loop. Must be called after {@link prepare} resolves; calling it before will skip the chart-start
   * scheduling because `audioContextStartTime` only lands in the right ballpark when the audio context is up.
   *
   * Idempotent — repeated calls after the scene has already started no-op.
   */
  public start(): void {
    if (this.disposed) return;
    if (this.sceneStartTime !== 0) return;
    this.root.visible = true;
    // The intro timeline comes from the theme (see {@link themeTiming}; the LR2 family maps `#LOADSTART` / `#LOADEND`
    // / `#PLAYSTART`). `start()` only runs when `paused` is false and `pauseTotal` is still 0, so `playClock()` and
    // `performance.now()` are equivalent here — but seeding through `playClock()` keeps the animation clocks all in the
    // same coordinate system as the pause-aware reads further below.
    const now = this.playClock();
    this.sceneStartTime = now;
    const { loadEndOffsetMs, playStartOffsetMs } = this.themeTiming;
    // Skinless / non-LR2 demos have no timing directives; fall back to the legacy 3-second wait so the slide-in chrome
    // of the built-in fallback frame still has room to land before notes begin.
    const introMs = playStartOffsetMs > 0 ? playStartOffsetMs : FALLBACK_INTRO_DELAY_MS;
    this.scheduledIntroMs = introMs;
    // The chart waits on BOTH the configured PLAY START delay AND the BGA preload (which may still be transcoding video
    // in the background — see `prepare()`). Until the gate opens below, `startTime = +Infinity` keeps `isIntroPlaying`
    // true and the rAF loop in the intro (LR2 LOADING) phase.
    this.startTime = Number.POSITIVE_INFINITY;
    // Scene start fires immediately; load-end and play-start — the events that drive "READY" / chart-start cues — fire
    // later via the `Promise.all` gates below so they wait for the BGA preload too. Exit-phase events are deliberately
    // NOT raised here: `beginExitSequence` raises them at the actual transition moment (ESC / chart end).
    this.onThemeEvent({ kind: 'scene-start', at: now });
    // The `start()` invocation we belong to — captured so the gate handlers below can detect a dispose-and-re-mount and
    // bail out instead of mutating a fresh scene's state.
    const sceneEpoch = this.sceneStartTime;
    const bgaReady = this.bgaReadyPromise ?? Promise.resolve();
    // LOAD END gate — both the configured load-end delay AND the BGA preload need to finish.
    void Promise.all([bgaReady, this.delaySceneStage(loadEndOffsetMs)]).then(() => {
      if (this.disposed) return;
      if (this.sceneStartTime !== sceneEpoch) return;
      this.onThemeEvent({ kind: 'load-end', at: this.playClock() });
    });
    // PLAY START gate — same pattern, but for the configured play-start (or fallback intro). Raises the theme's
    // play-start event (animation clock) and anchors the wall-clock + audio-context start times (chart-engine clock) so
    // the chart engine and BGM samples share a single t=0.
    void Promise.all([bgaReady, this.delaySceneStage(introMs)]).then(() => {
      if (this.disposed) return;
      if (this.sceneStartTime !== sceneEpoch) return;
      this.onThemeEvent({ kind: 'play-start', at: this.playClock() });
      // `startTime` is consumed by `isIntroPlaying` and `currentSeconds`, both of which work in raw wall-clock units
      // (with `currentSeconds` subtracting `pauseTotal` explicitly), so it MUST stay on `performance.now()`.
      this.startTime = performance.now();
      if (this.audioContext) {
        this.audioContextStartTime = this.audioContext.currentTime;
        this.nonstopMixer?.schedule(this.audioContextStartTime);
      }
      // Hand chart playback over to `@be-music/player`'s engine. Fires only after the play-start gate (= same instant
      // the legacy self-judge would have started consuming notes), so the engine's chart-time t=0 lines up with the
      // view's `audioContextStartTime` anchor — no double-leadin.
      this.launchSharedEngine();
    });
    this.app.canvas.focus();
    this.startAnimationLoop();
  }

  private delaySceneStage(offsetMs: number): Promise<void> {
    return new Promise((resolve) => this.setSceneStageTimeout(resolve, Math.max(0, offsetMs)));
  }

  /**
   * Schedules `callback` after `offsetMs`, tracked so {@link dispose} cancels it. Themes use it for their own
   * scene-stage timers (e.g. LR2 `#STARTINPUT`).
   */
  protected setSceneStageTimeout(callback: () => void, offsetMs: number): void {
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
    this.togglePause();
  }

  /** Whether the play is paused (by Space, {@link requestTogglePause}, or the auto-pause on losing focus). */
  public isPaused(): boolean {
    return this.paused;
  }

  /**
   * The play log of this play once the engine has recorded it — also after Escape, which records the play as given up
   * (`play.aborted`) a moment after `onExit` fires. Resolves `undefined` when none arrives within `timeoutMs` (a replay
   * records none).
   */
  public waitForPlaylog(timeoutMs = 2000): Promise<BeMusicPlaylog | undefined> {
    if (this.playlog !== undefined) return Promise.resolve(this.playlog);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const index = this.playlogWaiters.indexOf(settle);
        if (index >= 0) this.playlogWaiters.splice(index, 1);
        resolve(undefined);
      }, timeoutMs);
      const settle = (playlog: BeMusicPlaylog): void => {
        clearTimeout(timer);
        resolve(playlog);
      };
      this.playlogWaiters.push(settle);
    });
  }

  /**
   * Hands the play over to the host once ({@link sharedEngineInterrupt}): a play still being judged is interrupted, so
   * the engine stops (and, for ESC, records the play as given up); a play whose chart already settled is complete, so
   * its hold is let go and it ends with its play log as usual. A no-op before the engine is running.
   */
  private interruptSharedEngine(reason: 'escape' | 'restart'): void {
    if (this.sharedEngineInterrupt !== undefined) return;
    const signals = this.sharedEngineInputSignals;
    if (signals === undefined) return;
    this.sharedEngineInterrupt = reason;
    this.flushPlaylogView();
    if (this.sharedEngineChartSettled) {
      this.chartEndHold?.abort();
      return;
    }
    signals.pushCommand({ kind: 'interrupt', reason });
  }

  /** Leaves the play the way Escape does: the theme's fade-out runs, then the host's `onExit` fires. */
  public requestExit(): void {
    this.beginExitSequence(() => {
      this.interruptSharedEngine('escape');
      this.sharedEngineAbortController?.abort();
      this.options.onExit?.();
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
   * Live setter for {@link CoreGameplayViewOptions.judgedNoteDisplay}. Mutates `this.options` so the per-frame
   * `renderNotes` check picks the new mode on the next paint — letting the user A/B "keep scrolling" vs "hide on judge"
   * without restarting the song.
   */
  public setJudgedNoteDisplay(mode: 'KEEP_SCROLLING' | 'HIDE'): void {
    this.options.judgedNoteDisplay = mode;
  }

  /**
   * Live setter for {@link CoreGameplayViewOptions.showInvisibleNotes}. The invisible-note array is always extracted at
   * chart- prepare time and the green sprite's texture is always preloaded, so flipping this flag mid-song just toggles
   * the per-frame render branch — the overlay appears (or vanishes) on the very next paint.
   */
  public setShowInvisibleNotes(enabled: boolean): void {
    this.options.showInvisibleNotes = enabled;
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
   * Begins recording the play scene (canvas video + bus audio mix) into a WebM Blob. Throws when `prepareAudio` hasn't
   * finished setting up the audio context yet, or when the browser doesn't expose `MediaRecorder` /
   * `canvas.captureStream` / a usable codec — UI hosts should surface these failures to the user (the codec case is
   * common on older Safari).
   *
   * Idempotent in the sense that calling while a recording is already active is a no-op (`isRecording()` is the
   * canonical gate hosts should check).
   */
  public startRecording(options: { format?: RecordingFormat } = {}): void {
    if (this.recorder?.isActive()) return;
    if (!this.host || !this.audioContext || !this.audioBus) {
      throw new Error('CoreGameplayView.startRecording: gameplay audio is not ready yet');
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

  public dispose(options: CoreGameplayDisposeOptions = {}): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // Detach the gameplay tick and the input listeners. The shared `Application` keeps running for the next active
    // scene — only the per-scene state below is freed.
    this.exit();
    this.stopAnimationLoop();
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
    // Pause every BGA video BEFORE we touch textures. The Pixi `VideoSource` wrapping each video registers a
    // `requestVideoFrameCallback` that re-uploads frames into the GL texture as they decode — leaving those callbacks
    // in flight while we destroy the textures throws inside the GL texture system. Pausing also revokes the Blob URL so
    // the underlying buffer can be released.
    for (const { video, objectUrl } of this.bgaVideos.values()) {
      try {
        video.pause();
        video.removeAttribute('src');
        video.load();
      } catch {
        // Defensive — `load()` can throw on detached videos.
      }
      URL.revokeObjectURL(objectUrl);
    }
    this.bgaVideos.clear();
    this.bgaActiveVideos = {};
    // Hard-stop any active recording before tearing down the bus. `GameplayRecorder.dispose` calls
    // `MediaRecorder.stop()` synchronously (no chunk-flush wait) and disconnects its audio tap from the bus's output
    // node, so the bus can be disposed cleanly afterwards.
    this.recorder?.dispose();
    this.recorder = undefined;
    // WebAudioSession owns the in-flight BufferSource tracking that the bus's connected sources hang off of, so
    // dispose it BEFORE we tear the bus down — that gives the session a chance to call `node.stop()` on every
    // still-playing source so they don't survive into the next chart's bus and bleed audio through. Fire-and-
    // forget the returned promise; the session's dispose path is best-effort.
    // Abort the shared engine driver BEFORE the audio session tear-down so engine ticks don't fire fresh
    // sample triggers onto a session that's about to lose its bus references. The engine catches the abort via
    // `throwIfAborted` and unwinds; our launchSharedEngine catch swallows the resulting `AbortError` because
    // the host already initiated dispose.
    // A play torn down mid-chart is interrupted too, so the engine stops instead of running on to the chart's end.
    this.interruptSharedEngine('escape');
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
    const preserveAudioTail = options.preserveAudioTail === true && this.chartEnded;
    const audioTailChart = this.resolvedChart ?? this.song?.chart;
    const audioTailCleanupDelayMs =
      preserveAudioTail && audioTailChart !== undefined
        ? chartToElapsedSeconds(
            resolveGameplayAudioTailCleanupDelayMs({
              chart: audioTailChart,
              notes: this.notes,
              autoSampleTriggers: this.autoSampleTriggers,
              decodedSamples: this.decodedSamples,
              bmsonSlicePlayback: this.bmsonSlicePlayback,
              currentSeconds: this.currentSeconds(),
            }),
            this.tempo,
          )
        : 0;
    const webAudioSession = this.webAudioSession;
    this.webAudioSession = undefined;
    this.nonstopMixer?.dispose();
    this.nonstopMixer = undefined;
    // Tear down the bus before closing the AudioContext so its `disconnect()` calls don't race with context shutdown.
    // The bus doesn't own the AudioContext itself; closing that is the next step.
    this.audioAnalyzer?.dispose();
    this.audioAnalyzer = undefined;
    this.audioFrame = undefined;
    const audioBus = this.audioBus;
    this.audioBus = undefined;
    const audioContext = this.audioContext;
    this.audioContext = undefined;
    disposeGameplayAudioGraphAfterDelay(
      {
        session: webAudioSession,
        bus: audioBus,
        context: audioContext,
      },
      preserveAudioTail ? audioTailCleanupDelayMs : 0,
    );
    // Detach our subtree from the host's stage. The host owns the `Application` lifetime; we just stop contributing to
    // its scene graph. The root Container itself stays alive in case the host wants to re-enter the same view (we
    // don't, but it's harmless).
    if (this.root.parent) {
      this.root.parent.removeChild(this.root);
    }
    // Free per-view textures. Order matters: textures BEFORE we destroy the root / sprites, because
    // `Texture.destroy()` emits a `styleChange` event that traverses up to the live `GlTextureSystem` (still alive on
    // the shared host). With our sprites still parented to root, the events route correctly.
    //
    // The destroys are spread across multiple frames via the shared host's ticker: a sync sweep over the gameplay
    // view's full texture set (skin chrome + every #BGA frame slot + per-key bombs, often several hundred entries)
    // hits the GL backend with one `gl.deleteTexture` per call back-to-back, and the driver-side flush stalls the
    // transition into the result scene by 30–80 ms on lower-end devices. Staggering at 8 textures per frame keeps
    // each frame's destroy pass under the per-frame budget while still releasing GPU memory within ~100–200 ms of
    // dispose() returning. The result scene's first paint is unaffected — it draws its own freshly-loaded textures
    // and never references the gameplay set.
    // Let the theme release its own per-view state first; any textures it hands back join the staggered destroy queue
    // after the scene's own.
    const themeTextures = this.disposeTheme();
    try {
      const ticker = this.host?.app.ticker;
      const queue: (Texture | undefined)[] = [
        ...this.textures.values(),
        ...this.bgaTextures.values(),
        ...this.bgaLayerTextures.values(),
        ...themeTextures,
      ];
      const hostIsDisposing = this.host?.isDisposed() === true;
      if (ticker) {
        const cleanup = staggerDestroyTextures(queue, (callback) => {
          ticker.add(callback);
          return () => ticker.remove(callback);
        });
        if (hostIsDisposing) {
          cleanup.drain();
        }
      } else {
        // No live ticker (defensive — host is normally still alive at this point). Fall back to a macrotask scheduler
        // so the destroy chain yields to paint/input between batches rather than monopolizing the current task.
        const cleanup = staggerDestroyTextures(queue, (callback) => {
          let cancelled = false;
          let timeout: ReturnType<typeof setTimeout> | undefined;
          const loop = (): void => {
            if (cancelled) return;
            callback();
            if (!cancelled) timeout = setTimeout(loop, 0);
          };
          timeout = setTimeout(loop, 0);
          return () => {
            cancelled = true;
            if (timeout !== undefined) clearTimeout(timeout);
          };
        });
        if (hostIsDisposing) {
          cleanup.drain();
        }
      }
      this.textures.clear();
      this.bgaTextures.clear();
      this.bgaLayerTextures.clear();
    } catch (error) {
      log.warn('texture cleanup threw', error);
    }
    // Drop every per-frame child pool so the pooled Sprite / Graphics / Text instances are destroyed before the
    // scene-graph subtree below tears them down indirectly. Order matters — the pools' children are parented to the
    // layer Containers we're about to destroy, so going through the pools first means each child is freed via its
    // own `destroy()` (which clears `GraphicsContext` resources) rather than chained through `destroy({children:true})`
    // which can skip some Pixi v8 cleanup paths.
    try {
      this.skinBindingInstance?.dispose();
      this.skinBindingInstance = undefined;
      this.songImages?.dispose();
      this.songImages = undefined;
      for (const crop of this.skinBgaCrops.values()) crop?.close();
      this.skinBgaCrops.clear();
      this.noteLayerPool.destroy();
      this.skinLayerPool.destroy();
      this.overlayLayerPool.destroy();
      this.textLayerPool.destroy();
      this.bombLayerPool.destroy();
      this.bgaLayerPool.destroy();
    } catch (error) {
      log.warn('child pool teardown threw', error);
    }
    // Destroy our scene-graph subtree. With the shared host pattern we never call `app.destroy` here — that would nuke
    // the canvas and the select scene would lose its rendering target.
    try {
      this.root.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('root.destroy threw', error);
    }
    // Drop large per-song reference holders explicitly. Async gates and cancelled browser decode tasks can retain the
    // view for a little while after `dispose()` returns; clearing these fields keeps that short tail from pinning a
    // full chart bundle, decoded PCM, BGA timelines, and skin/font caches.
    this.decodedSamples.clear();
    this.bmsonSlicePlayback = undefined;
    this.autoSampleTriggers = [];

    this.pressedChannels.clear();
    this.lanePressedAt.clear();
    this.laneReleasedAt.clear();
    this.judgeTimings.clear();
    this.longNotes.clear();
    this.longNoteStyle = undefined;
    this.judgeWindows = undefined;
    this.timerStartedAt.clear();
    this.bombStartedAt.clear();
    this.bombJudge.clear();
    this.keyOnFadeOutStart.clear();
    this.wavCmdVolumeMultipliers.clear();
    this.switchingBgas.clear();
    this.bgaSubRegionOrigins.clear();
    this.gaugeHistory.length = 0;
    this.scoreHistory.length = 0;
    this.notes = [];
    this.mineNotes = [];
    this.invisibleNotes.length = 0;
    this.preparedChart = undefined;
    this.touchTokenByChannel = undefined;
    this.resolvedChart = undefined;
    this.resolvedPlayChart = undefined;
    this.randomDraws = undefined;
    this.beatAtSeconds = undefined;
    this.scrollMapper = undefined;
    this.timingResolver = undefined;
    this.bgaTimeline = { base: [], layer: [], poor: [] };
    this.bgaTargetsScratch.length = 0;
    this.laneChannels = [];
    this.laneX.clear();
    this.poorBgaFallbackKey = undefined;
    this.poorBgaFallbackUntilSeconds = Number.POSITIVE_INFINITY;
    this.hasBga = false;
    this.bgaReadyPromise = undefined;
    this.song = undefined;
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

  /**
   * Locates the song's current beat from `currentSeconds` using the BPM-aware tempo points. Required because BMS charts
   * can change tempo mid-song (`#BPM` events) — using the initial BPM alone makes notes after a tempo change drift
   * visibly out of sync with the audio.
   */
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
  nowBpm(seconds: number): number | undefined {
    const resolver = this.timingResolver;
    if (!resolver) return undefined;
    // `displayBpmAtBeat`: a negative `#BPMxx` reads as |trunc(BPM)|, LR2's int NOWBPM.
    return resolver.displayBpmAtBeat(
      this.currentBeat(Math.min(seconds, resolver.reversal?.seconds ?? Number.POSITIVE_INFINITY)),
    );
  }

  /**
   * The BPM the readouts (NOWBPM, the HUD) show at `seconds`: for a stitched NONSTOP chart, whose scroll runs at a
   * constant 150 BPM, the BPM of the stage being played, scaled by its FIT rate (`NonstopStitchMap.tempo`), as LR2
   * shows it; otherwise {@link nowBpm}.
   */
  displayBpm(seconds: number): number | undefined {
    const tempo = this.options.nonstop?.tempo;
    return tempo !== undefined && tempo.length > 0 ? nonstopBpmAt(tempo, seconds) : this.nowBpm(seconds);
  }

  currentBeat(seconds: number): number {
    // LR2 negative-BPM reversal (issue #134): past the first negative `#BPMxx` the chart *visually* scrolls backwards.
    // LR2 mirrors the chart POSITION around the reversal (`2 * pos(R) - pos(now)`), so the reverse scroll runs at the
    // post-reversal |BPM| and pauses through post-reversal STOPs. Every display consumer — renderNotes, measure
    // lines, beatPhase — funnels through this method, so mirroring here covers them all; the forward beat underneath
    // keeps `beatAtSeconds`'s monotonic stop-window cursor intact.
    return mirrorBeatAtTempoReversal(this.timingResolver?.reversal, seconds, this.forwardBeat(seconds));
  }

  private forwardBeat(seconds: number): number {
    // Prefer the proper STOP-aware resolver (built once per song in `prepareSong`). Falls back to a flat-BPM
    // extrapolation when the resolver isn't ready yet (very early frames during mount).
    const resolver = this.timingResolver;
    if (this.beatAtSeconds && resolver && resolver.tempoPoints.length > 0) {
      return this.beatAtSeconds(seconds);
    }
    if (!resolver || resolver.tempoPoints.length === 0) {
      const bpm = this.song?.bpm ?? 130;
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

  /**
   * Hands `textures` to Pixi's `PrepareSystem` so the renderer's GPU upload happens NOW, before the first frame that
   * would otherwise touch them. Without this, Pixi defers the upload to the moment a sprite first samples each
   * texture — which means the chart's opening frames pay the cumulative `texSubImage2D` cost of the entire skin
   * sheet (and, mid-chart, the first BGA cue stalls on its image upload). Eager-uploading at prepare time spreads
   * the work across the Decide splash window where the gameplay scene isn't visible yet.
   *
   * The PrepareSystem is conditionally optional — the static `import 'pixi.js/prepare'` at the top of this module
   * registers it when bundled, but we still defensively detect its presence so a future tree-shaking config that
   * eliminates the side-effect import doesn't break the prepare flow at runtime. When absent we silently skip the
   * upload; first-frame stutter returns to the pre-PrepareSystem baseline but nothing else breaks.
   *
   * Errors thrown by the upload (e.g. a corrupt texture, a transient WebGL context loss) are logged and the loop
   * stops — there's no point queuing more uploads on a renderer that just rejected one. The chart still loads; the
   * not-yet-uploaded textures will fall through to lazy upload on first paint, which is the original behavior.
   */
  async preparePixiUpload(textures: Iterable<Texture | undefined>): Promise<void> {
    const renderer = this.host?.app.renderer;
    if (!renderer) return;
    type PrepareLike = { upload: (resource: Texture) => Promise<unknown> };
    const prepare = (renderer as { prepare?: PrepareLike }).prepare;
    if (!prepare || typeof prepare.upload !== 'function') return;
    for (const texture of textures) {
      if (this.disposed) return;
      if (!texture) continue;
      // BGA video textures are skipped: the underlying `<video>` element hasn't decoded any frames yet at prepare
      // time (the chart hasn't started, the cue hasn't fired), so its `videoFrame` / `videoSource` is empty.
      // WebGPU's `copyExternalImageToTexture` rejects an unbacked `<video>` with "Failed to import texture from
      // video element that doesn't have back resource", which Pixi propagates as an uncaught `OperationError`
      // that recurs every frame inside the renderer's PrepareSystem queue. Skipping the eager upload here lets
      // each video texture take Pixi's lazy first-frame path (`Texture.source.update()` once a frame is
      // decoded), which is bounded by the video's natural decode latency rather than a runaway rAF loop.
      if (isVideoTextureSource(texture)) continue;
      try {
        await prepare.upload(texture);
      } catch (error) {
        log.warn('prepare.upload failed; falling back to lazy upload for the rest', error);
        return;
      }
    }
  }

  /**
   * Auto-pause when the document tab / window goes to the background and auto-resume when it comes back to the
   * foreground (matching the LR2 desktop client behavior). The user can still toggle manually with Space without
   * conflicting with this listener — `togglePause` is a symmetric flip, and we only fire it when the visibility state
   * actually changes.
   */
  readonly handleVisibilityChange = (): void => {
    log.info('visibilitychange', {
      visibilityState: document.visibilityState,
      hidden: document.hidden,
      paused: this.paused,
      autoPaused: this.autoPaused,
      autoPauseOnBlur: this.autoPauseOnBlur,
    });
    // Auto-pause when the tab goes hidden (only if the host opted in). The auto-RESUME path stays unconditional — if we
    // previously auto-paused, we must auto-resume regardless of the toggle's current value, otherwise turning the
    // toggle off mid-blur would strand gameplay in a paused state with no obvious way out.
    if (document.hidden) {
      if (!this.paused && this.autoPauseOnBlur) {
        this.togglePause();
        this.autoPaused = true;
      }
    } else if (this.autoPaused && this.paused) {
      this.togglePause();
      this.autoPaused = false;
    }
  };

  /**
   * Window-level blur/focus fallback for the auto-pause behavior. Some platforms (notably macOS with Chrome) keep the
   * document `visible` across Cmd-Tab app switches, so `visibilitychange` alone misses those cases. We treat `blur` /
   * `focus` the same way as `visibilitychange`, gated on the same `autoPaused` flag so the two listeners cooperate.
   */
  readonly handleWindowBlur = (): void => {
    log.info('window blur', {
      paused: this.paused,
      autoPaused: this.autoPaused,
      autoPauseOnBlur: this.autoPauseOnBlur,
    });
    // Same opt-in policy as `handleVisibilityChange` — only blur- pause when the host enabled it; auto-resume on focus
    // stays unconditional so flipping the toggle mid-pause can't strand us in a paused state.
    if (!this.paused && this.autoPauseOnBlur) {
      this.togglePause();
      this.autoPaused = true;
    }
  };

  readonly handleWindowFocus = (): void => {
    log.info('window focus', { paused: this.paused, autoPaused: this.autoPaused });
    if (this.autoPaused && this.paused) {
      this.togglePause();
      this.autoPaused = false;
    }
  };

  readonly focus = (): void => {
    this.app.canvas.focus();
  };

  /** Holding Backspace for `QUIT_HOLD_THRESHOLD_MS` leaves the play the way Escape does. */
  readonly quitHold = new QuitHoldController({
    onComplete: () => this.requestExit(),
    now: () => performance.now(),
  });

  readonly handleQuitHoldKeyUp = (event: KeyboardEvent): void => {
    this.quitHold.handleKeyUp(event);
  };

  readonly cancelQuitHold = (): void => {
    this.quitHold.cancel();
  };

  /**
   * Captures ESC / F5 in shared-engine mode so the LR2 `#FADEOUT` exit animation runs to completion BEFORE the
   * engine's `PlayerInterruptedError` flow disposes the audio session. Without this intercept, pushing
   * `interrupt(escape)` through the WebInputRuntime would tear down the audio session synchronously inside
   * `manualPlay`'s `finally` block, killing every in-flight `BufferSource` mid-fade — the user hears the chart
   * audio cut to silence the moment ESC fires while the LR2 fadeout overlay is still painting.
   *
   * The handler kicks off `beginExitSequence` (which fades `audioBus.fadeOutAudibleTo(0)` over the LR2 fadeout
   * duration). Once the fade callback resolves, we abort the engine's `AbortController` so the engine throws and
   * unwinds normally — the audio session is already silent by then, so the in-flight-source `node.stop()` calls
   * have nothing audible to interrupt.
   */
  readonly handleSharedEngineExitKey = (event: KeyboardEvent): void => {
    // Backspace first: its auto-repeat must still be `preventDefault`ed, which the repeat filter below would skip.
    if (this.quitHold.handleKeyDown(event)) return;
    if (event.repeat) return;
    if (event.code === 'Escape') {
      event.preventDefault();
      this.requestExit();
      return;
    }
    if (event.code === 'F5') {
      event.preventDefault();
      this.beginExitSequence(() => {
        this.interruptSharedEngine('restart');
        this.sharedEngineAbortController?.abort();
        this.options.onRestart?.();
      });
      return;
    }
    if (event.code === 'Space') {
      event.preventDefault();
      this.togglePause();
      return;
    }
    // HiSpeed adjustment runs entirely on the view side — the engine has its own `high-speed` input command but
    // the value it tracks is decoupled from the visual scroll speed (`PIXELS_PER_BEAT * this.hiSpeed`) the
    // renderer applies. The WebInputRuntime's lane-input dispatch ignores arrow tokens, so the engine has no
    // way to push HiSpeed changes back to the renderer; we handle them directly here.
    if (event.code === 'ArrowUp') {
      event.preventDefault();
      this.adjustHiSpeed(HISPEED_STEP);
      return;
    }
    if (event.code === 'ArrowDown') {
      event.preventDefault();
      this.adjustHiSpeed(-HISPEED_STEP);
    }
  };

  /**
   * Adjust the visual hi-speed and clamp to [HISPEED_MIN, HISPEED_MAX]. Snap to a 1/1000 grid so accumulated press
   * deltas don't drift off the natural 0.1 grid through float-rounding noise — `0.1` has no exact IEEE-754
   * representation, so adding it 13 times in a row would otherwise produce `1.5000000000000002` and then
   * `1.6000000000000003` etc., visibly off-by-one in the digit panel. The 1/1000 snap absorbs that without breaking
   * even finer steps if HISPEED_STEP shrinks again later.
   */
  private adjustHiSpeed(delta: number): void {
    if (this.options.hiSpeedLocked === true) return;
    // The step moves the player's hi-speed (on their own scale, as the readout shows it); HS-FIX scales the drawn one.
    const next = stepPlayerHiSpeed(this.playerHiSpeed, delta, this.hsFixMultiplier);
    if (next === undefined || next.player === this.playerHiSpeed) return;
    this.playerHiSpeed = next.player;
    this.hiSpeed = next.drawn;
    this.scrollHiSpeed.retarget(next.drawn, performance.now());
    this.options.onHiSpeedChange?.(next.player);
  }

  /**
   * Sets the hi-speed from the host (e.g. a settings menu) while the scene is mounted. `value` is on the scale of
   * {@link CoreGameplayViewOptions.initialHiSpeed}: the chart's HS-FIX multiplier is applied on top, as at mount.
   * Snapped and clamped like the in-game hotkey; non-finite values are ignored.
   */
  public setHiSpeed(value: number): void {
    const next = stepPlayerHiSpeed(value, 0, this.hsFixMultiplier);
    if (next === undefined) return;
    this.playerHiSpeed = next.player;
    if (next.drawn === this.hiSpeed) return;
    this.hiSpeed = next.drawn;
    this.scrollHiSpeed.retarget(next.drawn, performance.now());
  }

  /**
   * Applies the HS-FIX multiplier to {@link hiSpeed} once `prepareSong` has installed the timing resolver. The player's
   * hi-speed is the one they want at `referenceBpm` (`#BASEBPM`, else the start BPM); HS-FIX rescales it so the scroll
   * at another BPM of the chart feels like that, as beatoraja's fixed hi-speed modes do (`LaneRenderer.init`):
   *
   * - `OFF` — leave HS as-is (beatoraja `OFF`; its `STARTBPM` is the same here, since the reference is the start BPM).
   * - `MAXBPM` — scale by `referenceBpm / maxBPM` (beatoraja `MAXBPM`).
   * - `MINBPM` — scale by `referenceBpm / minBPM` (beatoraja `MINBPM`).
   * - `AVERAGE` — scale by `referenceBpm / mainBPM`, the BPM the most notes sit at ({@link resolveChartMainBpm},
   *   beatoraja `MAINBPM`). A time average is skewed by the split-second BPM spikes and STOPs of BPM × N + STOP
   *   gimmicks (an average of ~810 on a 145 BPM chart), the main BPM is not.
   * - `CONSTANT` — true per-frame "constant scroll" needs a render-pipeline change that hasn't landed; falls through
   *   to the `AVERAGE` multiplier so the option still produces a sensible shift instead of doing nothing.
   *
   * Skipped when there are no tempo points (defensive — the resolver can be constructed empty during edge-case mounts)
   * or the chart has no BPM info.
   */
  applyHsFix(resolver: TimingResolver, referenceBpmCandidate: number | undefined, mainBpm: number | undefined): void {
    const mode = this.options.hsFix ?? 'OFF';
    if (mode === 'OFF') return;
    const referenceBpm =
      typeof referenceBpmCandidate === 'number' && referenceBpmCandidate > 0 ? referenceBpmCandidate : undefined;
    if (referenceBpm === undefined) return;
    const tempoPoints = resolver.tempoPoints;
    if (tempoPoints.length === 0) return;
    // |BPM| — a negative `#BPMxx` (LR2 reverse-scroll gimmick) integrates at its magnitude, so the HS-fix range
    // math uses the magnitude too. Zero / non-finite points still drop out via the `> 0` filter.
    const bpms = tempoPoints.map((point) => Math.abs(point.bpm)).filter((bpm) => Number.isFinite(bpm) && bpm > 0);
    if (bpms.length === 0) return;
    let targetBpm: number;
    switch (mode) {
      case 'MAXBPM':
        targetBpm = Math.max(...bpms);
        break;
      case 'MINBPM':
        targetBpm = Math.min(...bpms);
        break;
      default:
        targetBpm = mainBpm ?? referenceBpm;
        break;
    }
    const multiplier = referenceBpm / targetBpm;
    if (!Number.isFinite(multiplier) || multiplier <= 0) return;
    this.hsFixMultiplier = multiplier;
    this.hiSpeed = snapHiSpeed(this.hiSpeed * multiplier) ?? this.hiSpeed;
    // Chart setup, before the notes are on screen — no glide.
    this.scrollHiSpeed.jump(this.hiSpeed);
  }

  /**
   * The LR2 key-on timer of `channel`'s lane (`resolveLr2LaneTimer`): 100 + lane on 1P, 110 + lane on 2P, keys 1-7 (1-9
   * for 9 KEY, whose lanes all run through the 1P bank).
   */
  resolveKeyOnTimerId(channel: string): number | undefined {
    return resolveLr2LaneTimer('key-on', {
      channel,
      laneIndex: resolveSideRelativeLaneIndex(channel, this.chartPlayVariant),
      playVariant: this.chartPlayVariant,
    });
  }

  private startKeyOnTimer(channel: string): void {
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
  private releaseKeyOnTimer(channel: string): void {
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
    const fadeMs = this.resolveKeyOnFadeMs(timerId);
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
   * A finger touching down on or moving over the canvas: presses the lane under it, or — when it slid out of the lane it
   * held — releases that lane and presses the new one. Mouse pointers are left alone (a click only focuses the canvas).
   */
  readonly handleTouchPointer = (event: PointerEvent): void => {
    if (!isTouchPlayPointer(event.pointerType)) return;
    if (event.type === 'pointermove' && !this.touchLanes.isTracking(event.pointerId)) return;
    const { width: designWidth, height: designHeight } = this.stageSize;
    const viewport = resolveScaledViewport(this.app.screen.width, this.app.screen.height, designWidth, designHeight);
    const point = canvasPointToDesign(event.offsetX, event.offsetY, viewport);
    const zones = resolveTouchLaneZones(
      Array.from(this.laneX, ([channel, lane]) => ({ channel, ...lane })),
      {
        stageHeight: designHeight,
      },
    );
    const channel = hitTestTouchLane(zones, point.x, point.y);
    const change =
      event.type === 'pointerdown'
        ? this.touchLanes.down(event.pointerId, channel)
        : this.touchLanes.move(event.pointerId, channel);
    if (event.type === 'pointerdown') event.preventDefault();
    this.pushTouchLaneChange(change, event.timeStamp);
  };

  readonly handleTouchPointerUp = (event: PointerEvent): void => {
    if (!isTouchPlayPointer(event.pointerType)) return;
    this.pushTouchLaneChange(this.touchLanes.up(event.pointerId), event.timeStamp);
  };

  /** Lifts every finger, e.g. when the play pauses, so no lane stays held through the pause. */
  private releaseAllTouchLanes(): void {
    this.pushTouchLaneChange(this.touchLanes.upAll(), performance.now());
  }

  /**
   * Forwards touch presses / releases to the engine exactly as the keyboard runtime forwards keys: a release as a
   * `kitty-state` release, a press as one `lane-input` per lane (so two lanes tapped together judge two notes) plus a
   * `kitty-state` press that keeps the lane held for long notes and the key beam. `timeStamp` is the event's
   * `DOMHighResTimeStamp`, promoted to the engine's wall-clock domain the same way the keyboard path does.
   */
  private pushTouchLaneChange(change: TouchLaneChange, timeStamp: number): void {
    const signals = this.sharedEngineInputSignals;
    if (!signals || (change.pressed.length === 0 && change.released.length === 0)) return;
    const pressedAt = performance.timeOrigin + timeStamp;
    const releaseTokens = this.resolveTouchTokens(change.released);
    if (releaseTokens.length > 0) {
      signals.pushCommand({ kind: 'kitty-state', pressTokens: [], repeatTokens: [], releaseTokens, pressedAt });
    }
    const pressTokens = this.resolveTouchTokens(change.pressed);
    if (pressTokens.length === 0) return;
    for (const token of pressTokens) signals.pushCommand({ kind: 'lane-input', tokens: [token], pressedAt });
    signals.pushCommand({ kind: 'kitty-state', pressTokens, repeatTokens: [], releaseTokens: [], pressedAt });
  }

  /** The input tokens pressing `channels`: each lane binding's first token, the one its key on the keyboard sends. */
  private resolveTouchTokens(channels: readonly string[]): string[] {
    if (channels.length === 0) return [];
    let tokens = this.touchTokenByChannel;
    if (tokens === undefined) {
      tokens = new Map();
      for (const binding of this.preparedChart?.laneBindings ?? []) {
        const token = binding.inputTokens[0];
        if (token !== undefined && !tokens.has(binding.channel)) tokens.set(binding.channel, token.toLowerCase());
      }
      if (this.preparedChart !== undefined) this.touchTokenByChannel = tokens;
    }
    const resolved: string[] = [];
    for (const channel of channels) {
      const token = tokens.get(channel);
      if (token !== undefined) resolved.push(token);
    }
    return resolved;
  }

  private togglePause(): void {
    if (!this.paused) this.releaseAllTouchLanes();
    if (this.paused) {
      this.paused = false;
      this.pauseTotal += performance.now() - this.pauseTime;
      void this.audioContext?.resume();
      this.resumeActiveBgaVideos();
    } else {
      this.paused = true;
      this.pauseTime = performance.now();
      void this.audioContext?.suspend();
      this.pauseAllBgaVideos();
    }
    // In shared-engine mode the engine maintains its own playback clock + per-tick scheduling; without flipping
    // its pause flag the engine would keep advancing chart-time while the view sits paused, then fast-forward a
    // burst of judge events the moment the view resumes. Propagate the toggle so both sides are aligned. The
    // engine's pause path also calls `audioSession.pause()` / `resume()` which our WebAudioSession maps onto
    // `audioContext.suspend()` / `resume()` — those are idempotent when the context is already in the matching
    // state, so the redundant call from the engine side after our own `audioContext.suspend()` above is a no-op.
    this.sharedEngineInputSignals?.pushCommand({ kind: 'toggle-pause' });
  }

  /**
   * Pause-aware monotonic clock used by every "time since X" animation in the play scene (LR2 timer keyframes,
   * scratch-disc rotation, bomb / FC / POOR-BGA windows, NOWJUDGE / NOWCOMBO decay, …). Returns wall clock minus the
   * accumulated pause duration, and freezes at `pauseTime - pauseTotal` while the scene is paused. Seed sites that
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
  pauseAllBgaVideos(): void {
    for (const handle of this.bgaVideos.values()) {
      if (!handle.video.paused) {
        handle.video.pause();
      }
    }
  }

  /**
   * Resumes only the videos tied to currently-active base / layer cues. Avoids touching videos that were paused for a
   * different reason (e.g. an earlier cue switched away from them in `syncBgaVideo`).
   */
  resumeActiveBgaVideos(): void {
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
   * Starts a bomb (hit explosion) on `channel`. The core scene draws it from `bombStartedAt`; themes react through the
   * `bomb` event (the LR2 family stamps its per-lane bomb timer at the same instant).
   */
  private triggerBomb(channel: string, judge?: BeMusicJudge): void {
    const now = this.playClock();
    this.bombStartedAt.set(channel, now);
    if (judge) this.bombJudge.set(channel, judge);
    else this.bombJudge.delete(channel);
    this.onThemeEvent({ kind: 'bomb', channel, at: now });
  }

  private tick = (): void => {
    // Belt-and-suspenders for the rAF-after-dispose race. Even with `app.stop()` removing the renderer's tick listener,
    // our own `cancelAnimationFrame` can lose to a tick that's already mid-flight when ESC fires. Bailing here keeps
    // `render()` from touching destroyed Pixi state.
    if (this.disposed) {
      return;
    }
    this.perf.beginTick();
    const seconds = this.currentSeconds();
    if (!this.paused) {
      // Drain the engine's UI signal buses each frame so frame-snapshot-driven state (score panel, gauge,
      // NOWJUDGE plate) and command-driven visual effects (lane flashes, POOR BGA) stay in sync. The
      // state-applying callbacks were registered at engine launch; here we simply pull from the buses. The
      // engine itself owns judge / sample / chart-end bookkeeping and runs its own tick loop at
      // TUI_FRAME_INTERVAL_MS independent of this rAF.
      this.drainSharedEngineSignals();
      this.updatePlaylogView(seconds);
    }
    this.perf.time('updateFps', () => this.updateFps());
    this.perf.time('updateScores', () => {
      this.updateDisplayedScore();
      this.updateThemeState();
    });
    this.perf.time('render', () => {
      this.render(seconds);
      // A skin drawing through the player's renderer draws the frame just collected now, before Pixi renders.
      this.skinBindingInstance?.flush();
    });
    const report = this.perf.endFrame(() => ({
      stage: this.app.stage.children.length,
      skin: this.skinLayer.children.length,
      overlay: this.overlayLayer.children.length,
      bga: this.bgaLayer.children.length,
      note: this.noteLayer.children.length,
      bomb: this.bombLayer.children.length,
      text: this.textLayer.children.length,
      notesTotal: this.notes.length,
    }));
    if (report) {
      // High-volume (~every sampled frame) — keep on the verbose-only `debug` level so it doesn't drown out the host's
      // Info console with per-frame counts.
      log.debug('perf', report);
    }
  };

  /**
   * Registers the gameplay tick handler on the host's shared `app.ticker`. Replaces the previous self-scheduling rAF
   * loop so we don't run a second `requestAnimationFrame` callback alongside PixiJS's auto-render ticker. The handler
   * itself ({@link tick}) is unchanged — only the scheduling mechanism moved.
   */
  private startAnimationLoop(): void {
    if (this.tickerAttached || !this.host) return;
    this.host.app.ticker.add(this.tick);
    this.tickerAttached = true;
  }

  private stopAnimationLoop(): void {
    if (!this.tickerAttached) return;
    this.host?.app.ticker.remove(this.tick);
    this.tickerAttached = false;
  }

  /**
   * Sample frame rate over a sliding 1-second window. The published value drives theme frame-rate read-outs (the LR2
   * RATE NUMBER panel, which we re-purpose as a frame-rate read-out per the user's request).
   */
  private updateFps(): void {
    const now = performance.now();
    if (this.fpsWindowStart === 0) {
      this.fpsWindowStart = now;
      this.fpsFrameCount = 0;
      return;
    }
    this.fpsFrameCount += 1;
    const elapsed = now - this.fpsWindowStart;
    if (elapsed >= 1000) {
      this.fps = (this.fpsFrameCount * 1000) / elapsed;
      this.fpsWindowStart = now;
      this.fpsFrameCount = 0;
    }
  }

  /**
   * Lerps the displayed score toward the real score so the SCORE panel rolls up after each judgement instead of
   * jumping. Speed is tuned so a single PERFECT (~1000 score) catches up in ~6 frames at 60 fps.
   */
  private updateDisplayedScore(): void {
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
   * Drives the global "fade everything to black" tween while {@link beginExitSequence} is in flight. The skin's
   * authored `#FADEOUT` overlay (if any) only covers whatever the skin artist drew — gameplay-side layers (notes, lane
   * chrome, BGA, shutters, bombs, overlay text) sit *above* `skinLayer` in `designRoot` and would otherwise stay
   * fully visible until the scene is torn down. Fading `designRoot` itself dims every layer uniformly;
   * `viewportBackground` is a sibling of `designRoot` (under `root`), so the page reveals the same `BG` (near-black)
   * the playfield sat against, giving a clean fade-to-black appearance regardless of which lanes are still painting.
   *
   * Called every frame from {@link render}; cheap when the exit sequence isn't running (`designRoot.alpha` is set
   * back to 1 only when it diverges from 1, so steady-state has no GPU cost).
   */
  private applyExitFadeAlpha(): void {
    if (!this.exiting) {
      let alpha = 1;
      if (this.paintsThroughBeMusicSkin) {
        const now = performance.now();
        this.enteredAt ??= now;
        alpha = Math.min(1, (now - this.enteredAt) / BE_MUSIC_ENTER_FADE_MS);
      }
      if (this.designRoot.alpha !== alpha) this.designRoot.alpha = alpha;
      return;
    }
    const fadeOutMs = this.exitFadeOutMs;
    const fadeStart = this.exitFadeStartedAt;
    if (fadeStart === undefined || fadeOutMs <= 0) {
      // Fade hasn't been seeded (or the theme has no fade-out); leave designRoot at full alpha. Close-only themes keep
      // the scene visible until the host transitions us out.
      if (this.designRoot.alpha !== 1) this.designRoot.alpha = 1;
      return;
    }
    const elapsed = this.playClock() - fadeStart;
    this.designRoot.alpha = Math.max(0, Math.min(1, 1 - elapsed / fadeOutMs));
  }

  /**
   * Drives the theme's scene-exit timeline (fade-out → close; LR2 `#FADEOUT` → `#CLOSE`) before handing control back
   * to the host. Raises `exit-fade-out` at call time so theme chrome gated on it (the LR2 family's timer 2, typically a
   * full-screen alpha overlay) plays its authored fade-out; once the fade has elapsed it raises `exit-close` so
   * close-gated chrome (the LR2 default 7-keys STAGE FAILED / CLEARED plate on timer 3) plays before the actual
   * transition fires.
   *
   * Idempotent — re-entry while a fade is in flight is a no-op, so a frantic second ESC press doesn't double-fire the
   * host callback. Themes with no fade-out / close timing collapse to immediate dispatch (the skinless behaviour).
   */
  private beginExitSequence(callback: () => void, options: { fadeAudio?: boolean; minFadeOutMs?: number } = {}): void {
    if (this.exiting || this.disposed) {
      callback();
      return;
    }
    this.exiting = true;
    const closeMs = this.themeTiming.closeMs;
    // A failed play fades out even on a theme without a fade-out of its own (`minFadeOutMs`).
    const fadeOutMs = Math.max(this.themeTiming.fadeOutMs, options.minFadeOutMs ?? 0);
    this.exitFadeOutMs = fadeOutMs;
    if (fadeOutMs <= 0 && closeMs <= 0) {
      callback();
      return;
    }
    const fadeStartedAt = this.playClock();
    this.exitFadeStartedAt = fadeStartedAt;
    this.onThemeEvent({ kind: 'exit-fade-out', at: fadeStartedAt });
    // Drive the audio bus's post-tap fade in lock-step with `applyExitFadeAlpha`'s screen-alpha animation. The fade
    // node sits AFTER the recording tap, so a recording in flight keeps capturing the unattenuated mix; only the
    // speakers go quiet. Skipped when the theme has no fade-out (the screen also stays at full alpha in that path), so
    // a skinless demo gets the historical immediate-cut behavior.
    if (fadeOutMs > 0 && options.fadeAudio !== false) {
      this.audioBus?.fadeOutAudibleTo(0, fadeOutMs);
    }
    const fireClose = (): void => {
      this.onThemeEvent({ kind: 'exit-close', at: this.playClock() });
      this.exitCloseHandle = window.setTimeout(() => {
        this.exitCloseHandle = undefined;
        if (this.disposed) return;
        callback();
      }, closeMs);
    };
    if (fadeOutMs <= 0) {
      fireClose();
      return;
    }
    this.exitFadeOutHandle = window.setTimeout(() => {
      this.exitFadeOutHandle = undefined;
      if (this.disposed) return;
      if (closeMs <= 0) {
        callback();
        return;
      }
      fireClose();
    }, fadeOutMs);
  }

  /**
   * Captures the current play session as a {@link PixiGameplayResultData} snapshot. Returns `undefined` when no song is
   * mounted (defensive — normal flow only calls this after `prepareSong` has run). The snapshot is a plain object so
   * the host can hand it to a result scene that outlives this view.
   */
  public getResultData(): PixiGameplayResultData | undefined {
    if (!this.song) {
      return undefined;
    }
    // Append a final "current values @ now" sample so the polyline reaches the right edge of the chart area even when
    // the last judge fired well before the chart's natural end (e.g. AUTO PERFECTs the final note 5 s before the audio
    // tail clears).
    const totalSeconds = this.resolveSongDurationSeconds();
    const finalProgress = totalSeconds > 0 ? Math.max(0, Math.min(1, this.currentSeconds() / totalSeconds)) : 1;
    const gaugeHistory = [...this.gaugeHistory, { progress: finalProgress, value: this.gaugeState.current }];
    const scoreHistory = [...this.scoreHistory, { progress: finalProgress, exScore: this.score.exScore }];
    return {
      // Shallow-clone the score so a downstream consumer mutating their copy doesn't accidentally rewrite our live
      // state.
      score: { ...this.score },
      maxCombo: this.maxCombo,
      gauge: this.gaugeState.current,
      // The clear rule belongs to the ruleset — a threshold comparison for GROOVE/EASY, "never bottomed out" for
      // the survival gauges — so take the engine's verdict rather than re-deriving it from the percentage.
      cleared: this.gaugeState.cleared,
      playSeconds: this.currentSeconds(),
      song: this.song,
      gaugeHistory,
      scoreHistory,
      ...(this.playlog !== undefined ? { playlog: this.playlog } : {}),
      lamp: resolveClearLamp({
        cleared: this.gaugeState.cleared,
        score: this.score,
        ...(this.gaugeState.type !== undefined ? { gauge: this.gaugeState.type } : {}),
        ruleset: this.resolveJudgeRuleset(),
      }),
      gaugeType: this.gaugeState.type,
      judgeRuleset: this.resolveJudgeRuleset(),
      fast: this.fastCount,
      slow: this.slowCount,
      // `clear` swaps in a fresh list for the next play, so the result can keep this one.
      judgeTimings: this.judgeTimings.all,
    };
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
  private flashKeyOnTimer(channel: string): void {
    this.startKeyOnTimer(channel);
    const timeout = window.setTimeout(() => {
      this.keyFlashTimeouts.delete(timeout);
      if (this.disposed) return;
      // A real press took over during the hold — skip the auto-release, the press lifecycle is in charge. (LN
      // sustains drive their own `hold-lane-until-beat` timer keep-alive via `applyEngineCommand`.)
      if (this.pressedChannels.has(channel)) {
        return;
      }
      this.releaseKeyOnTimer(channel);
    }, KEY_ON_FLASH_HOLD_MS);
    this.keyFlashTimeouts.add(timeout);
  }

  /**
   * Chart-time seconds since the first beat, derived from the audio context clock so it stays *bit-exact* with
   * scheduled `node.start()` times across pause / resume cycles. The wall-clock approach we used previously
   * (`performance.now() - pauseTotal`) drifted out of sync with the audio context on every pause because `suspend()`
   * and `resume()` are asynchronous: the audio clock paused a few ms after we recorded `pauseTime` and resumed a few ms
   * before we credited `pauseTotal`, so each toggle slid the two clocks apart by ~10–30 ms.
   *
   * Anchoring everything on `audioContext.currentTime` removes that accumulating drift entirely. For environments where
   * the audio context isn't ready yet we fall back to the wall-clock model.
   */
  currentSeconds(): number {
    if (this.audioContext && this.audioContextStartTime > 0) {
      return this.tempoClock.chartSecondsAt((this.audioContext.currentTime - this.audioContextStartTime) * 1000);
    }
    const nowMs = this.paused ? this.pauseTime : performance.now();
    return this.tempoClock.chartSecondsAt(nowMs - this.startTime - this.pauseTotal);
  }

  /** The play tempo in force: the one the play started at, or the last change. */
  public getTempo(): number {
    return this.tempo;
  }

  /** The player's hi-speed in force (on the scale of `initialHiSpeed`), a replay's recorded one included. */
  public getHiSpeed(): number {
    return this.playerHiSpeed;
  }

  /**
   * Changes the play tempo during the play (clamped by `clampPlayTempo`). Only in `pitch` mode: the samples follow it
   * through their playback rate, playing ones included, and so do the BGA videos and a NONSTOP chart's fades. Keep
   * pitch stretched the samples to the tempo they loaded at, and a replay follows its log, so both refuse it. The
   * engine applies it at the chart time it takes the command and records it in the play log; the view follows from the
   * chart second the engine reports. Returns whether the change was taken.
   */
  public setTempo(tempo: number): boolean {
    return !this.disposed && this.liveTempo.request(tempo);
  }

  /** Follows a tempo change the engine made: the view's clock, the BGA videos, the NONSTOP fades and the host. */
  private followTempoChange(change: PlayerTempoChange): void {
    if (this.disposed) return;
    this.tempo = change.tempo;
    this.tempoClock.setTempoAtChartSeconds(change.seconds, change.tempo);
    setVideoPlaybackTempo(
      [...this.bgaVideos.values()].map((handle) => handle.video),
      change.tempo,
    );
    if (this.audioContext && this.audioContextStartTime > 0) {
      const chartStart = this.audioContextStartTime;
      this.nonstopMixer?.retime(
        this.currentSeconds(),
        (seconds) => chartStart + this.tempoClock.clockMsAt(seconds) / 1000,
      );
    }
    this.options.onTempoChange?.(change.tempo);
  }

  private publishJudge(judge: JudgeKind, seconds: number, channel?: string): void {
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
    this.onThemeEvent({ kind: 'judge', side, at: this.playClock() });
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
    this.maybeFireFullCombo();
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
  private maybeFireFullCombo(): void {
    if (this.fullComboFired) return;
    if (this.score.bad > 0 || this.score.poor > 0) return;
    if (this.score.total <= 0) return;
    if (this.tracker.combo < this.score.total) return;
    this.fullComboFired = true;
    this.onThemeEvent({ kind: 'full-combo', at: this.playClock() });
    log.info('FULL COMBO');
  }

  private render(seconds: number): void {
    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;
    const { width: designWidth, height: designHeight } = this.stageSize;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, this.app.renderer.resolution));
    setDesignPixelRatio(viewport.scale * this.app.renderer.resolution);
    // Only rebuild the static rect graphics when their backing dimensions actually change. The previous unconditional
    // `.clear().rect().fill()` chain ran on every rAF tick and rebuilt the GraphicsContext for each — Pixi v8 has no
    // change-detection built in.
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.designRoot.position.set(viewport.x, viewport.y);
    this.designRoot.scale.set(viewport.scale);
    this.stampDesignRect(this.stageSize);
    this.host?.setStageOrientation(resolveStageOrientation(this.stageSize));
    this.applyExitFadeAlpha();
    this.audioFrame = this.audioAnalyzer?.sample(this.playClock());
    this.perf.time('renderSkin', () => this.renderThemeLayer(designWidth, designHeight));
    // LR2 negative-BPM reversal: the event pump stops firing BGA cues there, so the cue clock is clamped (freeze, not
    // rewind) while an already-playing movie keeps running on the true clock. All other `seconds` readers here
    // (progress ratio, time readouts, judge-until comparisons) stay on the true clock.
    const reversalSeconds = this.timingResolver?.reversal?.seconds;
    const bgaCueSeconds = reversalSeconds === undefined ? seconds : Math.min(seconds, reversalSeconds);
    this.perf.time('renderBga', () => renderBga(this, seconds, bgaCueSeconds));
    this.perf.time('renderLanes', () => renderLanes(this, designWidth, designHeight));
    this.perf.time('renderNotes', () => renderNotes(this, seconds, designHeight));
    this.perf.time('renderShutter', () => renderShutter(this));
    this.perf.time('renderBombs', () => renderBombs(this));
    this.perf.time('renderText', () => renderText(this, designWidth, designHeight, seconds));
  }

  /**
   * Draws every active bomb into `bombLayerPool` (between the pool's `begin` / `end`). Defaults to the be-music skin's
   * bomb effect; themes that ship their own bomb sheet override it.
   */
  protected renderBombEffects(): void {
    renderBombEffects(this);
  }

  /**
   * The be-music skin's gameplay binding while the scene paints through a skin: lanes, notes, and hit effects are handed
   * to it as data and the skin draws them on its own canvas. `undefined` for themes, whose missing pieces (lanes, notes
   * without a cell, bombs) are drawn here in the built-in Phantom style instead.
   */
  get skinBinding(): BeMusicGameplayBinding | undefined {
    const skin = this.options.beMusicSkin;
    if (!skin || this.options.skinlessChromeRenderer) return undefined;
    if (!this.skinBindingInstance) {
      this.songImages = new SongImageCache({
        resolveSource: (song) =>
          this.source !== undefined && song.sourceId === this.source.id ? this.source : undefined,
      });
      this.skinBindingInstance = new BeMusicGameplayBinding(skin, {
        songImage: this.songImages.lookup,
        settings: this.beMusicSkinSettings,
        renderer: this.host?.app.renderer,
      });
    }
    return this.skinBindingInstance;
  }

  /**
   * Replaces the player's values for the be-music skin's `settings` (see the `beMusicSkinSettings` option); the skin
   * draws with them from the next frame. `undefined` goes back to the skin's defaults.
   */
  public setBeMusicSkinSettings(stored: Readonly<Record<string, unknown>> | undefined): void {
    this.beMusicSkinSettings = stored;
    this.skinBindingInstance?.setSettings(stored);
  }

  /**
   * Milliseconds since the chart's first beat for chrome count-ins. Before the play-start gate opens (`startTime` is
   * still +Infinity) it counts toward the scheduled intro end and holds just below zero if the BGA preload runs long.
   */
  resolveChartMs(): number | undefined {
    if (this.startTime === 0) return undefined;
    if (Number.isFinite(this.startTime))
      return this.tempoClock.chartSecondsAt(performance.now() - this.startTime) * 1000;
    return Math.min(-1, this.playClock() - this.sceneStartTime - this.scheduledIntroMs);
  }

  /** Records the latest key press / autoplay hit for input-reactive skin visuals. */
  private noteImpulse(channel: string): void {
    this.lastImpulseAt = this.playClock();
    this.lastImpulseKind = resolveBeMusicLaneKind(
      channel,
      resolveLr2LaneIndex(channel, this.chartPlayVariant),
      this.chartPlayVariant,
    );
  }

  /**
   * The lane covers of each play side with lanes, as {@link renderShutter} draws them (whether or not it does: a skin
   * that sets `drawsLaneCover` reads them to draw its own). The array and its entries are reused across frames.
   */
  resolveLaneCovers(): readonly BeMusicLaneCover[] {
    let cache = this.laneCovers;
    if (!cache || cache.channels !== this.laneChannels) {
      const covers: BeMusicLaneCover[] = [];
      for (const side of ['1P', '2P'] as const) {
        if (this.laneChannels.some((channel) => isChannelOnSide(channel, side))) {
          covers.push({ side, sudden: 0, hidden: 0, lift: 0 });
        }
      }
      cache = { channels: this.laneChannels, covers };
      this.laneCovers = cache;
    }
    const { laneCover, shutter } = this.options;
    for (const cover of cache.covers) {
      const mode = (cover.side === '1P' ? this.options.hiddenSudden1P : this.options.hiddenSudden2P) ?? 'OFF';
      fillLaneCover(cover, mode, shutter, laneCover);
      // A replay's SUDDEN+ / HIDDEN+ (the scene draws no LIFT, so that stays 0).
      const replayed = this.replayCovers?.find((entry) => entry.side === cover.side);
      if (replayed !== undefined) {
        cover.sudden = replayed.sudden;
        cover.hidden = replayed.hidden;
      }
    }
    return cache.covers;
  }

  /** What the player sees now in the play log's units: the drawn hi-speed on this scene's scale, HS-FIX and covers. */
  private resolvePlaylogView(): PlaylogViewState {
    const covers = this.resolveLaneCovers().map(({ side, sudden, hidden, lift }) => ({ side, sudden, hidden, lift }));
    const view: PlaylogViewState = {
      hiSpeed: this.hiSpeed,
      hiSpeedScale: BE_MUSIC_HI_SPEED_SCALE,
      hsFix: this.options.hsFix ?? 'OFF',
      covers,
    };
    // The visible time at the main BPM without `#SCROLL`, so another scale's replay can match it.
    const visibleMs = this.resolveVisibleMs(covers[0], this.chartBpmRange?.mainBpm, 1);
    if (visibleMs !== undefined && visibleMs > 0) view.visibleMs = visibleMs;
    // At the play log's precision, so cover fractions record without float noise.
    return roundPlaylogView(view);
  }

  /** The view the recorded play log starts from (`play.view`); later changes go through {@link updatePlaylogView}. */
  private startPlaylogView(): PlaylogViewState {
    const view = this.resolvePlaylogView();
    this.playlogViewCoalescer = createPlaylogViewCoalescer(view);
    return view;
  }

  /**
   * Per frame, once the lanes are laid out: while recording, sends the engine what changed in the view (at most one
   * change per 100 ms, so a held key records a few); while replaying, shows the recorded view at the playhead as far as
   * {@link CoreGameplayViewOptions.replayView} asks.
   */
  private updatePlaylogView(seconds: number): void {
    if (this.laneX.size === 0) return;
    if (this.replayViewCursor !== undefined) {
      const recorded = this.replayViewCursor.next(Math.round(seconds * 1_000_000));
      if (recorded !== undefined) this.applyReplayView(recorded);
      return;
    }
    const signals = this.sharedEngineInputSignals;
    if (this.playlogViewCoalescer === undefined || signals === undefined) return;
    const change = this.playlogViewCoalescer.observe(this.resolvePlaylogView(), performance.now());
    if (change !== undefined) signals.pushCommand({ kind: 'view', change });
  }

  /** Sends the engine the view change still held back by the coalescer, as the play ends ({@link updatePlaylogView}). */
  private flushPlaylogView(): void {
    const signals = this.sharedEngineInputSignals;
    if (this.replayViewCursor !== undefined || this.playlogViewCoalescer === undefined || signals === undefined) return;
    if (this.laneX.size === 0) return;
    const change = this.playlogViewCoalescer.flush(this.resolvePlaylogView());
    if (change !== undefined) signals.pushCommand({ kind: 'view', change });
  }

  /**
   * Shows a replay's recorded view over the viewer's own: the covers as recorded, and the hi-speed as recorded on this
   * scale, or matching the recorded visible time when it was played on another (`resolveReplayHiSpeed`).
   */
  private applyReplayView(recorded: PlaylogViewState): void {
    const replay = this.options.replayView ?? DEFAULT_PLAYLOG_VIEW_REPLAY;
    this.replayCovers = undefined;
    const view = resolveReplayView(recorded, this.resolvePlaylogView(), replay);
    if (replay.covers) this.replayCovers = view.covers;
    if (!replay.hiSpeed) return;
    const sudden = view.covers?.[0]?.sudden ?? 0;
    const mainBpm = this.chartBpmRange?.mainBpm;
    const hiSpeed = resolveReplayHiSpeed(view, BE_MUSIC_HI_SPEED_SCALE, (visibleMs) =>
      mainBpm === undefined
        ? undefined
        : resolveHiSpeedForVisibleMs(this.resolveLaneHeightPx(), sudden, 0, PIXELS_PER_BEAT, mainBpm, visibleMs),
    );
    const next = hiSpeed === undefined ? undefined : snapHiSpeed(hiSpeed);
    if (next === undefined || next === this.hiSpeed) return;
    this.hiSpeed = next;
    this.playerHiSpeed = snapHiSpeed(next / this.hsFixMultiplier) ?? this.playerHiSpeed;
    this.scrollHiSpeed.retarget(next, performance.now());
  }

  /**
   * How long a note stays visible below `cover` (the first play side's) at the current scroll and BPM, over the lanes
   * laid out last frame, divided by the `#SCROLL` × `#SPEED` rate at the playhead (0 while the chart scrolls backwards or
   * stands still, as beatoraja shows it). `undefined` until the lanes are laid out or while the BPM is unknown.
   */
  resolveVisibleMs(
    cover: BeMusicLaneCover | undefined,
    bpm: number | undefined,
    scrollRate: number,
  ): number | undefined {
    if (this.laneX.size === 0 || bpm === undefined || !(bpm > 0)) return undefined;
    return resolveNoteVisibleMs(
      this.resolveLaneHeightPx(),
      cover?.sudden ?? 0,
      cover?.lift ?? 0,
      PIXELS_PER_BEAT * this.hiSpeed,
      bpm,
      scrollRate,
    );
  }

  /** The tallest lane laid out last frame, in design pixels (0 before the lanes are laid out). */
  private resolveLaneHeightPx(): number {
    let laneHeight = 0;
    for (const lane of this.laneX.values()) {
      laneHeight = Math.max(laneHeight, lane.bottom - lane.top);
    }
    return laneHeight;
  }

  /**
   * Paints the chrome layers (`skinLayer` / `overlayLayer`) for this frame and sets their transforms together with the
   * BGA layer's. The default draws the skinless chrome through `skinlessChromeRenderer` (or the be-music skin's
   * `gameplay.renderChrome`) in raw design coordinates; themes override it to paint their own skin.
   */
  protected renderThemeLayer(_width: number, _height: number): void {
    this.skinLayerPool.begin();
    this.overlayLayerPool.begin();
    try {
      this.skinLayer.scale.set(1);
      this.skinLayer.position.set(0, 0);
      this.overlayLayer.scale.set(1);
      this.overlayLayer.position.set(0, 0);
      this.bgaLayer.scale.set(1);
      this.bgaLayer.position.set(0, 0);
      const context = {
        layer: this.skinLayer,
        overlayLayer: this.overlayLayer,
        layerPool: this.skinLayerPool,
        overlayLayerPool: this.overlayLayerPool,
        runtime: resolveSkinlessGameplayChromeRuntime(this),
      };
      if (this.options.skinlessChromeRenderer) {
        this.options.skinlessChromeRenderer(context);
      } else {
        this.skinBinding?.renderChrome({ ...context, layout: this.resolveBeMusicLayout() });
      }
    } finally {
      this.skinLayerPool.end();
      this.overlayLayerPool.end();
    }
  }

  /**
   * The gameplay layout handed to the be-music skin's chrome: stage, lanes, playfield bounds, judgement line, and BGA
   * rect. Lane geometry only changes with the chart and the stage, so it is rebuilt when the lane channels, the play
   * variant, or the stage (a rotation) change.
   */
  private resolveBeMusicLayout(): BeMusicGameplayLayout {
    const stage = this.beMusicStage ?? LEGACY_STAGE;
    const cached = this.beMusicLayout;
    if (
      cached &&
      cached.channels === this.laneChannels &&
      cached.variant === this.chartPlayVariant &&
      cached.stage === stage
    ) {
      return cached.layout;
    }
    const layout = resolveGameplayLayout(
      { laneChannels: this.laneChannels, playVariant: this.chartPlayVariant, layoutMode: this.layoutMode },
      stage,
    );
    this.beMusicLayout = { channels: this.laneChannels, variant: this.chartPlayVariant, stage, layout };
    return layout;
  }

  /** Redraws the design clip mask and background for a stage of `size`, when it differs from the last one drawn. */
  private stampDesignRect(size: GameplayStageSize): void {
    if (size.width === this.stampedDesignWidth && size.height === this.stampedDesignHeight) return;
    this.stampedDesignWidth = size.width;
    this.stampedDesignHeight = size.height;
    this.designClipMask.clear().rect(0, 0, size.width, size.height).fill(0xffffff);
    this.background.clear().rect(0, 0, size.width, size.height).fill(BG);
  }

  /** Approximate total duration of the loaded chart in seconds. */
  resolveSongDurationSeconds(): number {
    if (!this.song) {
      return 0;
    }
    return this.songDurationSeconds;
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
  private buildSharedEngineChart(): BeMusicJson {
    return this.resolvedChart ?? this.song!.chart;
  }

  private launchSharedEngine(): void {
    if (this.disposed || this.sharedEnginePromise) return;
    if (!this.song || !this.audioContext || !this.audioBus) return;
    // Build the chart the engine sees from the view's already-shuffled notes / mines / invisibles. The view's
    // `applyRandomMode` mutates `runtimeNote.channel` (NOT `event.channel`), so without this remap the engine
    // would extract notes from `chart.events` with their ORIGINAL pre-shuffle channels — its judge would target
    // a different lane than the visual the player is reading, so RANDOM / MIRROR / S-RANDOM / SCATTER would
    // make the chart unplayable. Rebuilding `events` with the post-shuffle channel keeps the engine and the
    // renderer on the same shuffle.
    const chart = this.buildSharedEngineChart();
    const callbacks: WebUiRuntimeCallbacks = {
      onFrame: (frame) => this.applyEngineFrame(frame),
      onCommand: (command) => this.applyEngineCommand(command),
      onJudgeCombo: (state) => this.applyEngineJudgeCombo(state),
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
        onTempoChange: (change) => this.followTempoChange(change),
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
        onRulesetResolved: (info) => this.applyResolvedRuleset(info),
        signal: (this.sharedEngineAbortController = new AbortController()).signal,
        // Keys stay live after the last note until the fade-out is over; the outro starts when the chart settles.
        holdAfterChart: {
          signal: (this.chartEndHold = new AbortController()).signal,
          onSettled: () => {
            this.sharedEngineChartSettled = true;
            this.drainSharedEngineSignals();
            this.handleSharedEngineChartFinished(undefined, true);
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
                view: this.startPlaylogView(),
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
        this.drainSharedEngineSignals();
        this.applyEngineSummary(summary);
        this.applyFinalComboSummary(summary);
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
        this.handleSharedEngineChartFinished(summary);
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
            this.beginExitSequence(() => this.options.onExit?.());
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
  private drainSharedEngineSignals(): void {
    if (!this.sharedEngineSignals) return;
    const result = drainWebUiSignals(
      this.sharedEngineSignals.uiSignals,
      {
        onFrame: (frame) => this.applyEngineFrame(frame),
        onCommand: (command) => this.applyEngineCommand(command),
        onJudgeCombo: (state) => this.applyEngineJudgeCombo(state),
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
  private applyEngineFrame(frame: Readonly<PlayerUiFramePayload>): void {
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
      this.audioContextStartTime =
        this.audioContext.currentTime - this.tempoClock.clockMsAt(frame.currentSeconds) / 1000;
      this.sharedEngineClockAnchored = true;
      this.nonstopMixer?.schedule(this.audioContextStartTime);
    }
    this.applyEngineSummary(frame.summary);
  }

  private applyEngineSummary(summary: Readonly<PlayerSummary>): void {
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
        this.onThemeEvent({ kind: 'gauge', previous, next });
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

  private applyFinalComboSummary(summary: Readonly<PlayerSummary>): void {
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
  private applyEngineCommand(command: PlayerUiCommand): void {
    switch (command.kind) {
      case 'flash-lane':
        this.noteImpulse(command.channel);
        this.flashKeyOnTimer(command.channel);
        break;
      case 'press-lane':
        this.noteImpulse(command.channel);
        this.pressedChannels.add(command.channel);
        this.startKeyOnTimer(command.channel);
        break;
      case 'release-lane':
        this.pressedChannels.delete(command.channel);
        this.releaseKeyOnTimer(command.channel);
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
        this.startKeyOnTimer(command.channel);
        // The engine's hold-until-beat command implicitly says "the LN is firing now"; bomb-flash on the head
        // mirrors the legacy autoJudge behavior so the lane still blinks a positive-feedback explosion at LN
        // start in autoplay.
        this.triggerBomb(command.channel);
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
        this.recordSharedEngineHistorySample(command.seconds);
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
    this.onThemeEvent({ kind: 'lane-command', command });
  }

  /** Keeps the engine's long-note style and its judge windows (converted to ms) for the skin runtime. */
  private applyResolvedRuleset(info: PlayerRulesetInfo): void {
    this.longNoteStyle = info.longNoteStyle;
    this.judgeWindows = toBeMusicJudgeWindows(info.windows);
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

  /**
   * Pushes one sample to {@link gaugeHistory} / {@link scoreHistory} using the current engine-derived
   * \`gaugeState.current\` and \`score.exScore\` snapshots. Called from the shared-engine command handler when
   * the engine reports a gauge / score change that doesn't flow through \`publishJudgeCombo\` (= empty POOR).
   * In legacy mode the same arrays are pushed exclusively from \`publishJudge\`.
   */
  private recordSharedEngineHistorySample(seconds: number): void {
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
  private applyEngineJudgeCombo(state: Readonly<PlayerJudgeComboSignalState>): void {
    if (state.judge === 'READY') return;
    this.tracker.combo = state.combo;
    if (state.combo > this.maxCombo) this.maxCombo = state.combo;
    if (this.courseCombo !== undefined) advanceCourseCombo(this.courseCombo, state.combo);
    const judgeKind = state.judge as JudgeKind;
    // Autoplay hits, mine BADs, and missed notes carry no `deltaMs`; the log skips them.
    this.judgeTimings.push(this.playClock(), state.judge, state.deltaMs, state.channel);
    this.publishJudge(judgeKind, this.currentSeconds(), state.channel);
    if ((judgeKind === 'PERFECT' || judgeKind === 'GREAT') && state.channel) {
      this.triggerBomb(state.channel, judgeKind);
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
  private handleSharedEngineChartFinished(finalSummary: Readonly<PlayerSummary> | undefined, held = false): void {
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
      themeFadeOutMs: this.themeTiming.fadeOutMs,
    });
    // Hold the play scene for roughly two measures after the final note. This keeps the last hit / final keysound from
    // being swallowed by an immediate result transition while still falling back to a one-frame defer on empty charts or
    // charts whose non-note tail has already carried us past the target.
    this.chartEndTimeout = window.setTimeout(() => {
      this.chartEndTimeout = undefined;
      if (this.disposed) return;
      this.drainSharedEngineSignals();
      if (finalSummary !== undefined) {
        this.applyEngineSummary(finalSummary);
        this.applyFinalComboSummary(finalSummary);
      }
      const finish = (): void => {
        const result = this.getResultData();
        if (this.options.onChartFinished && result) {
          this.options.onChartFinished(result);
          return;
        }
        this.options.onExit?.();
      };
      this.beginExitSequence(
        () => {
          if (!held) {
            finish();
            return;
          }
          // The outro is over: let the held play end, and show the result with its final summary.
          this.onHeldPlayEnded = () => {
            if (!this.disposed) finish();
          };
          this.flushPlaylogView();
          this.chartEndHold?.abort();
        },
        { fadeAudio: ending.fadeAudio, minFadeOutMs: ending.fadeOutMs },
      );
    }, ending.leadOutMs);
  }
}

/**
 * Returns whether `texture` is backed by a Pixi `VideoSource` (i.e. a `<video>` element). Used by the
 * `PrepareSystem` upload path to skip eager GPU uploads on video-backed textures: the underlying `<video>` may
 * not have decoded any frames at prepare time, and WebGPU's `copyExternalImageToTexture` rejects an unbacked
 * `<video>` with "Failed to import texture from video element that doesn't have back resource", which Pixi
 * propagates as a re-firing `OperationError` inside its rAF queue.
 */
function isVideoTextureSource(texture: Texture): boolean {
  return texture.source instanceof VideoSource;
}

// `clampSampleOffset` / `clampSampleDuration` / `startSampleNode` lived here while the gameplay view managed its
// own audio playback. With Phase 4b-i / 4b-ii routing every cue through {@link WebAudioSession}, the canonical
// implementations now live in `web-audio-session.ts` (re-exported there for tests) — this module no longer needs
// them.
