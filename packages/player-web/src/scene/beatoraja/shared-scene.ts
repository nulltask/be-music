import {
  BEATORAJA_TEXT,
  TIMER_PLAY,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSkin,
} from '@be-music/beatoraja-skin';
import { Container, Graphics, type Texture, type Ticker } from 'pixi.js';
import type { BrowserSongEntry } from '../../collection/types.ts';
import { extractChartSubartist } from '../../chart/beatoraja/meta.ts';
import { BeatorajaSceneTransition } from '../../skin/beatoraja/scene-transition.ts';
import type { PixiSceneHost } from '../host.ts';

export interface BeatorajaChartImages {
  stageFile?: Texture;
  backBmp?: Texture;
  banner?: Texture;
}

export interface BeatorajaStageFitState {
  width: number;
  height: number;
}

export interface BeatorajaSceneLoopAttachment {
  dispose(): void;
}

export interface BeatorajaSceneTimerStartsOptions {
  inputDelayMs: number;
  readyAtMs?: number;
  playAtMs?: number;
  sceneStartAtMs?: number;
}

export interface BeatorajaSceneFadeoutTransitionOptions {
  skin: Pick<BeatorajaSkin, 'fadeout'>;
  getElapsedMs: () => number;
  timerStartedAt: Map<number, number>;
  onComplete: () => void;
}

export interface AttachBeatorajaSceneLifecycleOptions {
  host: PixiSceneHost;
  skin: Pick<BeatorajaSkin, 'fadeout'>;
  inputDelayMs: number;
  readyAtMs?: number;
  playAtMs?: number;
  getElapsedMs: () => number;
  tick: () => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  transitionCompletions: ReadonlyArray<() => void>;
}

export interface BeatorajaSceneLifecycleAttachment {
  timerStartedAt: Map<number, number>;
  sceneLoop: BeatorajaSceneLoopAttachment;
  transitions: BeatorajaSceneTransition[];
}

interface BeatorajaSceneTransitionState {
  isFadingOut(): boolean;
  isCompleted(): boolean;
}

interface BeatorajaStageView {
  readonly width: number;
  readonly height: number;
  readonly container: Container;
}

export function resolveBeatorajaChartImage(
  images: BeatorajaChartImages | undefined,
  syntheticId: number,
): Texture | undefined {
  if (images === undefined) return undefined;
  switch (syntheticId) {
    case -100:
      return images.stageFile;
    case -101:
      return images.backBmp;
    case -102:
      return images.banner;
    default:
      return undefined;
  }
}

