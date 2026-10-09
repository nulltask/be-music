/** The loading caption the built-in skins print on the lanes while a chart's assets load. */
export const LOADING_WORD = 'NOW LOADING';

/** One dot per step, cycling `''` → `.` → `..` → `...` every {@link LOADING_DOT_MS}. */
export const LOADING_DOT_MS = 320;

export function loadingDots(nowMs: number): string {
  const step = Math.floor(Math.max(0, Number.isFinite(nowMs) ? nowMs : 0) / LOADING_DOT_MS) % 4;
  return '.'.repeat(step);
}
