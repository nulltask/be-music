// Debug Menu state for the audio bus's compressor tuning: the Web Audio parameters in units that read well on a slider
// (dB and milliseconds), conversion to and from the bus's `CompressorParams`, and persistence across reloads.

import {
  DEFAULT_COMPRESSOR_PARAMS,
  mergeCompressorParams,
  type CompressorParams,
  type TunableCompressor,
} from '@be-music/player-web/runtime';

/** One compressor's parameters as the sliders show them. */
export interface CompressorTuning {
  thresholdDb: number;
  kneeDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
}

export const TUNABLE_COMPRESSORS: readonly TunableCompressor[] = ['key', 'bgm', 'master', 'legacy'];

const STORAGE_KEY = 'be-music-demo.compressor-tuning';

/** Slider units for a bus `CompressorParams` (seconds → milliseconds). */
export function tuningFromParams(params: CompressorParams): CompressorTuning {
  return {
    thresholdDb: params.threshold,
    kneeDb: params.knee,
    ratio: params.ratio,
    attackMs: params.attack * 1000,
    releaseMs: params.release * 1000,
  };
}

/** Bus `CompressorParams` for slider values (milliseconds → seconds), clamped to the Web Audio ranges. */
export function paramsFromTuning(tuning: CompressorTuning, base: CompressorParams): CompressorParams {
  return mergeCompressorParams(base, {
    threshold: tuning.thresholdDb,
    knee: tuning.kneeDb,
    ratio: tuning.ratio,
    attack: tuning.attackMs / 1000,
    release: tuning.releaseMs / 1000,
  });
}

/** Factory tuning of every compressor, in slider units. */
export function defaultCompressorTunings(): Record<TunableCompressor, CompressorTuning> {
  return Object.fromEntries(
    TUNABLE_COMPRESSORS.map((compressor) => [compressor, tuningFromParams(DEFAULT_COMPRESSOR_PARAMS[compressor])]),
  ) as Record<TunableCompressor, CompressorTuning>;
}

/**
 * Parses stored tunings: each compressor's saved values are merged over its factory parameters (so a partial or stale
 * entry can't produce an out-of-range node), and anything unreadable falls back to the factory tuning.
 */
export function parseCompressorTunings(raw: string | null | undefined): Record<TunableCompressor, CompressorTuning> {
  const tunings = defaultCompressorTunings();
  if (!raw) return tunings;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return tunings;
  }
  if (typeof parsed !== 'object' || parsed === null) return tunings;
  for (const compressor of TUNABLE_COMPRESSORS) {
    const entry = (parsed as Record<string, unknown>)[compressor];
    if (typeof entry !== 'object' || entry === null) continue;
    const saved = { ...tunings[compressor], ...pickNumbers(entry as Record<string, unknown>) };
    tunings[compressor] = tuningFromParams(paramsFromTuning(saved, DEFAULT_COMPRESSOR_PARAMS[compressor]));
  }
  return tunings;
}

function pickNumbers(entry: Record<string, unknown>): Partial<CompressorTuning> {
  const picked: Partial<CompressorTuning> = {};
  for (const key of ['thresholdDb', 'kneeDb', 'ratio', 'attackMs', 'releaseMs'] as const) {
    const value = entry[key];
    if (typeof value === 'number' && Number.isFinite(value)) picked[key] = value;
  }
  return picked;
}

export function readStoredCompressorTunings(): Record<TunableCompressor, CompressorTuning> {
  try {
    return parseCompressorTunings(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return defaultCompressorTunings();
  }
}

export function storeCompressorTunings(tunings: Record<TunableCompressor, CompressorTuning>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tunings));
  } catch {
    // Private windows / blocked storage: the tuning still applies for this session.
  }
}
