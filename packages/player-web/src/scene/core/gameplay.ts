import { Application, Texture, VideoSource } from 'pixi.js';
// Side-effect import: registers Pixi's `PrepareSystem` on the renderer so {@link CoreGameplayView.preparePixiUpload}
// can drive eager GPU uploads. Pixi v8 deliberately ships the prepare module out of the default bundle (it's a
// large optional system that not every app needs); the import has to land before any `Application.init` runs that
// expects `renderer.prepare` to exist.
import 'pixi.js/prepare';
import { mirrorBeatAtTempoReversal } from '@be-music/audio-renderer/triggers';
import { createTempoClock, type TempoClock } from '@be-music/player/core/engine';
import { resolveLr2LaneTimer } from '@be-music/lr2-skin/state';
import type { GaugeType } from '@be-music/player/ruleset';
import { DEFAULT_PLAYLOG_VIEW_REPLAY, type BeMusicPlaylog } from '@be-music/player/playlog';
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
import { resolveBeMusicLongNoteMode } from './long-note-tracker.ts';
import { nonstopBpmAt } from '@be-music/player/course';
import { LiveTempo } from '../live-tempo.ts';
import {
  clampPlayTempo,
  resolveReplayTempo,
  supportsLiveTempoChange,
  type ReplayTempo,
} from '../../runtime/play-tempo.ts';
import type { PixiScene, PixiSceneHost } from '../host.ts';
import type { SceneIdentity } from '../../host/family-kit.ts';
import { staggerDestroyTextures } from '../pixi-utils.ts';
import { BG, BGA, DESIGN_HEIGHT, DESIGN_WIDTH, FALLBACK_INTRO_DELAY_MS } from '../gameplay-constants.ts';
import { snapHiSpeed, stepPlayerHiSpeed } from '../hi-speed.ts';
import { resolveSideRelativeLaneIndex } from '../gameplay-lanes.ts';
import type { BeMusicGameplayLayout, BeMusicLaneCover, BeMusicStage } from '../../skin/be-music/types.ts';
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
import { logger } from '../../logger.ts';
import { QuitHoldController } from '../quit-hold.ts';
import { prepareSong } from '../../session/play/play-chart.ts';
import { resolveLaneCovers, resolveVisibleMs, updatePlaylogView } from '../../session/play/play-view-settings.ts';
import { beginExitSequence, getResultData } from '../../session/play/play-ending.ts';
import {
  drainSharedEngineSignals,
  interruptSharedEngine,
  launchSharedEngine,
  stopSharedEngine,
} from '../../session/play/play-engine.ts';
import {
  attachPlayInput,
  detachPlayInput,
  handleSharedEngineExitKey,
  handleTouchPointer,
  handleTouchPointerUp,
  handleVisibilityChange,
  handleWindowBlur,
  handleWindowFocus,
  togglePause,
} from '../../session/play/play-input.ts';
import { disposePlayAudio, prepareAudio, prepareBga } from '../../session/play/play-media.ts';
import { resolveLaneGeometry, resolveSkinlessGameplayChromeRuntime } from '../../view/built-in/play-chrome.ts';
import { disposeBgaVideos, renderBga } from '../../view/shared/bga-renderer.ts';
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
  get paintsThroughBeMusicSkin(): boolean {
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
    attachThemeLayers: () => this.attachThemeLayers(),
    renderThemeLayer: (width, height) => this.renderThemeLayer(width, height),
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
    attachPlayInput.call(this, host);
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
    detachPlayInput.call(this);
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
      launchSharedEngine.call(this);
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
    togglePause.call(this);
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

  /** Leaves the play the way Escape does: the theme's fade-out runs, then the host's `onExit` fires. */
  public requestExit(): void {
    beginExitSequence.call(this, () => {
      interruptSharedEngine.call(this, 'escape');
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
    disposeBgaVideos.call(this);
    // Hard-stop any active recording before tearing down the bus. `GameplayRecorder.dispose` calls
    // `MediaRecorder.stop()` synchronously (no chunk-flush wait) and disconnects its audio tap from the bus's output
    // node, so the bus can be disposed cleanly afterwards.
    this.recorder?.dispose();
    this.recorder = undefined;
    stopSharedEngine.call(this);
    disposePlayAudio.call(this, options);
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

  readonly handleVisibilityChange = (): void => handleVisibilityChange.call(this);

  readonly handleWindowBlur = (): void => handleWindowBlur.call(this);

  readonly handleWindowFocus = (): void => handleWindowFocus.call(this);

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

  readonly handleSharedEngineExitKey = (event: KeyboardEvent): void => handleSharedEngineExitKey.call(this, event);

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

  readonly handleTouchPointer = (event: PointerEvent): void => handleTouchPointer.call(this, event);

  readonly handleTouchPointerUp = (event: PointerEvent): void => handleTouchPointerUp.call(this, event);

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
      drainSharedEngineSignals.call(this);
      updatePlaylogView.call(this, seconds);
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
   * Captures the current play session as a {@link PixiGameplayResultData} snapshot. Returns `undefined` when no song is
   * mounted (defensive — normal flow only calls this after `prepareSong` has run). The snapshot is a plain object so
   * the host can hand it to a result scene that outlives this view.
   */
  public getResultData(): PixiGameplayResultData | undefined {
    return getResultData.call(this);
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

  /** The lane covers each play side shows (`resolveLaneCovers` in `play-view-settings.ts`), for the playfield and chrome. */
  resolveLaneCovers(): readonly BeMusicLaneCover[] {
    return resolveLaneCovers.call(this);
  }

  /** How long a note stays visible below `cover` (`resolveVisibleMs` in `play-view-settings.ts`), for the chrome. */
  resolveVisibleMs(
    cover: BeMusicLaneCover | undefined,
    bpm: number | undefined,
    scrollRate: number,
  ): number | undefined {
    return resolveVisibleMs.call(this, cover, bpm, scrollRate);
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
