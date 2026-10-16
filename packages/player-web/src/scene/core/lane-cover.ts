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

/**
 * The hi-speed that shows a note for `visibleMs` ({@link resolveNoteVisibleMs} solved for the hi-speed, the scroll being
 * `pixelsPerBeatAtHiSpeed1 × hiSpeed`, without `#SCROLL`): a replay uses it to match a visible time recorded on another
 * hi-speed scale. `undefined` when nothing of the lane is uncovered or an input is not positive.
 */
export function resolveHiSpeedForVisibleMs(
  laneHeightPx: number,
  suddenRatio: number,
  liftRatio: number,
  pixelsPerBeatAtHiSpeed1: number,
  bpm: number,
  visibleMs: number,
): number | undefined {
  const atHiSpeed1 = resolveNoteVisibleMs(laneHeightPx, suddenRatio, liftRatio, pixelsPerBeatAtHiSpeed1, bpm);
  if (!(atHiSpeed1 > 0) || !(visibleMs > 0)) return undefined;
  return atHiSpeed1 / visibleMs;
}
