import { isPlayLaneSoundChannel } from '@be-music/chart';
import { dirname, isAbsolute, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import {
  invokeWorkerizedFunction,
  isAbortError,
  resolveFirstExistingPath,
  throwIfAborted,
  workerize,
  writeStereoPcm16Le,
} from '@be-music/utils';
import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { parseChartFile, resolveBmsControlFlow } from '@be-music/parser';
import { collectSampleTriggers, createTimingResolver, type RenderResult, renderJson } from '@be-music/audio-renderer';
import { createNodeAudioSink } from '../audio-sink.ts';
import { resolveChartVolWavGain } from '../utils.ts';

interface PreviewPlaybackHandle {
  stop: () => void;
  done: Promise<void>;
  backend: string;
}

interface ChartPreviewAsset {
  continueKey: string;
  rendered: RenderResult;
}

interface RenderedPreviewSample {
  continueKey: string;
  rendered: RenderResult;
}

interface FallbackPreviewIdentity {
  continueKey: string;
  startSeconds: number;
}

interface FallbackSignaturePayload {
  sourceFormat: string;
  baseBpm: number;
  tempoPoints: Array<[beat: number, bpm: number, seconds: number]>;
  stopPoints: Array<[beat: number, seconds: number]>;
  triggers: Array<
    [
      seconds: number,
      beat: number,
      sampleKey: string,
      samplePath: string,
      sampleOffsetSeconds: number,
      sampleDurationSeconds?: number,
      sampleSliceId?: string,
    ]
  >;
}

type WorkerizedFallbackContinueKey = ((
  payload: FallbackSignaturePayload,
  callback: (error: unknown, result: string) => void,
) => void) & { close: () => void };

export interface PreviewFocusTarget {
  filePath?: string;
  previewContinueKey?: string;
}

export interface ChartPreviewAudioOptions {
  volume?: number;
  bgmVolume?: number;
  playVolume?: number;
}

export interface ChartPreviewController {
  focus: (target: PreviewFocusTarget) => void;
  getActiveBackend: () => string | undefined;
  getRenderingFilePath: () => string | undefined;
  dispose: () => Promise<void>;
}

const PREVIEW_CHUNK_FRAMES = 256;
const PREVIEW_SILENCE_THRESHOLD = 0.0001;
const PREVIEW_STOP_TIMEOUT_MS = 180;
const PREVIEW_BACKPRESSURE_TIMEOUT_MS = 800;
const PREVIEW_CACHE_LIMIT = 8;
let fallbackContinueKeyWorker = createFallbackContinueKeyWorker();

export function createChartPreviewController(options: ChartPreviewAudioOptions = {}): ChartPreviewController {
  const previewCache = new Map<string, ChartPreviewAsset | null>();
  let focusedFilePath: string | undefined;
  let focusedPreviewContinueKey: string | undefined;
  let sequence = 0;
  let disposed = false;
  let activeRenderAbortController: AbortController | undefined;
  let activeRenderFilePath: string | undefined;
  let activePlayback: PreviewPlaybackHandle | undefined;
  let activePreviewKey: string | undefined;
  let activeBackend: string | undefined;

  const stopPlaybackSafely = async (playback: PreviewPlaybackHandle): Promise<void> => {
    playback.stop();
    await Promise.race([playback.done.catch(() => undefined), delay(PREVIEW_STOP_TIMEOUT_MS)]);
  };

  const stopActivePlayback = async (): Promise<void> => {
    if (!activePlayback) {
      return;
    }
    const playback = activePlayback;
    activePlayback = undefined;
    activePreviewKey = undefined;
    activeBackend = undefined;
    await stopPlaybackSafely(playback);
  };

  return {
    focus: (target: PreviewFocusTarget): void => {
      const filePath = target.filePath;
      const expectedPreviewKey = target.previewContinueKey;
      if (disposed || (focusedFilePath === filePath && focusedPreviewContinueKey === expectedPreviewKey)) {
        return;
      }
      activeRenderAbortController?.abort();
      activeRenderAbortController = undefined;
      activeRenderFilePath = undefined;
      focusedFilePath = filePath;
      focusedPreviewContinueKey = expectedPreviewKey;
      sequence += 1;
      const currentSequence = sequence;

      void (async () => {
        if (!filePath) {
          await stopActivePlayback();
          return;
        }
        if (expectedPreviewKey && activePlayback && activePreviewKey === expectedPreviewKey) {
          return;
        }
        if (activePlayback && (!expectedPreviewKey || activePreviewKey !== expectedPreviewKey)) {
          await stopActivePlayback();
          if (disposed || currentSequence !== sequence) {
            return;
          }
        }

        let preview = previewCache.get(filePath);
        if (preview === undefined) {
          const renderAbortController = new AbortController();
          activeRenderAbortController = renderAbortController;
          activeRenderFilePath = filePath;
          try {
            preview = (await renderChartPreview(filePath, renderAbortController.signal, options)) ?? null;
          } catch (error) {
            if (isAbortError(error)) {
              return;
            }
            preview = null;
          } finally {
            if (activeRenderAbortController === renderAbortController) {
              activeRenderAbortController = undefined;
              activeRenderFilePath = undefined;
            }
          }
          if (disposed || currentSequence !== sequence) {
            return;
          }
          previewCache.set(filePath, preview);
          while (previewCache.size > PREVIEW_CACHE_LIMIT) {
            const oldest = previewCache.keys().next().value as string | undefined;
            if (!oldest) {
              break;
            }
            previewCache.delete(oldest);
          }
        }

        if (disposed || currentSequence !== sequence) {
          return;
        }

        if (!preview) {
          await stopActivePlayback();
          return;
        }
        if (expectedPreviewKey && activePlayback && activePreviewKey === expectedPreviewKey) {
          return;
        }

        if (activePlayback && activePreviewKey === preview.continueKey) {
          return;
        }

        const playback = await startPreviewPlayback(preview.rendered);
        if (!playback) {
          return;
        }
        if (disposed || currentSequence !== sequence) {
          await stopPlaybackSafely(playback);
          return;
        }
        activePlayback = playback;
        activePreviewKey = preview.continueKey;
        activeBackend = playback.backend;
        void playback.done.finally(() => {
          if (activePlayback === playback) {
            activePlayback = undefined;
            activePreviewKey = undefined;
            activeBackend = undefined;
          }
        });
      })();
    },
    getActiveBackend: (): string | undefined => activeBackend,
    getRenderingFilePath: (): string | undefined => activeRenderFilePath,
    dispose: async (): Promise<void> => {
      if (disposed) {
        return;
      }
      disposed = true;
      sequence += 1;
      activeRenderAbortController?.abort();
      activeRenderAbortController = undefined;
      activeRenderFilePath = undefined;
      focusedFilePath = undefined;
      focusedPreviewContinueKey = undefined;
      previewCache.clear();
      await stopActivePlayback();
    },
  };
}

export async function resolvePreviewContinueKeyFromChart(
  chart: BeMusicJson,
  chartPath: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  throwIfAborted(signal);
  const previewPath = chart.bms.preview;
  if (typeof previewPath !== 'string' || previewPath.trim().length === 0) {
    return (await resolveFallbackPreviewIdentity(chart, signal))?.continueKey;
  }
  const candidates = createPreviewPathCandidates(chart, previewPath);
  if (candidates.length === 0) {
    return (await resolveFallbackPreviewIdentity(chart, signal))?.continueKey;
  }
  const baseDir = dirname(chartPath);
  const resolvedCandidate = await resolveFirstExistingPath(baseDir, candidates, signal);
  if (resolvedCandidate) {
    return normalizePreviewContinueKey(resolvedCandidate);
  }
  return (await resolveFallbackPreviewIdentity(chart, signal))?.continueKey;
}

export function formatSongSelectAudioBackendLabel(audioEnabled: boolean, active: string | undefined): string {
  if (!audioEnabled) {
    return 'disabled';
  }
  if (active) {
    return active;
  }
  return 'node-webaudio';
}

async function renderChartPreview(
  filePath: string,
  signal?: AbortSignal,
  options?: ChartPreviewAudioOptions,
): Promise<ChartPreviewAsset | undefined> {
  throwIfAborted(signal);
  const chart = await parseChartFile(filePath, { signal });
  throwIfAborted(signal);
  const resolved = resolveBmsControlFlow(chart, { random: () => 0 });
  const chartWavGain = resolveChartVolWavGain(resolved);
  const gains = resolvePreviewAudioGains(options);
  const previewPath = resolved.bms.preview;
  if (typeof previewPath === 'string' && previewPath.trim().length > 0) {
    const previewSample = await renderPreviewSampleFile(resolved, filePath, previewPath, chartWavGain, gains, signal);
    if (previewSample) {
      return {
        continueKey: previewSample.continueKey,
        rendered: trimPreviewLeadingSilence(previewSample.rendered),
      };
    }
  }
  const fallbackPreview = await renderFallbackChartPreview(resolved, filePath, gains, signal);
  if (!fallbackPreview) {
    return undefined;
  }
  return {
    continueKey: fallbackPreview.continueKey,
    rendered: trimPreviewLeadingSilence(fallbackPreview.rendered),
  };
}

async function renderPreviewSampleFile(
  chart: BeMusicJson,
  chartPath: string,
  previewPath: string,
  gain: number,
  gains: PreviewAudioGains,
  signal?: AbortSignal,
): Promise<RenderedPreviewSample | undefined> {
  const candidates = createPreviewPathCandidates(chart, previewPath);
  const baseDir = dirname(chartPath);
  for (const candidate of candidates) {
    throwIfAborted(signal);
    let fellBack = false;
    let loadedPreviewPath: string | undefined;
    const sampleJson = createEmptyJson('json');
    sampleJson.metadata.bpm = chart.metadata.bpm;
    sampleJson.resources.wav['01'] = candidate;
    sampleJson.events = [{ measure: 0, channel: '01', position: [0, 1], value: '01' }];

    const rendered = await renderJson(sampleJson, {
      baseDir,
      tailSeconds: 0,
      gain: gain * gains.effectiveBgm,
      fallbackToneSeconds: 0.05,
      signal,
      onSampleLoadProgress: (progress) => {
        if (
          progress.stage === 'reading' &&
          typeof progress.resolvedPath === 'string' &&
          progress.resolvedPath.length > 0
        ) {
          loadedPreviewPath = progress.resolvedPath;
        }
        if (progress.stage === 'fallback') {
          fellBack = true;
        }
      },
    });
    if (!fellBack) {
      const resolvedCandidatePath = loadedPreviewPath ?? resolvePreviewCandidatePath(baseDir, candidate);
      return {
        rendered,
        continueKey: normalizePreviewContinueKey(resolvedCandidatePath),
      };
    }
  }
  return undefined;
}

async function renderFallbackChartPreview(
  chart: BeMusicJson,
  chartPath: string,
  gains: PreviewAudioGains,
  signal?: AbortSignal,
): Promise<RenderedPreviewSample | undefined> {
  const fallbackIdentity = await resolveFallbackPreviewIdentity(chart, signal);
  if (!fallbackIdentity) {
    return undefined;
  }
  const rendered = await renderJson(chart, {
    baseDir: dirname(chartPath),
    tailSeconds: 0,
    startSeconds: fallbackIdentity.startSeconds,
    gain: gains.master,
    fallbackToneSeconds: 0.05,
    resolveTriggerGain: (trigger) => (isPlayLaneSoundChannel(trigger.channel) ? gains.play : gains.bgm),
    signal,
  });
  return {
    continueKey: fallbackIdentity.continueKey,
    rendered,
  };
}

function resolvePreviewCandidatePath(baseDir: string, candidate: string): string {
  if (isAbsolute(candidate)) {
    return candidate;
  }
  return resolve(baseDir, candidate);
}

function normalizePreviewContinueKey(value: string): string {
  return value.replaceAll('\\', '/');
}

interface PreviewAudioGains {
  master: number;
  bgm: number;
  play: number;
  effectiveBgm: number;
}

function resolvePreviewAudioGains(options: ChartPreviewAudioOptions | undefined): PreviewAudioGains {
  const master = normalizePreviewVolume(options?.volume);
  const bgm = normalizePreviewVolume(options?.bgmVolume);
  const play = normalizePreviewVolume(options?.playVolume);
  return {
    master,
    bgm,
    play,
    effectiveBgm: master * bgm,
  };
}

function normalizePreviewVolume(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  return Math.max(0, value);
}

async function resolveFallbackPreviewIdentity(
  chart: BeMusicJson,
  signal?: AbortSignal,
): Promise<FallbackPreviewIdentity | undefined> {
  throwIfAborted(signal);
  const resolver = createTimingResolver(chart);
  const triggers = collectSampleTriggers(chart, resolver);
  if (triggers.length === 0) {
    return undefined;
  }

  const firstTriggerSeconds = Math.max(
    0,
    triggers.reduce((minimum, trigger) => Math.min(minimum, trigger.seconds), Number.POSITIVE_INFINITY),
  );
  if (!Number.isFinite(firstTriggerSeconds)) {
    return undefined;
  }
  const payload: FallbackSignaturePayload = {
    sourceFormat: chart.sourceFormat,
    baseBpm: chart.metadata.bpm,
    tempoPoints: resolver.tempoPoints.map((point) => [point.beat, point.bpm, point.seconds]),
    stopPoints: resolver.stopPoints.map((point) => [point.beat, point.seconds]),
    triggers: triggers.map((trigger) => [
      trigger.seconds,
      trigger.beat,
      trigger.sampleKey,
      trigger.samplePath ?? '',
      trigger.sampleOffsetSeconds,
      trigger.sampleDurationSeconds,
      trigger.sampleSliceId,
    ]),
  };
  const continueKey = await computeFallbackContinueKeyOffThread(payload, signal);

  return {
    continueKey,
    startSeconds: firstTriggerSeconds,
  };
}

async function computeFallbackContinueKeyOffThread(
  payload: FallbackSignaturePayload,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const activeWorker = fallbackContinueKeyWorker;
  try {
    const continueKey = await invokeWorkerizedFunction(activeWorker, [payload], {
      signal,
      onAbort: () => {
        if (fallbackContinueKeyWorker === activeWorker) {
          fallbackContinueKeyWorker.close();
          fallbackContinueKeyWorker = createFallbackContinueKeyWorker();
        }
      },
    });
    if (typeof continueKey !== 'string' || continueKey.length === 0) {
      return computeFallbackContinueKey(payload);
    }
    return continueKey;
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    if (fallbackContinueKeyWorker === activeWorker) {
      fallbackContinueKeyWorker.close();
      fallbackContinueKeyWorker = createFallbackContinueKeyWorker();
    }
    return computeFallbackContinueKey(payload);
  }
}

function createFallbackContinueKeyWorker(): WorkerizedFallbackContinueKey {
  return workerize(
    (payload: FallbackSignaturePayload) => computeFallbackContinueKey(payload),
    () => [computeFallbackContinueKey],
    true,
  ) as WorkerizedFallbackContinueKey;
}

function computeFallbackContinueKey(payload: FallbackSignaturePayload): string {
  const encodeSignatureNumber = (value: number | undefined): string => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return '-';
    }
    return `${Math.round(value * 1_000_000)}`;
  };
  const normalizePath = (value: string | undefined): string => (value ?? '').replaceAll('\\', '/');
  const fnv1a64Hex = (value: string, seed: bigint): string => {
    let hash = seed;
    const prime = 0x100000001b3n;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= BigInt(value.charCodeAt(index));
      hash = BigInt.asUintN(64, hash * prime);
    }
    return hash.toString(16).padStart(16, '0');
  };

  const lines: string[] = [];
  lines.push('fallback-preview-signature-v4');
  lines.push(`source:${payload.sourceFormat}`);
  lines.push(`baseBpm:${encodeSignatureNumber(payload.baseBpm)}`);
  for (const [beat, bpm, seconds] of payload.tempoPoints) {
    lines.push(`tempo:${encodeSignatureNumber(beat)}:${encodeSignatureNumber(bpm)}:${encodeSignatureNumber(seconds)}`);
  }
  for (const [beat, seconds] of payload.stopPoints) {
    lines.push(`stop:${encodeSignatureNumber(beat)}:${encodeSignatureNumber(seconds)}`);
  }
  const normalizedTriggers = payload.triggers
    .map(
      ([seconds, beat, sampleKey, samplePath, sampleOffsetSeconds, sampleDurationSeconds, sampleSliceId]) =>
        `trigger:${encodeSignatureNumber(seconds)}:${encodeSignatureNumber(beat)}:${sampleKey}:${normalizePath(samplePath)}:${encodeSignatureNumber(sampleOffsetSeconds)}:${encodeSignatureNumber(sampleDurationSeconds)}:${sampleSliceId ?? ''}`,
    )
    .sort();
  for (const line of normalizedTriggers) {
    lines.push(line);
  }
  const serialized = `${lines.join('\n')}\n`;
  const primary = fnv1a64Hex(serialized, 0xcbf29ce484222325n);
  const secondary = fnv1a64Hex(serialized, 0xaf63dc4c8601ec8cn);
  return `fallback:${`${primary}${secondary}`.slice(0, 24)}`;
}

