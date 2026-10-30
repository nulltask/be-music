// Chart audio preparation for the play session (`session/play/play-media.ts`), which every gameplay family plays
// through. One place decodes the chart's `#WAV` samples under the key the audio session looks them up by, into the
// play's audio graph (`runtime/play-audio-graph.ts`), stretches them for a keep-pitch tempo and folds the `#WAVCMD` /
// `#EXWAV` volumes.

import { runWithConcurrency } from '@be-music/shared-utils/core';
import {
  collectBmsWAVVolumeMultipliers,
  resolveBMSWAVResources,
  collectBmsWAVPlaybackModifiers,
} from '@be-music/chart-model';
import { type BeMusicJSON } from '@be-music/chart-source';
import type { NonstopStitchMap } from '@be-music/player-engine/course';
import { loadAssetBytes, resolveChartAudioAsset } from '../collection/collection.ts';
import type { BrowserAssetEntry, BrowserAssetSource } from '../collection/types.ts';
import {
  resolveSampleStretchRates,
  stretchDecodedSamples,
  type TempoPitchMode,
  type TimeStretchAlgorithm,
} from '../runtime/play-tempo.ts';
import { decodedSampleKey } from '../runtime/web-audio-session.ts';
import { prepareWAVPlaybackBuffer, readNativeAudioSampleRate } from '../runtime/wav-playback.ts';
import { logger } from '../logger.ts';
import { applyChartPeakGain } from './peak-gain.ts';

const log = logger('play-audio');

/** Samples decoded at once: bounded so hundreds of browser audio decoders don't allocate PCM together. */
const AUDIO_DECODE_CONCURRENCY = 8;

/**
 * Per-slot volume multipliers of a chart: `#WAVCMD 01 xx vv` and the volume of `#EXWAVxx`, multiplied together when a
 * slot has both. Pitch, balance, frequency and sounding time are prepared separately.
 */
export function collectChartVolumeMultipliers(chart: BeMusicJSON): Map<string, number> {
  return collectBmsWAVVolumeMultipliers(chart);
}

export interface LoadPlaySamplesOptions {
  audioContext: BaseAudioContext;
  /** The resolved chart (after `#RANDOM` / `#IF`), so `#IF`-gated `#WAV`s match the chosen branches. */
  chart: BeMusicJSON;
  source: BrowserAssetSource;
  chartPath: string;
  /** The map the samples land in, keyed by {@link decodedSampleKey} of the chart's `#WAV` path. */
  samples: Map<string, AudioBuffer>;
  /** The play tempo (`clampPlayTempo`). */
  tempo: number;
  tempoPitchMode: TempoPitchMode;
  tempoStretchAlgorithm: TimeStretchAlgorithm;
  /** A stitched NONSTOP chart's stages: keep pitch stretches each stage's samples by its FIT rate too. */
  nonstop?: NonstopStitchMap;
  /** True once the play was abandoned: the remaining decodes and stretches are skipped. */
  isCancelled?: () => boolean;
  /**
   * Scale every decoded sample by one gain so the loudest peak sits near −3 dBFS. Off unless the host asks: charts
   * keep the level they were authored at.
   */
  peakGain?: boolean;
}

/**
 * Decodes every `#WAVxx` sample of the chart into `samples` (codec fallbacks via `resolveChartAudioAsset`, honouring
 * `#PATH_WAV`) and, for keep pitch, stretches them to the play tempo once so they then play at their own pitch.
 * Decode or read failures advance to the next distinct asset; a sample with no playable candidate is skipped. Resolves `true` when the samples were stretched.
 */
export async function loadPlaySamples(options: LoadPlaySamplesOptions): Promise<boolean> {
  const { audioContext, chart, source, chartPath, samples } = options;
  const isCancelled = options.isCancelled ?? (() => false);
  // Every declared path: a `#WAVxx` slot is base-36, so a dense chart can use well over 256 samples.
  const wavResources = resolveBMSWAVResources(chart);
  const playbackModifiers = collectBmsWAVPlaybackModifiers(chart);
  const nativeRatePaths = new Set(
    [...playbackModifiers].filter(([, value]) => value.frequencyHz !== undefined).map(([key]) => wavResources[key]),
  );
  const nativeRates = new Map<string, number>();
  const wavPaths = Object.values(wavResources).filter((path): path is string => typeof path === 'string');
  // `#PATH_WAV <prefix>`: the chart's samples live under that directory; the resolver tries the prefixed path first.
  const pathPrefix = typeof chart.bms.pathWAV === 'string' ? chart.bms.pathWAV : undefined;
  await runWithConcurrency(wavPaths, AUDIO_DECODE_CONCURRENCY, async (path) => {
    if (isCancelled()) return;
    const attempted = new Set<BrowserAssetEntry>();
    while (!isCancelled()) {
      const entry = resolveChartAudioAsset(source, chartPath, path, {
        pathPrefix,
        ...(attempted.size ? { excludedEntries: attempted } : {}),
      });
      if (entry === undefined || attempted.has(entry)) return;
      attempted.add(entry);
      try {
        // Lazy audio files are read only when their codec candidate is attempted.
        const bytes = await loadAssetBytes(entry);
        if (isCancelled()) return;
        if (!bytes) continue;
        const decoded = await audioContext.decodeAudioData(bytes.slice().buffer);
        if (nativeRatePaths.has(path)) nativeRates.set(path, await readNativeAudioSampleRate(bytes));
        if (isCancelled()) return;
        // Keep the declared WAV name as the key even when an alternate codec supplied the PCM.
        samples.set(decodedSampleKey(path), decoded);
        return;
      } catch (error) {
        if (isCancelled()) return;
        log.debug('decode candidate skipped', { path, error });
      }
    }
  });
  const stretchResources: Record<string, string> = {};
  for (const [key, path] of Object.entries(wavResources)) {
    const modifiers = playbackModifiers.get(key);
    const cacheKey = decodedSampleKey(path, modifiers ? key : undefined);
    stretchResources[key] = cacheKey;
    const buffer = samples.get(decodedSampleKey(path));
    if (modifiers && buffer && !isCancelled()) {
      samples.set(cacheKey, prepareWAVPlaybackBuffer(audioContext, buffer, modifiers, nativeRates.get(path)));
    }
  }
  let stretched = false;
  if (options.tempoPitchMode === 'keep-pitch' && !isCancelled()) {
    const rates = resolveSampleStretchRates(stretchResources, (key) => key, options.tempo, options.nonstop);
    if (rates.size > 0) {
      await stretchDecodedSamples(audioContext, samples, rates, options.tempoStretchAlgorithm, isCancelled);
      stretched = true;
    }
  }
  // After stretch, so a keep-pitch resample's new peak is what the gain sees. `#VOLWAV` still applies at playback.
  if (options.peakGain === true && !isCancelled()) {
    const audibleBuffers = new Set(
      Object.values(stretchResources)
        .map((key) => samples.get(key))
        .filter((buffer): buffer is AudioBuffer => buffer !== undefined),
    );
    applyChartPeakGain(audibleBuffers);
  }
  return stretched;
}
