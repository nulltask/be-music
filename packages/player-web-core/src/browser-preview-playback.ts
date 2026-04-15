import type { BeMusicJson } from '@be-music/json';
import {
  BrowserAudioPlayback,
  type BrowserAudioContextFactory,
  type BrowserAudioContextLike,
  type BrowserAudioGainNodeLike,
  type BrowserAudioBufferSourceNodeLike,
} from './browser-audio-playback.ts';
import { resolveBrowserSongForGameplay } from './browser-control-flow.ts';
import {
  resolveBrowserFallbackPreviewIdentity,
  resolveBrowserPreviewSampleFile,
} from './browser-preview-identity.ts';
import type { BrowserSongAssetSource, BrowserSongEntry } from './types.ts';

const DEFAULT_PREVIEW_GAIN = 0.9;
const DEFAULT_FOCUS_SETTLE_DELAY_MS = 120;
const DEFAULT_PREVIEW_START_LEAD_SECONDS = 0.05;
const DEFAULT_PREVIEW_POLL_INTERVAL_MS = 25;
const DIRECT_PREVIEW_START_AHEAD_SECONDS = 0.01;

export interface BrowserSongPreviewControllerOptions {
  createAudioContext?: BrowserAudioContextFactory;
  focusSettleDelayMs?: number;
  outputGain?: number;
  previewPollIntervalMs?: number;
}

interface BrowserActivePreviewPlayback {
  continueKey: string;
  dispose: () => Promise<void>;
}

export interface BrowserSongPreviewController {
  focus: (song: BrowserSongEntry | undefined, source: BrowserSongAssetSource | undefined) => void;
  clear: () => void;
  dispose: () => Promise<void>;
}

export function createBrowserSongPreviewController(
  options: BrowserSongPreviewControllerOptions = {},
): BrowserSongPreviewController {
  const focusSettleDelayMs = normalizeDelayMs(options.focusSettleDelayMs, DEFAULT_FOCUS_SETTLE_DELAY_MS);
  const previewPollIntervalMs = normalizeDelayMs(
    options.previewPollIntervalMs,
    DEFAULT_PREVIEW_POLL_INTERVAL_MS,
  );
  let disposed = false;
  let sequence = 0;
  let focusedContinueKey: string | undefined;
  let activePlayback: BrowserActivePreviewPlayback | undefined;
  let pendingFocusTimer: ReturnType<typeof setTimeout> | undefined;

  const clearPendingFocusTimer = (): void => {
    if (!pendingFocusTimer) {
      return;
    }
    clearTimeout(pendingFocusTimer);
    pendingFocusTimer = undefined;
  };

  const stopActivePlayback = async (): Promise<void> => {
    if (!activePlayback) {
      return;
    }
    const playback = activePlayback;
    activePlayback = undefined;
    await playback.dispose();
  };

  const clearFocus = (): void => {
    clearPendingFocusTimer();
    focusedContinueKey = undefined;
    sequence += 1;
    void stopActivePlayback();
  };

  const startPreview = async (
    currentSequence: number,
    song: BrowserSongEntry,
    source: BrowserSongAssetSource,
    continueKey: string,
  ): Promise<void> => {
    if (disposed || currentSequence !== sequence) {
      return;
    }
    if (activePlayback?.continueKey === continueKey) {
      return;
    }

    const resolvedSong = resolveBrowserSongForGameplay(song, () => 0);
    const nextPlayback =
      (await createDirectPreviewPlayback(resolvedSong.chart, source, resolvedSong.chartPath, options)) ??
      (await createFallbackPreviewPlayback(
        resolvedSong.chart,
        source,
        resolvedSong.chartPath,
        options,
        previewPollIntervalMs,
      ));
    if (!nextPlayback) {
      await stopActivePlayback();
      return;
    }
    if (disposed || currentSequence !== sequence) {
      await nextPlayback.dispose();
      return;
    }

    await stopActivePlayback();
    activePlayback = nextPlayback;
  };

  return {
    focus: (song, source): void => {
      if (disposed) {
        return;
      }
      clearPendingFocusTimer();
      if (!song || !source || !song.previewContinueKey) {
        clearFocus();
        return;
      }
      if (focusedContinueKey === song.previewContinueKey && activePlayback?.continueKey === song.previewContinueKey) {
        return;
      }

      focusedContinueKey = song.previewContinueKey;
      sequence += 1;
      const currentSequence = sequence;
      const schedule = () => {
        pendingFocusTimer = undefined;
        void startPreview(currentSequence, song, source, song.previewContinueKey!);
      };
      if (focusSettleDelayMs <= 0) {
        schedule();
        return;
      }
      pendingFocusTimer = setTimeout(schedule, focusSettleDelayMs);
    },
    clear: (): void => {
      clearFocus();
    },
    dispose: async (): Promise<void> => {
      if (disposed) {
        return;
      }
      disposed = true;
      clearPendingFocusTimer();
      focusedContinueKey = undefined;
      sequence += 1;
      await stopActivePlayback();
    },
  };
}