export function resolveBeatorajaSongText(
  refOp: number,
  options: {
    song?: BrowserSongEntry;
    skin: BeatorajaSkin;
    tableTextFallback?: string;
  },
): string | undefined {
  const { song, skin } = options;
  switch (refOp) {
    case BEATORAJA_TEXT.TITLE:
      return song?.title ?? '';
    case BEATORAJA_TEXT.SUBTITLE:
      return song?.subtitle ?? '';
    case BEATORAJA_TEXT.FULLTITLE:
      return joinNonEmpty(song?.title, song?.subtitle);
    case BEATORAJA_TEXT.GENRE:
      return song?.genre ?? '';
    case BEATORAJA_TEXT.ARTIST:
      return song?.artist ?? '';
    case BEATORAJA_TEXT.SUBARTIST:
      return extractChartSubartist(song?.chart);
    case BEATORAJA_TEXT.FULLARTIST:
      return joinNonEmpty(song?.artist, extractChartSubartist(song?.chart));
    case BEATORAJA_TEXT.SKIN_NAME:
      return skin.name ?? '';
    case BEATORAJA_TEXT.SKIN_AUTHOR:
      return skin.author ?? '';
    case BEATORAJA_TEXT.DIRECTORY:
      return song?.directoryLabel ?? '';
    case BEATORAJA_TEXT.TABLE_NAME:
    case BEATORAJA_TEXT.TABLE_LEVEL:
    case BEATORAJA_TEXT.TABLE_FULL:
      return options.tableTextFallback;
    default:
      return undefined;
  }
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

export function createBeatorajaSceneTimerStarts(options: BeatorajaSceneTimerStartsOptions): Map<number, number> {
  const sceneStartAtMs = options.sceneStartAtMs ?? 0;
  return new Map([
    [TIMER_SCENE_START, sceneStartAtMs],
    [TIMER_STARTINPUT, options.inputDelayMs],
    [TIMER_READY, options.readyAtMs ?? options.inputDelayMs],
    [TIMER_PLAY, options.playAtMs ?? options.inputDelayMs],
  ]);
}

export function createBeatorajaSceneFadeoutTransition(
  options: BeatorajaSceneFadeoutTransitionOptions,
): BeatorajaSceneTransition {
  return new BeatorajaSceneTransition({
    fadeoutMs: options.skin.fadeout,
    getElapsedMs: options.getElapsedMs,
    stampFadeoutTimer: (timerId, atMs) => options.timerStartedAt.set(timerId, atMs),
    onComplete: options.onComplete,
  });
}

export function attachBeatorajaSceneLifecycle(
  options: AttachBeatorajaSceneLifecycleOptions,
): BeatorajaSceneLifecycleAttachment {
  const timerStartedAt = createBeatorajaSceneTimerStarts({
    inputDelayMs: options.inputDelayMs,
    readyAtMs: options.readyAtMs,
    playAtMs: options.playAtMs,
  });
  const transitions = options.transitionCompletions.map((onComplete) =>
    createBeatorajaSceneFadeoutTransition({
      skin: options.skin,
      getElapsedMs: options.getElapsedMs,
      timerStartedAt,
      onComplete,
    }),
  );
  return {
    timerStartedAt,
    transitions,
    sceneLoop: attachBeatorajaSceneLoop(options.host, options.tick, options.handleKeyDown),
  };
}

export function attachBeatorajaSceneLoop(
  host: PixiSceneHost,
  tick: () => void,
  handleKeyDown: (event: KeyboardEvent) => void,
): BeatorajaSceneLoopAttachment {
  const tickerHandle = (_ticker: Ticker): void => tick();
  host.app.ticker.add(tickerHandle);
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown);
  }
  return {
    dispose() {
      host.app.ticker.remove(tickerHandle);
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
      }
    },
  };
}

export function hasBeatorajaSceneFadingTransition(
  ...transitions: ReadonlyArray<BeatorajaSceneTransitionState | undefined>
): boolean {
  return transitions.some((transition) => transition?.isFadingOut() === true);
}

export function hasBeatorajaSceneLockedTransition(
  ...transitions: ReadonlyArray<BeatorajaSceneTransitionState | undefined>
): boolean {
  return transitions.some((transition) => transition?.isFadingOut() === true || transition?.isCompleted() === true);
}

export function isBeatorajaSceneInputReady(startMs: number, inputDelayMs: number, nowMs: number): boolean {
  return nowMs - startMs >= inputDelayMs;
}

export class BeatorajaSceneBgmPlayer {
  private audioContext: AudioContext | undefined;
  private bgmSource: AudioBufferSourceNode | undefined;
  private readonly logLabel: string;
  private readonly isDisposed: () => boolean;

  constructor(logLabel: string, isDisposed: () => boolean) {
    this.logLabel = logLabel;
    this.isDisposed = isDisposed;
  }

  async start(bytes: Uint8Array | undefined): Promise<void> {
    if (bytes === undefined) return;
    if (typeof globalThis === 'undefined' || typeof globalThis.AudioContext === 'undefined') return;
    try {
      if (this.audioContext === undefined) {
        this.audioContext = new globalThis.AudioContext();
      }
      const ctx = this.audioContext;
      void ctx.resume().catch(() => undefined);
      const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
      if (this.isDisposed()) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start();
      this.bgmSource = source;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn(`[${this.logLabel}] bgm playback failed`, error);
    }
  }

  stop(): void {
    if (this.bgmSource !== undefined) {
      try {
        this.bgmSource.stop();
      } catch {
        /* already stopped */
      }
      this.bgmSource.disconnect();
      this.bgmSource = undefined;
    }
    if (this.audioContext !== undefined) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = undefined;
    }
  }
}

function joinNonEmpty(...parts: ReadonlyArray<string | undefined>): string {
  return parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join(' ');
}
