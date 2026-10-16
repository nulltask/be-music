import type { Texture } from 'pixi.js';
import type { BrowserSongAssetSource, BrowserSongEntry } from '../../collection/types.ts';
import type { PixiScene, PixiSceneHost } from '../host.ts';
import type { SceneIdentity } from '../../host/family-kit.ts';
import { resolveStageOrientation, type GameplayLayoutMode } from '@be-music/skin-sdk';
import { BeMusicGameplayBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import type { BeMusicStage } from '../../skin/be-music/types.ts';
import { PHANTOM_BOMB_DURATION_MS } from '../../skins/phantom/playfield.ts';
import { logger } from '../../logger.ts';
import { drainSharedEngineSignals } from '../../session/play/play-engine.ts';
import { updatePlaylogView } from '../../session/play/play-view-settings.ts';
import { collectBgaTargets, LEGACY_STAGE_SIZE, renderBuiltInChrome } from '../../view/built-in/play-chrome.ts';
import type { PlaySessionTheme } from '../../session/play/play-session-theme.ts';
import { build, render } from '../../view/shared/play-frame.ts';
import type { PlayChrome } from '../../view/shared/playfield/context.ts';
import { uploadTextures } from '../../view/shared/texture-upload.ts';
import type { PlayfieldMeasureLine, PlayfieldSkin } from '../../view/types.ts';
import { KEY_ON_FADE_OUT_MS } from '../gameplay-constants.ts';
import { resolveLr2LaneIndex } from '../gameplay-lanes.ts';
import type {
  GameplayBgaTarget,
  GameplayLaneRect,
  GameplayStageSize,
  GameplayThemeEvent,
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
  GameplayStageSize,
  GameplayThemeEvent,
  GameplayThemeNoteCell,
  GameplayThemeNoteKind,
  GameplayThemeTiming,
} from './gameplay-theme.ts';
export { KEY_ON_FADE_OUT_MS } from '../gameplay-constants.ts';

const log = logger('gameplay');

const IDENTITY: SceneIdentity = { kind: 'play', family: 'built-in' };

/** Design px above a lane's top through which notes keep drawing as they scroll in (standard layout). */
const NOTE_OVERSCAN = 48;

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
const BE_MUSIC_THEME_TIMING: GameplayThemeTiming = { ...DEFAULT_THEME_TIMING, fadeOutMs: 450 };

/**
 * The LR2 family's gameplay scene base: a play session (`PlaySession`, which it extends through `CoreGameplayState`)
 * that is its own view. It adds the layers, the per-frame tick and the protected theme hooks the LR2 family's
 * `PixiGameplayView` overrides — `prepareTheme`, `renderThemeLayer`, `collectBgaTargets`, `resolveThemeLaneRect`,
 * `resolveThemeNoteCell`, `resolveThemeMeasureLines`, `renderThemeText`, `themeTiming`, `onThemeEvent`, … — each of
 * which defaults to the skinless behaviour, so the class paints a complete scene on its own (with a host's
 * `skinlessChromeRenderer`, or a be-music skin).
 *
 * The built-in play screen no longer runs on it: `createPlayScene` pairs a play session with the built-in play view
 * (`view/built-in/play-view.ts`). The class stays only while the LR2 view needs it.
 *
 * The play's parts live in their own modules (`session/play/*`, `view/shared/*`, `view/built-in/*`), which take the
 * scene as their context and read and write its state through their own interfaces (`PlayChartContext`,
 * `PlayfieldContext`, …). The state lives in {@link CoreGameplayState}, which the scene extends; it has no `private` /
 * `protected` modifier so the scene satisfies those interfaces, and it is not part of the scene's API. The theme hooks
 * stay `protected`; the shared playfield and the session call them through {@link playfieldSkin}, {@link chrome} and
 * {@link theme}.
 */
export class CoreGameplayView<TOptions extends CoreGameplayViewOptions = CoreGameplayViewOptions>
  extends CoreGameplayState
  implements PixiScene
{
  declare readonly options: TOptions;

  /** How the scene's theme hooks answer the shared playfield. */
  readonly playfieldSkin: PlayfieldSkin;
  /** The theme's drawing around the shared playfield, from the hooks. */
  readonly chrome: PlayChrome;

  public constructor(options: TOptions = {} as TOptions) {
    super(options);
    this.beMusicSkinSettings = options.beMusicSkinSettings;
    // The hooks stay `protected` for the theme families that override them; these objects call them.
    const stage = (): GameplayStageSize => this.stageSize;
    const ownsLanes = (): boolean => this.themeOwnsPlayfield;
    this.playfieldSkin = {
      get stage() {
        return stage();
      },
      get ownsLanes() {
        return ownsLanes();
      },
      laneRect: (channel, stage) => this.resolveThemeLaneRect(channel, stage.width, stage.height),
      noteCell: (kind, channel) => this.resolveThemeNoteCell(kind, resolveLr2LaneIndex(channel, this.chartPlayVariant)),
      measureLines: () => this.resolveThemeMeasureLines(),
      bgaTargets: (out) => this.collectBgaTargets(out),
      bombCell: () => undefined,
      bombDurationMs: (channel) => this.resolveBombDurationMs(channel),
      keyOnFadeMs: (channel) => this.keyOnFadeMsOf(channel),
    };
    this.chrome = {
      attachLayers: () => this.attachThemeLayers(),
      draw: (width, height) => this.renderThemeLayer(width, height),
      drawText: (seconds) => this.renderThemeText(seconds),
      bombRetired: (channel) => this.onThemeEvent({ kind: 'bomb-retired', channel }),
    };
  }

  private keyOnFadeMsOf(channel: string): number {
    const timerId = this.resolveKeyOnTimerId(channel);
    return timerId === undefined ? KEY_ON_FADE_OUT_MS : this.resolveKeyOnFadeMs(timerId);
  }

  public get identity(): SceneIdentity {
    return IDENTITY;
  }

  /** The running play the shared playfield and the chrome read (`ctx.play`): the scene is its own play. */
  get play(): this {
    return this;
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
    collectBgaTargets(this, out);
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
   * The theme's measure lines for this frame, each repeated at every measure, or `undefined` to let the scene draw its
   * fallback bar. Default: `undefined`.
   */
  protected resolveThemeMeasureLines(): readonly PlayfieldMeasureLine[] | undefined {
    return undefined;
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
   * What the play session it extends asks of its view, from the theme hooks above: the hooks stay `protected` for the
   * theme families that override them, so the session calls them through this object.
   */
  override readonly theme: PlaySessionTheme = {
    timing: () => this.themeTiming,
    moment: (moment) => this.onThemeEvent(moment),
    keyOnFadeMs: (channel) => this.keyOnFadeMsOf(channel),
    stage: () => this.stageSize,
  };

  /**
   * Loads the play ({@link PlaySession.load}) behind the scene: it attaches nothing to the stage and no listeners, so a
   * decide splash can show while it runs; the host then shows the scene ({@link enter}) and calls {@link start}. Run
   * while the scene is already showing (a play with no splash), it draws the playfield in its loading state as assets
   * decode instead.
   */
  public async prepare(host: PixiSceneHost, song: BrowserSongEntry, source?: BrowserSongAssetSource): Promise<void> {
    build(this, host);
    // Hidden until {@link start} fires, so a scene shown before the play begins draws nothing of it yet.
    this.root.visible = false;
    await this.load(song, source);
  }

  protected override onChartPrepared(): void {
    this.root.visible = this.shown;
    if (this.entered) this.startAnimationLoop();
  }

  /**
   * Shows the play (see {@link PixiScene.enter}): wires its keys (ESC / F5 / Space / arrows, the Backspace hold),
   * touch lanes, canvas focus and the auto-pause on losing focus, and resumes drawing if {@link exit} stopped it. The
   * play itself starts with {@link start}.
   */
  public enter(host: PixiSceneHost): void {
    if (this.disposed || this.entered) return;
    build(this, host);
    this.attachInput(host);
    if (this.resumeAnimationOnEnter) this.startAnimationLoop();
  }

  /**
   * Stops drawing and taking input (see {@link PixiScene.exit}). The play's engine and sound run on — a play that has
   * ended keeps its audio tail until {@link dispose}.
   */
  public exit(): void {
    if (!this.entered) return;
    this.resumeAnimationOnEnter = this.tickerAttached;
    this.stopAnimationLoop();
    this.detachInput();
  }

  protected override onShown(): void {
    this.root.visible = true;
  }

  protected override onStarted(): void {
    this.startAnimationLoop();
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

  public override dispose(options: CoreGameplayDisposeOptions = {}): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // Detach the gameplay tick and the input listeners. The shared `Application` keeps running for the next active
    // scene — only the per-scene state below is freed.
    this.exit();
    this.stopAnimationLoop();
    this.stopPlay(options);
    // Detach our subtree from the host's stage. The host owns the `Application` lifetime; we just stop contributing to
    // its scene graph.
    if (this.root.parent) {
      this.root.parent.removeChild(this.root);
    }
    // Free per-view textures, spread across frames (`releaseTextures`): skin chrome + every #BGA frame slot + per-key
    // bombs, often several hundred entries. Let the theme release its own per-view state first; any textures it hands
    // back join the queue after the scene's own.
    const themeTextures = this.disposeTheme();
    this.releaseTextures([
      ...this.textures.values(),
      ...this.bgaTextures.values(),
      ...this.bgaLayerTextures.values(),
      ...themeTextures,
    ]);
    this.textures.clear();
    this.bgaTextures.clear();
    this.bgaLayerTextures.clear();
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
    this.bgaTargetsScratch.length = 0;
    this.clearPlay();
  }

  /** Uploads `textures` to the GPU now (`uploadTextures`), so the first frame that draws them does not stall. */
  override async preparePixiUpload(textures: Iterable<Texture | undefined>): Promise<void> {
    await uploadTextures(this.host?.app.renderer, textures, () => this.disposed);
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
      drainSharedEngineSignals(this);
      updatePlaylogView(this, seconds);
    }
    this.perf.time('updateFps', () => this.updateFps());
    this.perf.time('updateScores', () => {
      this.updateDisplayedScore();
      this.updateThemeState();
    });
    this.perf.time('render', () => {
      render(this, seconds);
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
   * Paints the chrome layers (`skinLayer` / `overlayLayer`) for this frame and sets their transforms together with the
   * BGA layer's. The default draws the skinless chrome through `skinlessChromeRenderer` (or the be-music skin's
   * `gameplay.renderChrome`) in raw design coordinates; themes override it to paint their own skin.
   */
  protected renderThemeLayer(_width: number, _height: number): void {
    renderBuiltInChrome(this, this.options.skinlessChromeRenderer);
  }
}
