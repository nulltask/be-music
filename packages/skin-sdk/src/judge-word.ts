/**
 * Judgement word shared by the built-in skins. Like the arcade cabinet, a PERFECT (PGREAT) prints as a colour-cycling
 * GREAT; the steady GREAT keeps its skin colour, so the flicker alone tells the two apart.
 */

/** How long each colour of the flashing GREAT holds, in ms (about three frames at 60 fps). */
export const FLASHING_GREAT_STEP_MS = 50;

/** Word a judgement prints as: PERFECT reads GREAT, everything else as is. */
export function judgeDisplayWord(judge: string): string {
  return judge === 'PERFECT' ? 'GREAT' : judge;
}

/** Whether `judge` prints as the colour-cycling GREAT. */
export function isFlashingGreat(judge: string): boolean {
  return judge === 'PERFECT';
}

/** Colour of the flashing GREAT at `nowMs`: steps through `palette`, one entry per {@link FLASHING_GREAT_STEP_MS}. */
export function flashingGreatColor(nowMs: number, palette: readonly number[]): number {
  if (palette.length === 0) return 0xffffff;
  const step = Math.floor((Number.isFinite(nowMs) ? Math.max(0, nowMs) : 0) / FLASHING_GREAT_STEP_MS);
  return palette[step % palette.length]!;
}