function createPreviewPathCandidates(chart: BeMusicJson, previewPath: string): string[] {
  const normalizedPreview = previewPath.trim();
  if (normalizedPreview.length === 0) {
    return [];
  }

  const normalizedPathWav = typeof chart.bms.pathWav === 'string' ? chart.bms.pathWav.trim() : '';
  const candidates = new Set<string>([normalizedPreview]);
  if (!isAbsolute(normalizedPreview) && normalizedPathWav.length > 0) {
    const joined = `${normalizedPathWav.replace(/[\\/]+$/, '')}/${normalizedPreview.replace(/^[\\/]+/, '')}`;
    candidates.add(joined);
  }
  return [...candidates];
}

function trimPreviewLeadingSilence(rendered: RenderResult): RenderResult {
  const length = Math.min(rendered.left.length, rendered.right.length);
  let start = 0;
  while (start < length) {
    const left = Math.abs(rendered.left[start]);
    const right = Math.abs(rendered.right[start]);
    if (left > PREVIEW_SILENCE_THRESHOLD || right > PREVIEW_SILENCE_THRESHOLD) {
      break;
    }
    start += 1;
  }
  if (start <= 0 || start >= length) {
    return rendered;
  }
  const left = rendered.left.subarray(start);
  const right = rendered.right.subarray(start);
  return {
    ...rendered,
    left,
    right,
    durationSeconds: left.length / rendered.sampleRate,
  };
}

