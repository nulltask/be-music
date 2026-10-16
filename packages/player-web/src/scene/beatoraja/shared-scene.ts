import {
  TIMER_PLAY,
  TIMER_READY,
  TIMER_SCENE_START,
  TIMER_STARTINPUT,
  type BeatorajaSkin,
} from '@be-music/beatoraja-skin';
import type { Ticker } from 'pixi.js';
import { BeatorajaSceneTransition } from '../../skin/beatoraja/scene-transition.ts';
import type { PixiSceneHost } from '../host.ts';
import { masterOutput } from '../../runtime/master-volume.ts';

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
      source.connect(masterOutput(ctx));
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
