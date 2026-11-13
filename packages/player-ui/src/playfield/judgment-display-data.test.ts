import { expect, test } from 'vite-plus/test';
import { sameJudgmentDisplay } from './judgment-display-data.ts';

const word = { x: 10, text: 'GREAT', color: '#fff', combo: 3 };

test('compares judgment displays by their words and baseline', () => {
  const a = { y: 100, words: [word] };
  expect(sameJudgmentDisplay(a, { y: 100, words: [{ ...word }] })).toBe(true);
  expect(sameJudgmentDisplay(a, a)).toBe(true);
  expect(sameJudgmentDisplay(undefined, undefined)).toBe(true);
  expect(sameJudgmentDisplay(a, undefined)).toBe(false);
  expect(sameJudgmentDisplay(a, { y: 101, words: [word] })).toBe(false);
  expect(sameJudgmentDisplay(a, { y: 100, words: [] })).toBe(false);
  expect(sameJudgmentDisplay(a, { y: 100, words: [{ ...word, combo: 4 }] })).toBe(false);
  expect(sameJudgmentDisplay(a, { y: 100, words: [{ ...word, color: '#000' }] })).toBe(false);
  expect(sameJudgmentDisplay(a, { y: 100, words: [{ ...word, mode: 'AUTO PLAY' }] })).toBe(false);
});
