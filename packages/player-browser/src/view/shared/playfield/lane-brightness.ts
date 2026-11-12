/**
 * AC 34's lane brightness (レーンの明るさ調整): the lanes are dimmed by a black layer between the lane background and
 * what scrolls on it, so the notes, the bar lines and the covers keep their own brightness.
 */

/** The opacity of the black layer for a brightness in percent: none at 100 (or without a setting), solid at 0. */
export function resolveLaneDim(laneBrightness: number | undefined): number {
  if (laneBrightness === undefined || !Number.isFinite(laneBrightness)) return 0;
  return 1 - Math.max(0, Math.min(100, laneBrightness)) / 100;
}
