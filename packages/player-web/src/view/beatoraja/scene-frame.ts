/**
 * What the beatoraja decide and result views share: the skin drawn on a black backdrop with its canvas fitted into the
 * window ({@link BeatorajaSkinStage}), the chart's own images ({@link BeatorajaViewChartImages}), the scene timers read
 * off a frame, and the song and skin texts and timing fields they read off the skin.
 */

import {
  BEATORAJA_TEXT,
  TIMER_FADEOUT,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSkin,
} from '@be-music/beatoraja-skin';
import {
  resolveBeatorajaSkinText,
  resolveBeatorajaSongText as resolveBeatorajaSongTextOf,
  type BeatorajaSongTextInput,
} from '@be-music/beatoraja-skin/scene';
import type { LibraryChart } from '@be-music/scene-model';
import { Container, Graphics, type Texture } from 'pixi.js';
import { extractChartSubartist } from '../../chart/beatoraja/meta.ts';
import type { BrowserSongAssetSource } from '../../collection/types.ts';
import { destroyTextureAndRevokeBlobURL } from '../../media/textures.ts';
import type { BeatorajaPlaySkinView } from './skin-view.ts';
import type { PixiSceneHost } from '../../host/scene-host.ts';
import {
  loadBeatorajaChartImages,
  resolveBeatorajaChartImage,
  type BeatorajaChartImages,
} from '../../skin/beatoraja/chart-images.ts';
import type { SceneClock } from '../types.ts';

export interface BeatorajaStageFitState {
  width: number;
  height: number;
}

interface BeatorajaStageView {
  readonly width: number;
  readonly height: number;
  readonly container: Container;
}

const SONG_TEXTS = new WeakMap<LibraryChart, BeatorajaSongTextInput>();

/** What a beatoraja skin's song texts read of a library chart (its sub-artist read off the chart once). */
export function beatorajaSongTextOf(song: LibraryChart | undefined): BeatorajaSongTextInput | undefined {
  if (song === undefined) return undefined;
  let text = SONG_TEXTS.get(song);
  if (text === undefined) {
    text = {
      title: song.title,
      subtitle: song.subtitle,
      genre: song.genre,
      artist: song.artist,
      subartist: extractChartSubartist(song.chart),
      directory: song.directoryLabel,
    };
    SONG_TEXTS.set(song, text);
  }
  return text;
}

/**
 * The song and skin texts of the decide and result screens (`@be-music/beatoraja-skin/scene`); the difficulty-table
 * texts read `tableTextFallback`.
 */
export function resolveBeatorajaSongText(
  refOp: number,
  options: {
    song?: LibraryChart;
    skin: BeatorajaSkin;
    tableTextFallback?: string;
  },
): string | undefined {
  switch (refOp) {
    case BEATORAJA_TEXT.TABLE_NAME:
    case BEATORAJA_TEXT.TABLE_LEVEL:
    case BEATORAJA_TEXT.TABLE_FULL:
      return options.tableTextFallback;
  }
  return (
    resolveBeatorajaSongTextOf(refOp, beatorajaSongTextOf(options.song)) ??
    resolveBeatorajaSkinText(refOp, options.skin)
  );
}

export function fitBeatorajaViewToStage(
  host: PixiSceneHost | undefined,
  view: BeatorajaStageView,
  backdrop: Graphics,
  previous: BeatorajaStageFitState,
): BeatorajaStageFitState | undefined {
  if (!host) return undefined;
  const { width, height } = host.app.screen;
  if (width === previous.width && height === previous.height) return undefined;
  if (width <= 0 || height <= 0) return undefined;
  const scale = Math.min(width / view.width, height / view.height);
  if (!Number.isFinite(scale) || scale <= 0) return undefined;
  const c = view.container;
  c.scale.set(scale, scale);
  c.x = (width - view.width * scale) / 2;
  c.y = (height - view.height * scale) / 2;
  backdrop.clear().rect(0, 0, width, height).fill(0x000000);
  return { width, height };
}

export function resolveBeatorajaSkinTimingMs(
  value: number | undefined,
  fallbackMs: number,
  options: { min?: number } = {},
): number {
  const min = options.min ?? Number.NEGATIVE_INFINITY;
  if (typeof value === 'number' && Number.isFinite(value) && value >= min) {
    return value;
  }
  return fallbackMs;
}

/**
 * Default fadeout window when the skin omits the field. A beatoraja screen leaves over upstream's `TIMER_FADEOUT` +
 * `Skin.getFadeout()` pattern (`MusicDecide.render` / `MusicResult.render` / `BMSPlayer.render`'s STATE_FINISHED
 * branch): a trigger starts timer 2, the skin's elements gated on it animate from then, and the screen hands over once
 * `Skin.fadeout` ms have passed. Upstream's `Skin` declares `private int fadeout` with no initializer (Java's 0, an
 * instant transition), but every reference skin (`select.json`, `decidemain.lua`, `resultmain.lua`) ships 500, so
 * an unauthored skin or a hand-rolled test fixture falls back to that.
 */
