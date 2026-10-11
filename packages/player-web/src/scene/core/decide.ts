import { Color, Container, Graphics } from 'pixi.js';
import { type PixiSceneHost } from '../host.ts';
import { logger } from '../../logger.ts';
import { resolveSongSource } from '../../collection/collection.ts';
import type { BrowserSongCollection, BrowserSongEntry } from '../../collection/types.ts';
import type { BeMusicEffectLevel, BeMusicPlayOptions, BeMusicSkin } from '../../skin/be-music/types.ts';
import { BeMusicDecideBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import {
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
} from './viewport.ts';
import { DEFAULT_PLAY_OPTIONS } from './select.ts';

const log = logger('decide');

const BG = new Color('#05070b');

/** What a key press does on the decide screen. */
export type DecideKeyAction = 'continue' | 'cancel';

/**
 * Maps a key press to its decide-screen action: Enter / Space skip ahead to the play, Escape goes back to select.
 * Auto-repeats are ignored so the Enter held from picking the chart doesn't skip the screen.
 */
export function resolveDecideKeyAction(event: { key: string; repeat: boolean }): DecideKeyAction | undefined {
  if (event.repeat) return undefined;
  if (event.key === 'Escape') return 'cancel';
  if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') return 'continue';
  return undefined;
}

export interface CoreDecideTarget {
  /** The chart about to be played. */
  song: BrowserSongEntry;
  /** The song collection, for the song's images. Without one `frame.songImage` reports none. */
  collection?: BrowserSongCollection;
}

export interface CoreDecideViewOptions {
  /** The be-music skin whose `decide` screen is drawn. The view shows nothing (and continues at once) without one. */
  beMusicSkin: BeMusicSkin;
  /** Showmanship level handed to the skin. Defaults to `'full'`. */
  beMusicEffects?: BeMusicEffectLevel;
  /** The options the play will run with (`frame.playOptions`). Defaults to the select scene's defaults. */
  playOptions?: Readonly<BeMusicPlayOptions>;
  /** Fired once when the screen's time is up or the player skips ahead (Enter / Space / click). */
  onContinue?: () => void;
  /** Fired once when the player backs out with Escape. Falls back to {@link onContinue} when not provided. */
  onCancel?: () => void;
}

/**
 * The be-music skin's decide screen, shown between picking a chart and the play: draws `skin.decide` every frame for
 * its `durationMs`, then continues. Enter / Space / a click skip ahead and Escape cancels back to select, as on the LR2
 * decide scene (without its `#STARTINPUT` input lock, which a be-music skin doesn't declare). The view owns its scene
 * graph and the song images it loaded, both released by {@link dispose}.
 */
export class CoreDecideView {
  private host: PixiSceneHost | undefined;
  private readonly sceneRoot = new Container();
  private readonly root = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly designClipMask = new Graphics();
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  private binding: BeMusicDecideBinding | undefined;
  private songImages: SongImageCache | undefined;
  private target: CoreDecideTarget | undefined;
  private mountedAt = 0;
  private advanceTimer: ReturnType<typeof setTimeout> | undefined;
  private tickerAttached = false;
  private disposed = false;
  private finished = false;
  private readonly options: CoreDecideViewOptions;
  private readonly tickerHandle = (): void => {
    if (!this.disposed) this.render();
  };

  public constructor(options: CoreDecideViewOptions) {
    this.options = options;
  }

  /** How long the screen shows before continuing: the skin's `decide.durationMs`, 0 when it has no decide screen. */
  public get durationMs(): number {
    return this.binding?.durationMs ?? 0;
  }

  public async mount(host: PixiSceneHost, target: CoreDecideTarget): Promise<void> {
    this.host = host;
    this.target = target;
    const skin = this.options.beMusicSkin;
    this.sceneRoot.label = 'decide/scene';
    this.root.label = 'decide/root';
    this.viewportBackground.label = 'decide/viewport-bg';
    this.designClipMask.label = 'decide/design-clip';
    this.sceneRoot.addChild(this.viewportBackground, this.root);
    if (skin.decide) {
      const collection = target.collection;
      this.songImages = new SongImageCache({
        resolveSource: (song) => (collection ? resolveSongSource(collection, song) : undefined),
      });
      this.binding = new BeMusicDecideBinding(skin, { songImage: this.songImages.lookup });
      this.root.addChild(this.binding.view);
    }
    this.root.addChild(this.designClipMask);
    this.root.mask = this.designClipMask;
    host.app.stage.addChild(this.sceneRoot);
    window.addEventListener('keydown', this.handleKeyDown);
    host.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.mountedAt = performance.now();
    this.advanceTimer = setTimeout(() => {
      this.advanceTimer = undefined;
      this.finish('continue');
    }, this.durationMs);
    this.render();
    host.app.ticker.add(this.tickerHandle);
    this.tickerAttached = true;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.advanceTimer !== undefined) {
      clearTimeout(this.advanceTimer);
      this.advanceTimer = undefined;
    }
    if (this.tickerAttached) {
      this.host?.app.ticker.remove(this.tickerHandle);
      this.tickerAttached = false;
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    this.host?.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.sceneRoot.parent?.removeChild(this.sceneRoot);
    try {
      this.binding?.dispose();
      this.binding = undefined;
      this.songImages?.dispose();
      this.songImages = undefined;
      this.sceneRoot.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('decide cleanup threw', error);
    }
    this.host = undefined;
  }

  private render(): void {
    const host = this.host;
    const target = this.target;
    if (!host || !target) return;
    const { width: designWidth, height: designHeight } = resolveBeMusicSkinStage(this.options.beMusicSkin);
    const screenWidth = host.app.screen.width || designWidth;
    const screenHeight = host.app.screen.height || designHeight;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, host.app.renderer.resolution));
    setDesignPixelRatio(viewport.scale * host.app.renderer.resolution);
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.root.position.set(viewport.x, viewport.y);
    this.root.scale.set(viewport.scale);
    if (this.cachedDesignWidth !== designWidth || this.cachedDesignHeight !== designHeight) {
      this.designClipMask.clear().rect(0, 0, designWidth, designHeight).fill(0xffffff);
      this.cachedDesignWidth = designWidth;
      this.cachedDesignHeight = designHeight;
    }
    const now = performance.now();
    this.binding?.render({
      designWidth,
      designHeight,
      nowMs: now,
      elapsedMs: now - this.mountedAt,
      song: target.song,
      playOptions: this.options.playOptions ?? DEFAULT_PLAY_OPTIONS,
      effects: this.options.beMusicEffects ?? 'full',
      audio: undefined,
    });
  }

  private finish(action: DecideKeyAction): void {
    if (this.finished || this.disposed) return;
    this.finished = true;
    if (action === 'cancel') (this.options.onCancel ?? this.options.onContinue)?.();
    else this.options.onContinue?.();
  }

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (this.disposed) return;
    const action = resolveDecideKeyAction(event);
    if (!action) return;
    event.preventDefault();
    this.finish(action);
  };

  private readonly handlePointerDown = (): void => {
    this.finish('continue');
  };
}
