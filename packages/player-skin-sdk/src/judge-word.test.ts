import { describe, expect, it } from 'vite-plus/test';
import {
  FLASHING_GREAT_STEP_MS,
  flashingGreatColor,
  formatJudgeDetail,
  isFlashingGreat,
  judgeDisplayWord,
  resolveJudgeWordY,
} from './judge-word.ts';

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

describe('resolveJudgeWordY', () => {
  const playfield = (judgeOffsetY?: number) => ({
    top: 40,
    judgementY: 440,
    ...(judgeOffsetY ? { judgeOffsetY } : {}),
  });

  it('keeps the skin’s position without an offset', () => {
    expect(resolveJudgeWordY(236, playfield())).toBe(236);
    expect(resolveJudgeWordY(10, playfield())).toBe(10);
  });

  it('moves the word by the offset, inside the lanes', () => {
    expect(resolveJudgeWordY(236, playfield(60))).toBe(296);
    expect(resolveJudgeWordY(236, playfield(-60))).toBe(176);
    // Not past 56 px above the judge line, nor 40 px under the lanes’ top.
    expect(resolveJudgeWordY(350, playfield(120))).toBe(384);
    expect(resolveJudgeWordY(120, playfield(-120))).toBe(80);
  });

  it('never moves a word the skin already places past a margin against the offset', () => {
    expect(resolveJudgeWordY(400, playfield(20))).toBe(400);
    expect(resolveJudgeWordY(60, playfield(-20))).toBe(60);
  });
});

describe('formatJudgeDetail', () => {
  it('words FAST / SLOW for an early or a late press, and nothing for a PGREAT or a press on time', () => {
    expect(formatJudgeDetail('FAST_SLOW', 'GREAT', -12)).toEqual({ text: 'FAST', tone: 'fast' });
    expect(formatJudgeDetail('FAST_SLOW', 'BAD', 80)).toEqual({ text: 'SLOW', tone: 'slow' });
    expect(formatJudgeDetail('FAST_SLOW', 'PERFECT', -3)).toBeUndefined();
    expect(formatJudgeDetail('FAST_SLOW', 'GREAT', 0)).toBeUndefined();
  });

  it('shows the offset in milliseconds with its sign, for every judgment', () => {
    expect(formatJudgeDetail('MS', 'GREAT', -12.4)).toEqual({ text: '-12 ms', tone: 'fast' });
    expect(formatJudgeDetail('MS', 'PERFECT', 6.6)).toEqual({ text: '+7 ms', tone: 'slow' });
    expect(formatJudgeDetail('MS', 'PERFECT', 0.3)).toEqual({ text: '±0 ms', tone: 'just' });
    expect(formatJudgeDetail('MS', 'PERFECT', -0.3)).toEqual({ text: '±0 ms', tone: 'just' });
  });

  it('has nothing for an offset that is not finite', () => {
    expect(formatJudgeDetail('MS', 'GREAT', Number.NaN)).toBeUndefined();
    expect(formatJudgeDetail('FAST_SLOW', 'GREAT', Number.POSITIVE_INFINITY)).toBeUndefined();
  });
});
