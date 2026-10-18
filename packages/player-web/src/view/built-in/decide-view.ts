/**
 * The built-in family's decide screen: a be-music skin's `decide` drawn on its stage, letterboxed into the window.
 * It draws the decide session's frames and turns a click into a `continue` intent; the session times the screen.
 */

import { resolveStageOrientation } from '@be-music/skin-sdk';
import { Color, Container, Graphics } from 'pixi.js';
import type { BrowserSongAssetSource } from '../../collection/types.ts';
import type { BuiltInKit } from '../../host/family-kit.ts';
import { logger } from '../../logger.ts';
import type { PixiSceneHost } from '../../scene/host.ts';
import {
  resolveDesignTextResolution,
  resolveScaledViewport,
  setDesignPixelRatio,
  setDesignTextResolution,
} from '../../stage/viewport.ts';
import {
  BeMusicDecideBinding,
  resolveBeMusicDecideDurationMs,
  resolveBeMusicSkinStage,
} from '../../skin/be-music/binding.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import type { DecideFrame, DecideIntent, DecideView, IntentSink, SceneViewTiming } from '../types.ts';

const log = logger('decide');

const BG = new Color('#05070b');

export interface BuiltInDecideViewOptions {
  /** Where the chart's files are, for its images (`frame.songImage`); every image reads as unavailable without one. */
  readonly source?: BrowserSongAssetSource;
}

/**
 * The skin's timing on the decide screen: input opens at once (a be-music skin has no input delay), and the screen
 * moves on after the skin's `decide.durationMs`, at once for a skin without a decide screen. No fade-out: the skin's
 * own drawing covers it.
 */
export function resolveBuiltInDecideTiming(kit: BuiltInKit): SceneViewTiming {
  return {
    inputDelayMs: 0,
    autoAdvanceMs: kit.skin.decide !== undefined ? resolveBeMusicDecideDurationMs(kit.skin) : 0,
    fadeOutMs: 0,
  };
}

/** The built-in decide view. See the module comment. */
export class BuiltInDecideView implements DecideView {
  public readonly family = 'built-in' as const;
  public readonly root: Container = new Container();
  public readonly timing: SceneViewTiming;
  private readonly designRoot = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly designClipMask = new Graphics();
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  private kit: BuiltInKit;
  private readonly source: BrowserSongAssetSource | undefined;
  private binding: BeMusicDecideBinding | undefined;
  private songImages: SongImageCache | undefined;
  private host: PixiSceneHost | undefined;
  private emit: IntentSink<DecideIntent> | undefined;
  private built = false;
  private disposed = false;

  public constructor(kit: BuiltInKit, options: BuiltInDecideViewOptions = {}) {
    this.kit = kit;
    this.source = options.source;
    this.timing = resolveBuiltInDecideTiming(kit);
  }

  /**
   * Takes the player's new settings and effect level for the skin; the next frame draws with them. The skin itself
   * stays: another skin needs another view.
   */
  public updateKit(kit: BuiltInKit): void {
    if (kit.skin !== this.kit.skin) {
      log.warn('a decide view keeps its skin; ignoring a kit of another skin');
      return;
    }
    this.kit = kit;
    this.binding?.setSettings(kit.settings);
  }

  /** Builds the scene graph on the first attach, then listens for clicks on the canvas. */
  public attach(host: PixiSceneHost, emit: IntentSink<DecideIntent>): void {
    if (this.disposed) return;
    if (!this.built) this.build(host);
    this.host = host;
    this.emit = emit;
    host.app.canvas.addEventListener('pointerdown', this.handlePointerDown);
  }

  public detach(): void {
    this.host?.app.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.host = undefined;
    this.emit = undefined;
  }

  public dispose(): void {
    if (this.disposed) return;
    this.detach();
    this.disposed = true;
    this.root.parent?.removeChild(this.root);
    try {
      this.binding?.dispose();
      this.binding = undefined;
      this.songImages?.dispose();
      this.songImages = undefined;
      this.root.destroy({ children: true, context: true });
    } catch (error) {
      log.warn('decide cleanup threw', error);
    }
  }

  public draw(frame: DecideFrame): void {
    const host = this.host;
    if (host === undefined || this.disposed) return;
    const skin = this.kit.skin;
    const screen = host.app.screen;
    const { width: designWidth, height: designHeight } = resolveBeMusicSkinStage(
      skin,
      screen.width > 0 && screen.height > 0 ? screen : undefined,
    );
    const screenWidth = screen.width || designWidth;
    const screenHeight = screen.height || designHeight;
    const viewport = resolveScaledViewport(screenWidth, screenHeight, designWidth, designHeight);
    setDesignTextResolution(resolveDesignTextResolution(viewport.scale, host.app.renderer.resolution));
    setDesignPixelRatio(viewport.scale * host.app.renderer.resolution);
    if (this.cachedScreenWidth !== screenWidth || this.cachedScreenHeight !== screenHeight) {
      this.viewportBackground.clear().rect(0, 0, screenWidth, screenHeight).fill(BG);
      this.cachedScreenWidth = screenWidth;
      this.cachedScreenHeight = screenHeight;
    }
    this.designRoot.position.set(viewport.x, viewport.y);
    this.designRoot.scale.set(viewport.scale);
    host.setStageOrientation(resolveStageOrientation({ width: designWidth, height: designHeight }));
    if (this.cachedDesignWidth !== designWidth || this.cachedDesignHeight !== designHeight) {
      this.designClipMask.clear().rect(0, 0, designWidth, designHeight).fill(0xffffff);
      this.cachedDesignWidth = designWidth;
      this.cachedDesignHeight = designHeight;
    }
    this.binding?.render({
      designWidth,
      designHeight,
      nowMs: frame.clock.nowMs,
      elapsedMs: frame.clock.nowMs - frame.clock.enteredAtMs,
      song: frame.chart,
      playOptions: frame.playOptions,
      effects: this.kit.effects ?? 'full',
      audio: undefined,
    });
  }

  /** Builds the scene graph under {@link root} and the skin's binding, once. */
  private build(host: PixiSceneHost): void {
    this.built = true;
    const skin = this.kit.skin;
    this.root.label = 'decide/scene';
    this.designRoot.label = 'decide/root';
    this.viewportBackground.label = 'decide/viewport-bg';
    this.designClipMask.label = 'decide/design-clip';
    this.root.addChild(this.viewportBackground, this.designRoot);
    if (skin.decide !== undefined) {
      const source = this.source;
      this.songImages = new SongImageCache({ resolveSource: () => source });
      this.binding = new BeMusicDecideBinding(skin, {
        songImage: this.songImages.lookup,
        settings: this.kit.settings,
        renderer: host.app.renderer,
      });
      this.designRoot.addChild(this.binding.view);
    }
    this.designRoot.addChild(this.designClipMask);
    this.designRoot.mask = this.designClipMask;
  }

  private readonly handlePointerDown = (): void => {
    this.emit?.({ type: 'continue' });
  };
}
