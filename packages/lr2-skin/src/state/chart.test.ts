import { createEmptyJSON } from '@be-music/json';
import { describe, expect, it } from 'vite-plus/test';
import { LR2_OP, LR2_TEXT } from '../ids/index.ts';
import {
  resolveLR2ChartFeatures,
  resolveLR2ChartText,
  resolveLR2DifficultyOp,
  resolveLR2JudgeRankOp,
  resolveLR2KeyModeOp,
} from './chart.ts';
import { makeChart, makeChartWith } from './test-support.ts';

describe('resolveLR2KeyModeOp', () => {
  it('lights the key-mode op of the chart’s play variant', () => {
    expect(resolveLR2KeyModeOp(makeChartWith({ channels: ['11', '16'] }))).toBe(LR2_OP.KEYS_5);
    expect(resolveLR2KeyModeOp(makeChartWith({ channels: ['11', '18'] }))).toBe(LR2_OP.KEYS_7);
    expect(resolveLR2KeyModeOp(makeChartWith({ channels: ['11', '21'] }))).toBe(LR2_OP.KEYS_10);
    expect(resolveLR2KeyModeOp(makeChartWith({ channels: ['22'] }, { chartPath: 'test/song.pms' }))).toBe(
      LR2_OP.KEYS_9,
    );
  });

  it('takes a bmson mode hint first and folds the 24-key modes onto 7 / 14 keys', () => {
    expect(resolveLR2KeyModeOp(makeChartWith({ channels: ['11'], modeHint: 'beat-14k' }))).toBe(LR2_OP.KEYS_14);
    expect(resolveLR2KeyModeOp(makeChartWith({ modeHint: 'keyboard-24k' }))).toBe(LR2_OP.KEYS_7);
    expect(resolveLR2KeyModeOp(makeChartWith({ modeHint: 'keyboard-24k-double' }))).toBe(LR2_OP.KEYS_14);
  });
});

describe('resolveLR2ChartFeatures', () => {
  it('reads the BGA, long notes, BPM changes and #RANDOM off the chart', () => {
    expect(resolveLR2ChartFeatures(createEmptyJSON())).toEqual({
      bga: false,
      longNote: false,
      bpmChange: false,
      random: false,
    });
    expect(resolveLR2ChartFeatures(makeChartWith({ channels: ['04', '51', '08'] }).chart)).toEqual({
      bga: true,
      longNote: true,
      bpmChange: true,
      random: false,
    });
    const random = createEmptyJSON();
    random.bms.controlFlow = [{ kind: 'directive', command: 'RANDOM', value: '2' }];
    expect(resolveLR2ChartFeatures(random).random).toBe(true);
  });
});

describe('chart ops', () => {
  it('names the difficulty and judge rank ops', () => {
    expect(resolveLR2DifficultyOp(undefined)).toBe(LR2_OP.DIFFICULTY_UNDEFINED);
    expect(resolveLR2DifficultyOp(1)).toBe(LR2_OP.DIFFICULTY_BEGINNER);
    expect(resolveLR2DifficultyOp(5)).toBe(LR2_OP.DIFFICULTY_INSANE);
    expect(resolveLR2DifficultyOp(9)).toBe(LR2_OP.DIFFICULTY_UNDEFINED);
    expect(resolveLR2JudgeRankOp(0)).toBe(LR2_OP.JUDGE_VERY_HARD);
    expect(resolveLR2JudgeRankOp(3)).toBe(LR2_OP.JUDGE_EASY);
    expect(resolveLR2JudgeRankOp(undefined)).toBe(LR2_OP.JUDGE_NORMAL);
  });
});

describe('resolveLR2ChartText', () => {
  it('reads texts 10-18 and their repeats 20-28', () => {
    const chart = makeChart({ title: 'T', subtitle: 'S', artist: 'A', playLevel: 7 });
    expect(resolveLR2ChartText(LR2_TEXT.TITLE, chart)).toBe('T');
    expect(resolveLR2ChartText(LR2_TEXT.TITLE_ALT, chart)).toBe('T');
    expect(resolveLR2ChartText(LR2_TEXT.FULL_TITLE, chart)).toBe('T S');
    expect(resolveLR2ChartText(LR2_TEXT.ARTIST_ALT, chart)).toBe('A');
    expect(resolveLR2ChartText(LR2_TEXT.PLAY_LEVEL, chart)).toBe('7');
    expect(resolveLR2ChartText(LR2_TEXT.DIFFICULTY, chart)).toBe('');
    // LR2 draws the `#DIFFICULTY` number, not its name.
    const hyper = makeChartWith({ difficulty: 3 });
    expect(resolveLR2ChartText(LR2_TEXT.DIFFICULTY, hyper)).toBe('3');
    expect(resolveLR2ChartText(LR2_TEXT.DIFFICULTY_ALT, hyper)).toBe('3');
    // LR2's song database tag, not the file name: be-music keeps no tags.
    expect(resolveLR2ChartText(LR2_TEXT.TAG, chart)).toBe('');
    expect(resolveLR2ChartText(LR2_TEXT.TAG_ALT, chart)).toBe('');
    expect(resolveLR2ChartText(LR2_TEXT.SEARCH_WORD, chart)).toBeUndefined();
  });
});
