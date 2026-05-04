import { describe, expect, it } from 'vitest';
import { isSkinPathOfKind, scoreSkinPath } from './lr2-skin-paths.ts';

describe('isSkinPathOfKind', () => {
  it('matches LR2 screen folders with either slash style', () => {
    expect(isSkinPathOfKind('LR2files/Theme/LR2/Play/play_7.lr2skin', 'play')).toBe(true);
    expect(isSkinPathOfKind(String.raw`LR2files\Theme\LR2\Select\select.lr2skin`, 'select')).toBe(true);
    expect(isSkinPathOfKind('LR2files/Theme/LR2/Decide/decide.lr2skin', 'decide')).toBe(true);
  });

  it('keeps courseresult as a low-priority result candidate', () => {
    expect(isSkinPathOfKind('LR2files/Theme/LR2/CourseResult/result.lr2skin', 'result')).toBe(true);
    expect(isSkinPathOfKind('LR2files/Theme/LR2/Result/result.lr2skin', 'result')).toBe(true);
  });
});

describe('scoreSkinPath', () => {
  it('prioritizes an explicitly requested play variant', () => {
    expect(scoreSkinPath('LR2files/Theme/LR2/Play/play_14.lr2skin', 'play', '14')).toBe(-1);
    expect(scoreSkinPath('LR2files/Theme/LR2/Play/play_7.lr2skin', 'play', '14')).toBe(0);
  });

  it('prefers exact select / result / decide filenames over loose matches', () => {
    expect(scoreSkinPath('LR2files/Theme/LR2/Select/select.lr2skin', 'select')).toBe(0);
    expect(scoreSkinPath('LR2files/Theme/LR2/Select/select_old.lr2skin', 'select')).toBe(10);
    expect(scoreSkinPath('LR2files/Theme/LR2/Result/result.lr2skin', 'result')).toBe(0);
    expect(scoreSkinPath('LR2files/Theme/LR2/Decide/decide.lr2skin', 'decide')).toBe(0);
  });

  it('penalizes course-result and half-play skins as fallbacks', () => {
    expect(scoreSkinPath('LR2files/Theme/LR2/CourseResult/result.lr2skin', 'result')).toBe(90);
    expect(scoreSkinPath('LR2files/Theme/LR2/Play/play_half.lr2skin', 'play')).toBe(50);
  });
});