async function startPreviewPlayback(rendered: RenderResult): Promise<PreviewPlaybackHandle | undefined> {
  if (rendered.left.length === 0 || rendered.right.length === 0) {
    return undefined;
  }

  let stopRequested = false;
  let startupFailed = false;
  let playhead = 0;

  const output = await createNodeAudioSink({
    sampleRate: rendered.sampleRate,
    channels: 2,
    samplesPerFrame: PREVIEW_CHUNK_FRAMES,
    mode: 'auto',
  });

  if (!output) {
    return undefined;
  }

  output.onError(() => {
    if (playhead <= 0) {
      startupFailed = true;
    }
    stopRequested = true;
  });

  const chunk = Buffer.allocUnsafe(PREVIEW_CHUNK_FRAMES * 4);

  // 起動直後の失敗を検知するため、最初のチャンクを先に書き込む。
  playhead = writeLoopedPreviewPcmChunk(chunk, rendered, playhead);
  const firstWritable = output.write(chunk);
  if (!firstWritable) {
    const becameWritable = await waitPreviewWritableWithTimeout(output, () => stopRequested);
    if (!becameWritable) {
      stopRequested = true;
    }
  }

  if (startupFailed || stopRequested) {
    output.destroy();
    return undefined;
  }

  const done = (async () => {
    while (!stopRequested) {
      playhead = writeLoopedPreviewPcmChunk(chunk, rendered, playhead);

      const writable = output.write(chunk);
      if (!writable) {
        const becameWritable = await waitPreviewWritableWithTimeout(output, () => stopRequested);
        if (!becameWritable) {
          stopRequested = true;
          break;
        }
      }
    }

    output.destroy();
  })().catch(() => undefined);

  return {
    stop: () => {
      stopRequested = true;
      output.destroy();
    },
    done,
    backend: output.label,
  };
}

