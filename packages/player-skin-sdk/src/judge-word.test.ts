import { describe, expect, it } from 'vite-plus/test';
import { FLASHING_GREAT_STEP_MS, flashingGreatColor, isFlashingGreat, judgeDisplayWord } from './judge-word.ts';

describe('judgeDisplayWord', () => {
  it('prints PERFECT as GREAT', () => {
    expect(judgeDisplayWord('PERFECT')).toBe('GREAT');
  });

  it('keeps the other judgements', () => {
    for (const judge of ['GREAT', 'GOOD', 'BAD', 'POOR']) expect(judgeDisplayWord(judge)).toBe(judge);
  });
});

describe('isFlashingGreat', () => {
  it('only PERFECT flashes', () => {
    expect(isFlashingGreat('PERFECT')).toBe(true);
    expect(isFlashingGreat('GREAT')).toBe(false);
  });
});

describe('flashingGreatColor', () => {
  const palette = [0x111111, 0x222222, 0x333333];

  it('steps through the palette and wraps', () => {
    expect(flashingGreatColor(0, palette)).toBe(0x111111);
    expect(flashingGreatColor(FLASHING_GREAT_STEP_MS - 1, palette)).toBe(0x111111);
    expect(flashingGreatColor(FLASHING_GREAT_STEP_MS, palette)).toBe(0x222222);
    expect(flashingGreatColor(FLASHING_GREAT_STEP_MS * 3, palette)).toBe(0x111111);
  });

  it('falls back on an empty palette or a bad clock', () => {
    expect(flashingGreatColor(100, [])).toBe(0xffffff);
    expect(flashingGreatColor(Number.NaN, palette)).toBe(0x111111);
    expect(flashingGreatColor(-500, palette)).toBe(0x111111);
  });
});
