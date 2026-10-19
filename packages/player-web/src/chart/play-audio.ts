// Chart audio preparation for the play session (`session/play/play-media.ts`), which every gameplay family plays
// through. One place decodes the chart's `#WAV` samples under the key the audio session looks them up by, into the
// play's audio graph (`runtime/play-audio-graph.ts`), stretches them for a keep-pitch tempo and folds the `#WAVCMD` /
// `#EXWAV` volumes.

import { runWithConcurrency } from '@be-music/utils/core';
import { collectBmsExWavVolumeMultipliers, collectBmsWavCmdVolumeMultipliers } from '@be-music/chart';
import { resolveBmsBase, type BeMusicJson } from '@be-music/json';
import type { NonstopStitchMap } from '@be-music/player/course';
import { loadAssetBytes, resolveChartAudioAsset } from '../collection/collection.ts';
import type { BrowserSongAssetSource } from '../collection/types.ts';
import {
  resolveSampleStretchRates,
  stretchDecodedSamples,
  type TempoPitchMode,
  type TimeStretchAlgorithm,
} from '../runtime/play-tempo.ts';
import { decodedSampleKey } from '../runtime/web-audio-session.ts';
import { logger } from '../logger.ts';

const log = logger('play-audio');

/** Samples decoded at once: bounded so hundreds of browser audio decoders don't allocate PCM together. */
const AUDIO_DECODE_CONCURRENCY = 8;

/**
 * Per-slot volume multipliers of a chart: `#WAVCMD 01 xx vv` and the volume of `#EXWAVxx`, multiplied together when a
 * slot has both. Pitch / pan / loop parameters are not applied.
 */
export function collectChartVolumeMultipliers(chart: BeMusicJson): Map<string, number> {
  const multipliers = collectBmsWavCmdVolumeMultipliers(chart.bms.wavCmds, resolveBmsBase(chart));
  for (const [slot, multiplier] of collectBmsExWavVolumeMultipliers(chart.bms.exWav)) {
    multipliers.set(slot, (multipliers.get(slot) ?? 1) * multiplier);
  }
  return multipliers;
}

export interface LoadPlaySamplesOptions {
  audioContext: BaseAudioContext;
  /** The resolved chart (after `#RANDOM` / `#IF`), so `#IF`-gated `#WAV`s match the chosen branches. */
  chart: BeMusicJson;
  source: BrowserSongAssetSource;
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
}

/**
 * Decodes every `#WAVxx` sample of the chart into `samples` (codec fallbacks via `resolveChartAudioAsset`, honouring
 * `#PATH_WAV`) and, for keep pitch, stretches them to the play tempo once so they then play at their own pitch.
 * Samples the browser can't decode are skipped. Resolves `true` when the samples were stretched.
 */
export async function loadPlaySamples(options: LoadPlaySamplesOptions): Promise<boolean> {
  const { audioContext, chart, source, chartPath, samples } = options;
  const isCancelled = options.isCancelled ?? (() => false);
  // Every declared path: a `#WAVxx` slot is base-36, so a dense chart can use well over 256 samples.
  const wavPaths = Object.values(chart.resources.wav).filter((path): path is string => typeof path === 'string');
  // `#PATH_WAV <prefix>`: the chart's samples live under that directory; the resolver tries the prefixed path first.
  const pathPrefix = typeof chart.bms.pathWav === 'string' ? chart.bms.pathWav : undefined;
  await runWithConcurrency(wavPaths, AUDIO_DECODE_CONCURRENCY, async (path) => {
    if (isCancelled()) return;
    // Audio entries are lazy `File` references; `loadAssetBytes` reads this chart's bytes on demand.
    const bytes = await loadAssetBytes(resolveChartAudioAsset(source, chartPath, path, { pathPrefix }));
    if (!bytes || isCancelled()) return;
    try {
      const decoded = await audioContext.decodeAudioData(bytes.slice().buffer);
      if (isCancelled()) return;
      // Keyed by the chart's `#WAV` value (not the codec file found), as the audio session looks it up.
      samples.set(decodedSampleKey(path), decoded);
    } catch (error) {
      // Unsupported codecs are skipped, and so is a decode cut short by the context closing (ESC during loading).
      log.debug('decode skipped', { path, error });
    }
  });
  if (options.tempoPitchMode !== 'keep-pitch' || isCancelled()) return false;
  const rates = resolveSampleStretchRates(chart.resources.wav, decodedSampleKey, options.tempo, options.nonstop);
  if (rates.size === 0) return false;
  await stretchDecodedSamples(audioContext, samples, rates, options.tempoStretchAlgorithm, isCancelled);
  return true;
}
