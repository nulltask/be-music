import type { BeMusicJudgeDetail } from './types.ts';

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

/** How close to the lanes' top and to the judge line a moved judgment word may come, in stage pixels. */
export const JUDGE_WORD_MARGIN = { top: 40, bottom: 56 } as const;

/**
 * Where the judgment word sits once the player's offset is applied: `skinY`, the skin's own position, moved by the
 * layout's `judgeOffsetY` and kept inside the lanes, {@link JUDGE_WORD_MARGIN} clear of their top and of the judge line
 * (the combo sits under the word). Without an offset the skin's position is returned as it is, and an offset never
 * moves the word against its own direction when the skin already places it past a margin.
 */
export function resolveJudgeWordY(
  skinY: number,
  playfield: { readonly top: number; readonly judgementY: number; readonly judgeOffsetY?: number },
): number {
  const offset = playfield.judgeOffsetY ?? 0;
  if (offset === 0) return skinY;
  if (offset > 0) return Math.max(skinY, Math.min(playfield.judgementY - JUDGE_WORD_MARGIN.bottom, skinY + offset));
  return Math.min(skinY, Math.max(playfield.top + JUDGE_WORD_MARGIN.top, skinY + offset));
}

/** How the judge detail reads a judgment's timing: `FAST` / `SLOW`, or the offset in milliseconds. */
export type JudgeDetailMode = 'FAST_SLOW' | 'MS';

/**
 * A judgment's timing as the judge detail words it. `deltaMs` is the signed offset from the note's time, negative
 * early and positive late.
 *
 * - `FAST_SLOW`: `FAST` or `SLOW`. A PERFECT and an offset of 0 show nothing, as a PGREAT has no FAST / SLOW.
 * - `MS`: the offset rounded to a millisecond with its sign (`-12 ms`, `+7 ms`, `±0 ms`), for every judgment.
 *
 * `undefined` when there is nothing to show, and for an offset that is not finite.
 */
export function formatJudgeDetail(
  mode: JudgeDetailMode,
  judge: string,
  deltaMs: number,
): Pick<BeMusicJudgeDetail, 'text' | 'tone'> | undefined {
  if (!Number.isFinite(deltaMs)) return undefined;
  if (mode === 'FAST_SLOW') {
    if (judge === 'PERFECT' || deltaMs === 0) return undefined;
    return deltaMs < 0 ? { text: 'FAST', tone: 'fast' } : { text: 'SLOW', tone: 'slow' };
  }
  const rounded = Math.round(deltaMs);
  if (rounded === 0) return { text: '±0 ms', tone: 'just' };
  return rounded < 0 ? { text: `${rounded} ms`, tone: 'fast' } : { text: `+${rounded} ms`, tone: 'slow' };
}
