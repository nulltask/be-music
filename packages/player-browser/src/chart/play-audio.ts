// Chart audio preparation for the play session (`session/play/play-media.ts`), which every gameplay family plays
// through. One place decodes the chart's `#WAV` samples under the key the audio session looks them up by, into the
// play's audio graph (`runtime/play-audio-graph.ts`), stretches them for a keep-pitch tempo and folds the `#WAVCMD` /
// `#EXWAV` volumes.

import { runWithConcurrency } from '@be-music/shared-utils/core';
import {
  collectBmsWAVVolumeMultipliers,
  resolveBmsWAVResources,
  resolveReferencedBmsWAVResources,
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
import type { ChartSampleCache, ChartSampleLease } from '../runtime/chart-sample-cache.ts';
import { decodedSampleKey } from '../runtime/web-audio-session.ts';
import { prepareWAVPlaybackBuffer, readNativeAudioSampleRate } from '../runtime/wav-playback.ts';
import { logger } from '../logger.ts';
import { applyChartPeakGain } from './peak-gain.ts';

const log = logger('play-audio');

/**
 * Samples decoded at once: one per core, as the browser decodes them in parallel and the wall time stops falling there
 * (a 1,300-sample chart on 10 cores: 1.45 s at 4, 0.99 s at 8, 0.86 s at 16, 0.88 s at 32). At least 4, and at most 16
 * so hundreds of decoders don't allocate PCM together.
 */
export function resolveAudioDecodeConcurrency(hardwareConcurrency: number | undefined): number {
  const cores = hardwareConcurrency !== undefined && Number.isFinite(hardwareConcurrency) ? hardwareConcurrency : 8;
  return Math.min(16, Math.max(4, Math.floor(cores)));
}

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
  /**
   * The decoded samples of the chart played last (`AudioService.chartSamples`). A play of the same chart takes its
   * decodes from there and decodes only what is missing; a play of another chart releases them first. Without it,
   * every sample decodes.
   */
  sampleCache?: ChartSampleCache;
}

/**
 * Decodes every `#WAVxx` sample the chart plays into `samples` (codec fallbacks via `resolveChartAudioAsset`, honouring
 * `#PATH_WAV`) and, for keep pitch, stretches them to the play tempo once so they then play at their own pitch.
 * Decode or read failures advance to the next distinct asset; a sample with no playable candidate is skipped. Resolves `true` when the samples were stretched.
 */
export async function loadPlaySamples(options: LoadPlaySamplesOptions): Promise<boolean> {
  const { audioContext, chart, source, chartPath, samples } = options;
  const isCancelled = options.isCancelled ?? (() => false);
  // Every declared slot: a `#WAVxx` slot is base-36, so a dense chart can use well over 256 samples.
  const wavResources = resolveBmsWAVResources(chart);
  const playbackModifiers = collectBmsWAVPlaybackModifiers(chart);
  const nativeRatePaths = new Set(
    [...playbackModifiers].filter(([, value]) => value.frequencyHz !== undefined).map(([key]) => wavResources[key]),
  );
  const nativeRates = new Map<string, number>();
  // Only what some sample event names: a chart can declare hundreds of slots it never plays (a short cut of a long
  // track), and each decoded sample costs its whole PCM. One path behind several slots decodes once.
  const wavPaths = [
    ...new Set(
      Object.values(resolveReferencedBmsWAVResources(chart)).filter((path): path is string => typeof path === 'string'),
    ),
  ];
  // `#PATH_WAV <prefix>`: the chart's samples live under that directory; the resolver tries the prefixed path first.
  const pathPrefix = typeof chart.bms.pathWAV === 'string' ? chart.bms.pathWAV : undefined;
  const concurrency = resolveAudioDecodeConcurrency(
    typeof navigator === 'undefined' ? undefined : navigator.hardwareConcurrency,
  );
  const lease = options.sampleCache?.claim({
    source,
    chartPath,
    pathPrefix,
    sampleRate: audioContext.sampleRate,
  });
  await runWithConcurrency(wavPaths, concurrency, async (path) => {
    if (isCancelled()) return;
    const cached = lease?.get(path);
    // A path that needs its native rate decodes again when the cached decode has none (its `#EXWAV` changed branch).
    if (cached !== undefined && (!nativeRatePaths.has(path) || cached.nativeSampleRate !== undefined)) {
      if (cached.nativeSampleRate !== undefined) nativeRates.set(path, cached.nativeSampleRate);
      samples.set(decodedSampleKey(path), cached.buffer);
      return;
    }
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
        let nativeSampleRate: number | undefined;
        if (nativeRatePaths.has(path)) {
          // The PCM decoded; an unreadable container header only loses the EXWAV native-rate reference.
          try {
            nativeSampleRate = await readNativeAudioSampleRate(bytes);
            nativeRates.set(path, nativeSampleRate);
          } catch (error) {
            log.debug('native sample rate unavailable', { path, error });
          }
        }
        // Kept even when the play was abandoned meanwhile: an F5 during loading picks up from here.
        lease?.set(path, nativeSampleRate !== undefined ? { buffer: decoded, nativeSampleRate } : { buffer: decoded });
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
  // A play that loaded every sample leaves the cache with only those: no other `#RANDOM` branch's samples stay behind.
  if (!isCancelled()) lease?.retain(wavPaths);
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
    // The gain scales in place, so a cached decode the play would scale is copied first.
    if (lease !== undefined) copyCachedBuffers(audioContext, samples, new Set(Object.values(stretchResources)), lease);
    const audibleBuffers = new Set(
      Object.values(stretchResources)
        .map((key) => samples.get(key))
        .filter((buffer): buffer is AudioBuffer => buffer !== undefined),
    );
    applyChartPeakGain(audibleBuffers);
  }
  return stretched;
}

/** Replaces each of `keys`' buffers that `lease` holds with a copy of it in `samples`, one copy per buffer. */
function copyCachedBuffers(
  context: BaseAudioContext,
  samples: Map<string, AudioBuffer>,
  keys: ReadonlySet<string>,
  lease: ChartSampleLease,
): void {
  const copies = new Map<AudioBuffer, AudioBuffer>();
  for (const key of keys) {
    const buffer = samples.get(key);
    if (buffer === undefined || !lease.holds(buffer)) continue;
    let copy = copies.get(buffer);
    if (copy === undefined) {
      copy = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
      for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
        copy.copyToChannel(buffer.getChannelData(channel), channel);
      }
      copies.set(buffer, copy);
    }
    samples.set(key, copy);
  }
}
