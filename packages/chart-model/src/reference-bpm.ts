import type { BeMusicJSON } from '@be-music/chart-source';

/**
 * Resolves the chart's reference BPM for hi-speed / scroll-speed normalization, honoring the BMS spec for `#BASEBPM`.
 *
 * Spec — `#BASEBPM N` (hitkey BMS Memo): declares the chart's reference BPM for HS-fix style scroll calibration. When
 * set, scroll-speed-aware consumers should treat that value as the "main BPM" instead of the chart's initial `#BPM`.
 * When absent we fall back to the parser-extracted `metadata.bpm`, which is the chart's first declared `#BPM`.
 *
 * `fallbackBPM` is the optional last-resort value the host can supply (e.g. a song-list-cached BPM hint) for charts
 * that omit both `#BASEBPM` and `#BPM` — a rare but legal corner of the spec.
 *
 * Returns `undefined` when no positive BPM is available, so callers can early-out without applying a meaningless ratio.
 */
export function resolveChartReferenceBPM(json: BeMusicJSON, fallbackBPM?: number): number | undefined {
  const baseBPM = json.bms.baseBPM;
  if (typeof baseBPM === 'number' && Number.isFinite(baseBPM) && baseBPM > 0) {
    return baseBPM;
  }
  const metadataBPM = json.metadata.bpm;
  if (typeof metadataBPM === 'number' && Number.isFinite(metadataBPM) && metadataBPM > 0) {
    return metadataBPM;
  }
  if (typeof fallbackBPM === 'number' && Number.isFinite(fallbackBPM) && fallbackBPM > 0) {
    return fallbackBPM;
  }
  return undefined;
}