async function createDirectPreviewPlayback(
  chart: BeMusicJson,
  source: BrowserSongAssetSource,
  chartPath: string,
  options: BrowserSongPreviewControllerOptions,
): Promise<BrowserActivePreviewPlayback | undefined> {
  const previewFile = resolveBrowserPreviewSampleFile(chart, source, chartPath);
  if (!previewFile) {
    return undefined;
  }

  const context = createAudioContext(options.createAudioContext);
  if (!context) {
    return undefined;
  }

  const outputNode = context.createGain();
  outputNode.gain.value = resolvePreviewOutputGain(chart, options.outputGain ?? DEFAULT_PREVIEW_GAIN);
  outputNode.connect(context.destination);

  try {
    await context.resume();
    const buffer = await context.decodeAudioData(cloneBytesAsArrayBuffer(previewFile.bytes));
    const sourceNode = context.createBufferSource();
    sourceNode.buffer = buffer;
    sourceNode.loop = true;
    sourceNode.connect(outputNode);
    sourceNode.start(context.currentTime + DIRECT_PREVIEW_START_AHEAD_SECONDS);

    return {
      continueKey: previewFile.path,
      dispose: async (): Promise<void> => {
        stopBufferSourceNode(sourceNode);
        await closeAudioContext(context);
      },
    };
  } catch {
    await closeAudioContext(context);
    return undefined;
  }
}

async function createFallbackPreviewPlayback(
  chart: BeMusicJson,
  source: BrowserSongAssetSource,
  chartPath: string,
  options: BrowserSongPreviewControllerOptions,
  previewPollIntervalMs: number,
): Promise<BrowserActivePreviewPlayback | undefined> {
  const fallbackIdentity = resolveBrowserFallbackPreviewIdentity(chart);
  if (!fallbackIdentity) {
    return undefined;
  }

  const playback = new BrowserAudioPlayback(chart, source, chartPath, {
    createAudioContext: options.createAudioContext,
    outputGain: options.outputGain ?? DEFAULT_PREVIEW_GAIN,
    startLeadSeconds: DEFAULT_PREVIEW_START_LEAD_SECONDS,
    timelineStartSeconds: fallbackIdentity.startSeconds,
  });
  const preparation = await playback.prepare();
  if (preparation.status !== 'ready') {
    await playback.dispose();
    return undefined;
  }

  playback.start();
  const startedAtMs = nowMs();
  const timer = setInterval(() => {
    const elapsedSeconds = (nowMs() - startedAtMs) / 1000;
    playback.update(fallbackIdentity.startSeconds + elapsedSeconds);
  }, previewPollIntervalMs);

  return {
    continueKey: fallbackIdentity.continueKey,
    dispose: async (): Promise<void> => {
      clearInterval(timer);
      await playback.dispose();
    },
  };
}

function createAudioContext(
  createAudioContextFactory: BrowserAudioContextFactory | undefined,
): BrowserAudioContextLike | undefined {
  if (createAudioContextFactory) {
    return createAudioContextFactory();
  }
  const globalAudio = globalThis as typeof globalThis & {
    AudioContext?: new () => BrowserAudioContextLike;
    webkitAudioContext?: new () => BrowserAudioContextLike;
  };
  const AudioContextConstructor = globalAudio.AudioContext ?? globalAudio.webkitAudioContext;
  return AudioContextConstructor ? new AudioContextConstructor() : undefined;
}

function resolvePreviewOutputGain(chart: BeMusicJson, baseGain: number): number {
  const volWav = chart.bms.volWav;
  const chartGain = typeof volWav === 'number' && Number.isFinite(volWav) && volWav >= 0 ? volWav / 100 : 1;
  return baseGain * chartGain;
}

function normalizeDelayMs(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(0, Math.floor(value));
}

function cloneBytesAsArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return new Uint8Array(bytes).buffer;
}

function stopBufferSourceNode(sourceNode: BrowserAudioBufferSourceNodeLike): void {
  if (!sourceNode.stop) {
    return;
  }
  try {
    sourceNode.stop();
  } catch {
    // Ignore invalid-state errors from already-finished nodes.
  }
}

async function closeAudioContext(context: BrowserAudioContextLike): Promise<void> {
  if (context.state === 'closed') {
    return;
  }
  await context.close();
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}
