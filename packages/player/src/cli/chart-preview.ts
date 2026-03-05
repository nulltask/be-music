import { createHash } from 'node:crypto';
import { access } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { floatToInt16 } from '@be-music/utils';
import { createEmptyJson, type BeMusicJson } from '@be-music/json';
import { parseChartFile, resolveBmsControlFlow } from '@be-music/parser';
import { collectSampleTriggers, createTimingResolver, type RenderResult, renderJson } from '@be-music/audio-renderer';
import { createNodeAudioSink } from '../audio-sink.ts';
import { resolveChartVolWavGain } from '../player-utils.ts';

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

export interface PreviewFocusTarget {
  filePath?: string;
  previewContinueKey?: string;
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

export function createChartPreviewController(): ChartPreviewController {
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
    await Promise.race([playback.done.catch(() => undefined), createTimeoutPromise(PREVIEW_STOP_TIMEOUT_MS)]);
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
            preview = (await renderChartPreview(filePath, renderAbortController.signal)) ?? null;
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
): Promise<string | undefined> {
  const previewPath = chart.bms.preview;
  if (typeof previewPath !== 'string' || previewPath.trim().length === 0) {
    return resolveFallbackPreviewIdentity(chart)?.continueKey;
  }
  const candidates = createPreviewPathCandidates(chart, previewPath);
  const baseDir = dirname(chartPath);
  for (const candidate of candidates) {
    const resolvedCandidate = resolvePreviewCandidatePath(baseDir, candidate);
    if (await doesFileExist(resolvedCandidate)) {
      return normalizePreviewContinueKey(resolvedCandidate);
    }
  }
  const firstCandidate = candidates[0];
  if (!firstCandidate) {
    return resolveFallbackPreviewIdentity(chart)?.continueKey;
  }
  return resolveFallbackPreviewIdentity(chart)?.continueKey;
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

async function renderChartPreview(filePath: string, signal?: AbortSignal): Promise<ChartPreviewAsset | undefined> {
  throwIfAborted(signal);
  const chart = await parseChartFile(filePath);
  throwIfAborted(signal);
  const resolved = resolveBmsControlFlow(chart, { random: () => 0 });
  const chartWavGain = resolveChartVolWavGain(resolved);
  const previewPath = resolved.bms.preview;
  if (typeof previewPath === 'string' && previewPath.trim().length > 0) {
    const previewSample = await renderPreviewSampleFile(resolved, filePath, previewPath, chartWavGain, signal);
    if (previewSample) {
      return {
        continueKey: previewSample.continueKey,
        rendered: trimPreviewLeadingSilence(previewSample.rendered),
      };
    }
  }
  const fallbackPreview = await renderFallbackChartPreview(resolved, filePath, chartWavGain, signal);
  if (!fallbackPreview) {
    return undefined;
  }
  return {
    continueKey: fallbackPreview.continueKey,
    rendered: trimPreviewLeadingSilence(fallbackPreview.rendered),
  };
}

async function doesFileExist(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function renderPreviewSampleFile(
  chart: BeMusicJson,
  chartPath: string,
  previewPath: string,
  gain: number,
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
      gain,
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
  gain: number,
  signal?: AbortSignal,
): Promise<RenderedPreviewSample | undefined> {
  const fallbackIdentity = resolveFallbackPreviewIdentity(chart);
  if (!fallbackIdentity) {
    return undefined;
  }
  const rendered = await renderJson(chart, {
    baseDir: dirname(chartPath),
    tailSeconds: 0,
    startSeconds: fallbackIdentity.startSeconds,
    gain,
    fallbackToneSeconds: 0.05,
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

function resolveFallbackPreviewIdentity(chart: BeMusicJson): FallbackPreviewIdentity | undefined {
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
  const hash = createHash('sha1');
  hash.update('fallback-preview-signature-v3\n');
  hash.update(`source:${chart.sourceFormat}\n`);
  hash.update(`baseBpm:${encodeSignatureNumber(chart.metadata.bpm)}\n`);

  for (const point of resolver.tempoPoints) {
    hash.update(
      `tempo:${encodeSignatureNumber(point.beat)}:${encodeSignatureNumber(point.bpm)}:${encodeSignatureNumber(point.seconds)}\n`,
    );
  }
  for (const point of resolver.stopPoints) {
    hash.update(`stop:${encodeSignatureNumber(point.beat)}:${encodeSignatureNumber(point.seconds)}\n`);
  }
  const normalizedTriggers = triggers
    .map(
      (trigger) =>
        `trigger:${encodeSignatureNumber(trigger.seconds)}:${encodeSignatureNumber(trigger.beat)}:${trigger.sampleKey}:${normalizePreviewContinueKey(trigger.samplePath ?? '')}:${encodeSignatureNumber(trigger.sampleOffsetSeconds)}:${encodeSignatureNumber(trigger.sampleDurationSeconds)}:${trigger.sampleSliceId ?? ''}\n`,
    )
    .sort();
  for (const normalizedTrigger of normalizedTriggers) {
    hash.update(normalizedTrigger);
  }

  return {
    continueKey: `fallback:${hash.digest('hex').slice(0, 24)}`,
    startSeconds: firstTriggerSeconds,
  };
}

function encodeSignatureNumber(value: number | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '-';
  }
  return `${Math.round(value * 1_000_000)}`;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) {
    return;
  }
  const error = new Error('The operation was aborted.');
  error.name = 'AbortError';
  throw error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
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
  const timeoutTask = createTimeoutPromise(PREVIEW_BACKPRESSURE_TIMEOUT_MS).then(() => false);
  const writable = await Promise.race([waitWritableTask, timeoutTask]);
  return writable && !shouldStop();
}

function createTimeoutPromise(ms: number): Promise<void> {
  return new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}

function writeLoopedPreviewPcmChunk(chunk: Buffer, rendered: RenderResult, startFrame: number): number {
  const totalFrames = Math.max(1, Math.min(rendered.left.length, rendered.right.length));
  let source = startFrame;
  if (source >= totalFrames) {
    source %= totalFrames;
  }
  for (let frame = 0; frame < PREVIEW_CHUNK_FRAMES; frame += 1) {
    const offset = frame * 4;
    chunk.writeInt16LE(floatToInt16(rendered.left[source]), offset);
    chunk.writeInt16LE(floatToInt16(rendered.right[source]), offset + 2);
    source += 1;
    if (source >= totalFrames) {
      source = 0;
    }
  }
  return source;
}
