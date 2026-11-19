import { resolveBmsWAVPlayback, type BmsWAVPlaybackModifiers } from '@be-music/chart-model';
import { normalizeObjectKey } from '@be-music/chart-source';
import { isAbortError, throwIfAborted, transformStereoPCM } from '@be-music/shared-utils/core';
import { createFallbackTone, decodeAudioSample, resampleLinear } from './decode.ts';
import { resolveSamplePath } from './sample-path.ts';

export interface RenderSampleLoadProgress {
  stage: 'resolving' | 'reading' | 'decoded' | 'cached' | 'fallback';
  sampleKey: string;
  samplePath?: string;
  resolvedPath?: string;
}

export interface RenderResult {
  sampleRate: number;
  left: Float32Array;
  right: Float32Array;
  durationSeconds: number;
  peak: number;
}

export interface RenderSingleSampleOptions {
  /** Authored pitch, pan, frequency and sounding-time limit, applied before host tempo controls. */
  playbackModifiers?: BmsWAVPlaybackModifiers;
  sampleRate?: number;
  gain?: number;
  baseDir?: string;
  fallbackToneSeconds?: number;
  signal?: AbortSignal;
  onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
  /**
   * Object-ID radix the supplied `sampleKey` was authored under. Defaults to base 36 (case-folded). Pass `62` for
   * charts that declared `#BASE 62` so a lowercase `0a` key isn't re-folded back to `0A` during validation.
   */
  base?: 36 | 62;
  /** The chart's `#PATH_WAV` directory, tried before the bare sample path. */
  pathPrefix?: string;
}

export interface StereoSample {
  left: Float32Array;
  right: Float32Array;
}

const DEFAULT_SAMPLE_RATE = 44_100;
const FALLBACK_SAMPLE_CACHE = new Map<string, StereoSample>();

export async function renderSingleSample(
  sampleKey: string,
  samplePath: string | undefined,
  options: RenderSingleSampleOptions = {},
): Promise<RenderResult> {
  const normalizedKey = normalizeObjectKey(sampleKey, options.base ?? 36);
  const sampleRate = options.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const gain = typeof options.gain === 'number' && Number.isFinite(options.gain) ? options.gain : 1;
  const baseDir = options.baseDir ?? process.cwd();
  // Spec-compliant default: missing / undecodable samples are silent. Pass a positive value to opt into the
  // debugging sine tone.
  const fallbackToneSeconds = options.fallbackToneSeconds ?? 0;
  throwIfAborted(options.signal);
  const load = createSampleLoader({
    sampleRate,
    baseDir,
    fallbackToneSeconds,
    signal: options.signal,
    pathPrefix: options.pathPrefix,
    onSampleLoadProgress: options.onSampleLoadProgress,
  });
  const sample = await load(normalizedKey, samplePath, options.playbackModifiers);
  throwIfAborted(options.signal);
  return toRenderResult(sample, sampleRate, gain);
}