export const DEFAULT_BEATORAJA_FADEOUT_MS = 500;

/** A beatoraja screen's fade-out: the skin's `fadeout`, else {@link DEFAULT_BEATORAJA_FADEOUT_MS}. */
export function resolveBeatorajaFadeOutMs(fadeout: number | undefined): number {
  if (typeof fadeout === 'number' && Number.isFinite(fadeout) && fadeout >= 0) return fadeout;
  return DEFAULT_BEATORAJA_FADEOUT_MS;
}

/** A beatoraja screen's own clock: the ms since it was entered. */
export function beatorajaSceneNowMs(clock: SceneClock): number {
  return clock.nowMs - clock.enteredAtMs;
}

/**
 * The beatoraja timers of a decide or result frame, on the screen's own clock ({@link beatorajaSceneNowMs}): the scene
 * (0) from the entry, input (1) from when input opens, READY (40) and PLAY (41) from when input opens or from the entry
 * (`readyAt`), and the fade-out (2) from when the screen started leaving.
 */
export function resolveBeatorajaSceneTimers(
  frame: {
    readonly clock: SceneClock;
    readonly inputOpenAtMs: number;
    readonly leaving?: { readonly atMs: number };
  },
  readyAt: 'input' | 'entry',
): Map<number, number> {
  const inputAtMs = frame.inputOpenAtMs - frame.clock.enteredAtMs;
  const readyAtMs = readyAt === 'input' ? inputAtMs : 0;
  const timers = new Map<number, number>([
    [TIMER_SCENE_START, 0],
    [TIMER_STARTINPUT, inputAtMs],
    [TIMER_READY, readyAtMs],
    [TIMER_PLAY, readyAtMs],
  ]);
  if (frame.leaving !== undefined) timers.set(TIMER_FADEOUT, frame.leaving.atMs - frame.clock.enteredAtMs);
  return timers;
}

/**
 * A beatoraja skin view on a black backdrop, its canvas scaled to fit the window and centred: what a beatoraja family
 * view puts on the stage.
 */
export class BeatorajaSkinStage {
  public readonly root: Container = new Container();
  public readonly view: BeatorajaPlaySkinView;
  private readonly backdrop: Graphics = new Graphics();
  private fit: BeatorajaStageFitState = { width: 0, height: 0 };
  private disposed = false;

  public constructor(view: BeatorajaPlaySkinView) {
    this.view = view;
    this.root.addChild(this.backdrop, view.container);
  }

  /** Fits the skin's canvas to `host`'s screen, when the screen's size changed since the last fit. */
  public fitTo(host: PixiSceneHost): void {
    const fitted = fitBeatorajaViewToStage(host, this.view, this.backdrop, this.fit);
    if (fitted !== undefined) this.fit = fitted;
  }

  /** The skin's canvas and its authored size, for screenshots. */
  public getStageInfo(): { container: Container; width: number; height: number } {
    return { container: this.view.container, width: this.view.width, height: this.view.height };
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.parent?.removeChild(this.root);
    this.view.dispose();
    if (!this.backdrop.destroyed) this.backdrop.destroy({ children: false, context: true });
    if (!this.root.destroyed) this.root.destroy({ children: false });
  }
}

/**
 * The chart's own images a beatoraja view shows in the skin's synthetic slots (-100 to -102): loaded once, before the
 * view's first frame, and destroyed with the view.
 */
export class BeatorajaViewChartImages {
  private readonly chart: Pick<LibraryChart, 'chart' | 'chartPath'> | undefined;
  private readonly source: BrowserSongAssetSource | undefined;
  private images: BeatorajaChartImages = {};
  private loading: Promise<void> | undefined;
  private disposed = false;

  public constructor(
    chart: Pick<LibraryChart, 'chart' | 'chartPath'> | undefined,
    source: BrowserSongAssetSource | undefined,
  ) {
    this.chart = chart;
    this.source = source;
  }

  /** Loads the images, the first time it is called; nothing loads without a chart. */
  public load(): Promise<void> {
    this.loading ??= this.loadOnce();
    return this.loading;
  }

  /** The image of a synthetic slot, once loaded. */
  public resolve(syntheticId: number): Texture | undefined {
    return resolveBeatorajaChartImage(this.images, syntheticId);
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    destroyChartImages(this.images);
    this.images = {};
  }

  private async loadOnce(): Promise<void> {
    if (this.chart === undefined) return;
    const images = await loadBeatorajaChartImages(this.chart, this.source);
    if (this.disposed) destroyChartImages(images);
    else this.images = images;
  }
}

function destroyChartImages(images: BeatorajaChartImages): void {
  for (const texture of [images.stageFile, images.backBMP, images.banner]) {
    if (texture !== undefined) destroyTextureAndRevokeBlobURL(texture, true);
  }
}
