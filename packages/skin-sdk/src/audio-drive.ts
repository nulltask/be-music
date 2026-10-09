import { AUDIO_BAND_COUNT, SILENT_AUDIO, type BeMusicAudioFrame } from './audio.ts';

/**
 * Audio drive for built-in skins: the frame's audio features scaled by the effects level (full = as analysed, reduced
 * = half, off = silent), so every audio-reactive visual honours the comfort setting in one place.
 */
export interface AudioDrive {
  level: number;
  peak: number;
  db: number;
  bass: number;
  mid: number;
  high: number;
  bands: readonly number[];
  /** Onset envelope (1 → 0 over ~150 ms after each transient). */
  onset: number;
  onsetAtMs: number | undefined;
}

const SILENT_BANDS: readonly number[] = Object.freeze(Array.from({ length: AUDIO_BAND_COUNT }, () => 0));

export function audioDrive(
  audio: BeMusicAudioFrame | undefined,
  effects: 'full' | 'reduced' | 'off' | undefined,
): AudioDrive {
  const amount = effects === 'off' ? 0 : effects === 'reduced' ? 0.5 : 1;
  const source = audio ?? SILENT_AUDIO;
  if (amount === 0 || !audio) {
    return { ...SILENT_AUDIO, db: source.db, bands: SILENT_BANDS, onsetAtMs: undefined };
  }
  return {
    level: source.level * amount,
    peak: source.peak * amount,
    db: source.db,
    bass: source.bass * amount,
    mid: source.mid * amount,
    high: source.high * amount,
    bands: amount === 1 ? source.bands : source.bands.map((band) => band * amount),
    onset: source.onset * amount,
    onsetAtMs: source.onsetAtMs,
  };
}

/** Band `index` resampled to `count` columns (nearest), for skins that draw fewer or more bars than bands. */
export function bandAt(bands: readonly number[], index: number, count: number): number {
  if (bands.length === 0 || count <= 0) return 0;
  const band = Math.min(bands.length - 1, Math.max(0, Math.floor(((index + 0.5) / count) * bands.length)));
  return bands[band] ?? 0;
}

/**
 * Display level of column `index` of `count` (0..1): {@link bandAt} with a slight treble tilt and the floor / ceiling
 * stretched so bars use their full height. The analysed bands already follow each band's recent range, so a bar drops
 * to the bottom between hits and reaches the top on them rather than resting near either end.
 */
export function bandLevel(bands: readonly number[], index: number, count: number): number {
  const position = count > 1 ? index / (count - 1) : 0;
  const tilted = bandAt(bands, index, count) * (1 + 0.3 * position);
  return Math.max(0, Math.min(1, (tilted - 0.3) / 0.62));
}