/** Creates a loader for one chart render. Each sample key identifies one file and set of playback modifiers. */
export function createSampleLoader(options: {
  sampleRate: number;
  baseDir: string;
  fallbackToneSeconds: number;
  signal?: AbortSignal;
  onSampleLoadProgress?: (progress: RenderSampleLoadProgress) => void;
  pathPrefix?: string;
}): (sampleKey: string, samplePath?: string, playbackModifiers?: BmsWAVPlaybackModifiers) => Promise<StereoSample> {
  const { sampleRate, baseDir, fallbackToneSeconds, signal, onSampleLoadProgress, pathPrefix } = options;
  const loadedSamples = new Map<string, StereoSample>();
  const resolvedPathCache = new Map<string, string | undefined>();
  return async (
    sampleKey: string,
    samplePath?: string,
    playbackModifiers?: BmsWAVPlaybackModifiers,
  ): Promise<StereoSample> => {
    throwIfAborted(signal);

    const cached = loadedSamples.get(sampleKey);
    if (cached) {
      onSampleLoadProgress?.({
        stage: 'cached',
        sampleKey,
        samplePath,
      });
      return cached;
    }

    const originalFallback = getFallbackSample(sampleKey, sampleRate, fallbackToneSeconds);
    const fallback = playbackModifiers
      ? transformStereoPCM(
          originalFallback.left,
          originalFallback.right,
          sampleRate,
          sampleRate,
          resolveBmsWAVPlayback(playbackModifiers, sampleRate),
          signal,
        )
      : originalFallback;
    if (!samplePath) {
      loadedSamples.set(sampleKey, fallback);
      onSampleLoadProgress?.({
        stage: 'fallback',
        sampleKey,
        samplePath,
      });
      return fallback;
    }

    onSampleLoadProgress?.({
      stage: 'resolving',
      sampleKey,
      samplePath,
    });
    const resolvedPath = resolvedPathCache.has(samplePath)
      ? resolvedPathCache.get(samplePath)
      : await resolveSamplePath(baseDir, samplePath, signal, { pathPrefix });
    resolvedPathCache.set(samplePath, resolvedPath);

    if (!resolvedPath) {
      loadedSamples.set(sampleKey, fallback);
      onSampleLoadProgress?.({
        stage: 'fallback',
        sampleKey,
        samplePath,
      });
      return fallback;
    }

    try {
      throwIfAborted(signal);
      onSampleLoadProgress?.({
        stage: 'reading',
        sampleKey,
        samplePath,
        resolvedPath,
      });
      const { readFile } = await import('node:fs/promises');
      const buffer = await readFile(resolvedPath, { signal });
      throwIfAborted(signal);
      const decoded = await decodeAudioSample(buffer, resolvedPath, signal);
      throwIfAborted(signal);
      const rightSource = decoded.right ?? decoded.left;
      const sample = playbackModifiers
        ? transformStereoPCM(
            decoded.left,
            rightSource,
            decoded.sampleRate,
            sampleRate,
            resolveBmsWAVPlayback(playbackModifiers, decoded.sampleRate),
            signal,
          )
        : {
            left: resampleLinear(decoded.left, decoded.sampleRate, sampleRate, signal),
            right: resampleLinear(rightSource, decoded.sampleRate, sampleRate, signal),
          };
      loadedSamples.set(sampleKey, sample);
      onSampleLoadProgress?.({
        stage: 'decoded',
        sampleKey,
        samplePath,
        resolvedPath,
      });
      return sample;
    } catch (error) {
      if (isAbortError(error)) {
        throw error;
      }
      loadedSamples.set(sampleKey, fallback);
      onSampleLoadProgress?.({
        stage: 'fallback',
        sampleKey,
        samplePath,
        resolvedPath,
      });
      return fallback;
    }
  };
}

function getFallbackSample(sampleKey: string, sampleRate: number, fallbackToneSeconds: number): StereoSample {
  const cacheKey = `${sampleKey}:${sampleRate}:${fallbackToneSeconds}`;
  const cached = FALLBACK_SAMPLE_CACHE.get(cacheKey);
  if (cached) {
    return cached;
  }
  const created = createFallbackTone(sampleKey, sampleRate, fallbackToneSeconds);
  FALLBACK_SAMPLE_CACHE.set(cacheKey, created);
  return created;
}

function toRenderResult(sample: StereoSample, sampleRate: number, gain: number): RenderResult {
  const safeGain = Number.isFinite(gain) ? gain : 1;
  if (safeGain === 1) {
    return {
      sampleRate,
      left: sample.left,
      right: sample.right,
      durationSeconds: sample.left.length / sampleRate,
      peak: measurePeak(sample.left, sample.right),
    };
  }

  const left = new Float32Array(sample.left.length);
  const right = new Float32Array(sample.right.length);
  for (let index = 0; index < sample.left.length; index += 1) {
    left[index] = sample.left[index] * safeGain;
    right[index] = sample.right[index] * safeGain;
  }
  return {
    sampleRate,
    left,
    right,
    durationSeconds: left.length / sampleRate,
    peak: measurePeak(left, right),
  };
}

export function measurePeak(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    const absLeft = Math.abs(left[index]);
    const absRight = Math.abs(right[index]);
    if (absLeft > peak) {
      peak = absLeft;
    }
    if (absRight > peak) {
      peak = absRight;
    }
  }
  return peak;
}