async function waitPreviewWritableWithTimeout(
  output: { waitWritable: (shouldStop: () => boolean) => Promise<void> },
  shouldStop: () => boolean,
): Promise<boolean> {
  if (shouldStop()) {
    return false;
  }

  const waitWritableTask = output
    .waitWritable(shouldStop)
    .then(() => true)
    .catch(() => false);
  const timeoutTask = delay(PREVIEW_BACKPRESSURE_TIMEOUT_MS).then(() => false);
  const writable = await Promise.race([waitWritableTask, timeoutTask]);
  return writable && !shouldStop();
}

function writeLoopedPreviewPcmChunk(chunk: Buffer, rendered: RenderResult, startFrame: number): number {
  const totalFrames = Math.max(1, Math.min(rendered.left.length, rendered.right.length));
  let source = startFrame;
  if (source >= totalFrames) {
    source %= totalFrames;
  }
  const firstChunkFrames = Math.min(PREVIEW_CHUNK_FRAMES, totalFrames - source);
  writeStereoPcm16Le(chunk, 0, rendered.left, rendered.right, source, firstChunkFrames);
  source += firstChunkFrames;
  if (source >= totalFrames) {
    source = 0;
  }
  const remainingFrames = PREVIEW_CHUNK_FRAMES - firstChunkFrames;
  if (remainingFrames > 0) {
    writeStereoPcm16Le(chunk, firstChunkFrames * 4, rendered.left, rendered.right, 0, remainingFrames);
    source = remainingFrames % totalFrames;
  }
  return source;
}
