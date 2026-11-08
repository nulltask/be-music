import type { BeMusicJudgmentDisplayData, BeMusicJudgmentWord } from '../models.ts';

/** Whether two judgment displays show the same words in the same place. */
export function sameJudgmentDisplay(
  a: BeMusicJudgmentDisplayData | undefined,
  b: BeMusicJudgmentDisplayData | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a.y !== b.y || a.words.length !== b.words.length) return false;
  return a.words.every((word, index) => sameWord(word, b.words[index]!));
}

function sameWord(a: BeMusicJudgmentWord, b: BeMusicJudgmentWord): boolean {
  return (
    a.text === b.text && a.color === b.color && a.x === b.x && a.y === b.y && a.mode === b.mode && a.combo === b.combo
  );
}
