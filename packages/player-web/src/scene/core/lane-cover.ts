import type { BeMusicLaneCover } from '../../skin/be-music/types.ts';

/** The HIDDEN / SUDDEN mask picked for one play side. */
export type LaneCoverMode = 'OFF' | 'HIDDEN' | 'SUDDEN' | 'HID+SUD';

/**
 * Writes one side's lane cover into `target` (reused across frames, so the per-frame runtime allocates nothing): the
 * fraction of the lane height covered at the top (SUDDEN+) and just above the judgement line (HIDDEN+). Mirrors the
 * scene's own shutter: nothing is covered while LANE COVER is off (`enabled === false`) or the mode is `OFF`, and
 * `shutter` (default 0.25) is clamped to 0..1 and applies to both ends under HID+SUD. LIFT isn't supported, so `lift`
 * stays 0.
 */
export function fillLaneCover(
  target: BeMusicLaneCover,
  mode: LaneCoverMode,
  shutter: number | undefined,
  enabled: boolean | undefined,
): BeMusicLaneCover {
  const ratio = enabled === false || mode === 'OFF' ? 0 : Math.max(0, Math.min(1, shutter ?? 0.25));
  target.sudden = mode === 'SUDDEN' || mode === 'HID+SUD' ? ratio : 0;
  target.hidden = mode === 'HIDDEN' || mode === 'HID+SUD' ? ratio : 0;
  target.lift = 0;
  return target;
}

/**
 * How long (ms) a note stays on screen, from the lower edge of the SUDDEN+ cover down to the judgement line, at the
 * current scroll: `laneHeightPx` scaled by the uncovered part (`1 - suddenRatio - liftRatio`), travelled at
 * `pixelsPerBeat`, one beat lasting `60000 / bpm` ms. This is beatoraja's white number (`240000 / bpm / hispeed ×
 * (1 - lanecover)` for a lane one measure tall) expressed in the core view's pixel scroll. HIDDEN+ is not subtracted:
 * like beatoraja, the duration runs to the judgement line. `scrollRate` is the chart's `#SCROLL` × `#SPEED` at the
 * playhead: beatoraja divides by it (`region = nscroll > 0 ? (240000 / nbpm / hispeed / speed) / nscroll : 0`), so
 * the duration is 0 while the chart scrolls backwards or stands still. Returns 0 when the scroll or BPM is not
 * positive.
 */
export function resolveNoteVisibleMs(
  laneHeightPx: number,
  suddenRatio: number,
  liftRatio: number,
  pixelsPerBeat: number,
  bpm: number,
  scrollRate = 1,
): number {
  if (!(pixelsPerBeat > 0) || !(bpm > 0) || !(laneHeightPx > 0) || !(scrollRate > 0)) return 0;
  const uncovered = Math.max(0, 1 - Math.max(0, suddenRatio) - Math.max(0, liftRatio));
  return ((laneHeightPx * uncovered) / pixelsPerBeat / scrollRate) * (60_000 / bpm);
}

/** IIDX-style green number for a visible duration: `visibleMs × 3 / 5`, rounded (beatoraja's `duration_green`). */
export function resolveGreenNumber(visibleMs: number): number {
  return Math.round((visibleMs * 3) / 5);
}
