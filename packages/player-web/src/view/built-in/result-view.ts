/**
 * The built-in family's result screen: a be-music skin's `result` drawn on its stage, letterboxed into the window. It
 * draws the result session's frames and turns a click into a `continue` intent (a press on, as Enter); the session
 * plays the jingle and steps the screen.
 */

import { computeScoreRate, resolveIidxRankLabel } from '@be-music/player/core/scoring';
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
} from '../../scene/core/viewport.ts';
import { BeMusicResultBinding, resolveBeMusicSkinStage } from '../../skin/be-music/binding.ts';
import { SongImageCache } from '../../skin/be-music/song-images.ts';
import type { IntentSink, ResultFrame, ResultIntent, ResultView, SceneViewTiming } from '../types.ts';

const log = logger('result');

const BG = new Color('#05070b');

/**
 * How long the built-in result screen waits before it takes input: the 1500 ms of LR2's default result skin
 * (`#STARTINPUT`), so the panel's slide-in plays out before a key can skip it.
 */
export const BUILT_IN_RESULT_INPUT_DELAY_MS = 1500;

/** The built-in result screen's timing: input after {@link BUILT_IN_RESULT_INPUT_DELAY_MS}, no auto advance or fade. */
export const BUILT_IN_RESULT_TIMING: SceneViewTiming = {
  inputDelayMs: BUILT_IN_RESULT_INPUT_DELAY_MS,
  fadeOutMs: 0,
};

/** The rank label a skin shows: the IIDX rank of the EX score, `AAA` for a chart without notes. */
export function resolveBuiltInRankLabel(exScore: number, total: number): string {
  return total <= 0 ? 'AAA' : resolveIidxRankLabel(exScore, total);
}

export interface BuiltInResultViewOptions {
  /**
   * Where the result's chart files are, for its images (`frame.songImage`); every image reads as unavailable without
   * one.
   */
  readonly source?: BrowserSongAssetSource;
}

/** The built-in result view. See the module comment. */
export class BuiltInResultView implements ResultView {
  public readonly family = 'built-in' as const;
  public readonly root: Container = new Container();
  public readonly timing: SceneViewTiming = BUILT_IN_RESULT_TIMING;
  private readonly designRoot = new Container();
  private readonly viewportBackground = new Graphics();
  private readonly background = new Graphics();
  private readonly skinLayer = new Container();
  private readonly designClipMask = new Graphics();
  private cachedScreenWidth = -1;
  private cachedScreenHeight = -1;
  private cachedDesignWidth = -1;
  private cachedDesignHeight = -1;
  private kit: BuiltInKit;
  private readonly source: BrowserSongAssetSource | undefined;
  /** Draws the skin's result; made on the first frame, when the host's renderer is at hand. */
  private binding: BeMusicResultBinding | undefined;
  private songImages: SongImageCache | undefined;
  private host: PixiSceneHost | undefined;
  private emit: IntentSink<ResultIntent> | undefined;
  private built = false;
  private disposed = false;

  public constructor(kit: BuiltInKit, options: BuiltInResultViewOptions = {}) {
    this.kit = kit;
    this.source = options.source;
  }

  /**
   * Takes the player's new settings and effect level for the skin; the next frame draws with them. The skin itself
   * stays: another skin needs another view.
   */
  public updateKit(kit: BuiltInKit): void {
    if (kit.skin !== this.kit.skin) {
      log.warn('a result view keeps its skin; ignoring a kit of another skin');
      return;
    }
    this.kit = kit;
    this.binding?.setSettings(kit.settings);
  }

  /** Builds the scene graph on the first attach, then listens for clicks on the canvas. */
  public attach(host: PixiSceneHost, emit: IntentSink<ResultIntent>): void {
    if (this.disposed) return;
    if (!this.built) this.build();
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
      log.warn('result cleanup threw', error);
    }
  }

  public draw(frame: ResultFrame): void {
    const host = this.host;
    if (host === undefined || this.disposed) return;
    const screen = host.app.screen;
    const stage = resolveBeMusicSkinStage(this.kit.skin, screen.width > 0 && screen.height > 0 ? screen : undefined);
    const screenWidth = screen.width || stage.width;
    const screenHeight = screen.height || stage.height;
    const { width: designWidth, height: designHeight } = stage;
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
    host.setStageOrientation(resolveStageOrientation(stage));
    if (this.cachedDesignWidth !== designWidth || this.cachedDesignHeight !== designHeight) {
      this.designClipMask.clear().rect(0, 0, designWidth, designHeight).fill(0xffffff);
      this.background.clear().rect(0, 0, designWidth, designHeight).fill(BG);
      this.cachedDesignWidth = designWidth;
      this.cachedDesignHeight = designHeight;
    }
    const binding = this.ensureBinding(host);
    const { nowMs, enteredAtMs } = frame.clock;
    const { result } = frame;
    // Once the graphs are shown (drawn, or skipped with Enter), the skin's entrance jumps to its settled layout.
    const settled = frame.graphShownAtMs !== undefined && nowMs >= frame.graphShownAtMs;
    binding.render({
      designWidth,
      designHeight,
      result,
      rankLabel: resolveBuiltInRankLabel(result.score.exScore, result.score.total),
      ratePercent: computeScoreRate(result.score) * 100,
      elapsedMs: settled ? Number.POSITIVE_INFINITY : nowMs - enteredAtMs,
      nowMs,
      effects: this.kit.effects ?? 'full',
    });
  }

  /** Builds the scene graph under {@link root}, once. */
  private build(): void {
    this.built = true;
    this.root.label = 'result/scene';
    this.designRoot.label = 'result/root';
    this.viewportBackground.label = 'result/viewport-bg';
    this.background.label = 'result/background';
    this.skinLayer.label = 'result/skin';
    this.designClipMask.label = 'result/design-clip';
    this.root.addChild(this.viewportBackground, this.designRoot);
    this.designRoot.addChild(this.background, this.skinLayer, this.designClipMask);
    this.designRoot.mask = this.designClipMask;
  }

  private ensureBinding(host: PixiSceneHost): BeMusicResultBinding {
    if (this.binding !== undefined) return this.binding;
    const source = this.source;
    this.songImages = new SongImageCache({ resolveSource: () => source });
    this.binding = new BeMusicResultBinding(this.kit.skin, {
      songImage: this.songImages.lookup,
      settings: this.kit.settings,
      renderer: host.app.renderer,
    });
    this.skinLayer.addChild(this.binding.view);
    return this.binding;
  }

  private readonly handlePointerDown = (): void => {
    this.emit?.({ type: 'continue' });
  };
}
