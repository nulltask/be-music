import { describe, expect, it } from 'vite-plus/test';
import { LR2_NUM, LR2_OP, LR2_TEXT } from '../ids/index.ts';
import { resolveLr2DecideState } from './decide.ts';
import { makeChartWith } from './test-support.ts';

describe('resolveLr2DecideState', () => {
  it('lights the base ops and the chart’s difficulty and key-mode ops', () => {
    const { ops } = resolveLr2DecideState({ chart: makeChartWith({ channels: ['11', '18'], difficulty: 4 }) });
    expect([...ops].sort((a, b) => a - b)).toEqual([
      LR2_OP.OFFLINE,
      LR2_OP.LOADED,
      LR2_OP.DIFFICULTY_ANOTHER,
      LR2_OP.KEYS_7,
    ]);
    expect(resolveLr2DecideState({ chart: makeChartWith({}) }).ops.has(LR2_OP.DIFFICULTY_UNDEFINED)).toBe(true);
  });

  it('draws the chart’s texts, without the INSANE level', () => {
    const state = resolveLr2DecideState({
      chart: makeChartWith({ difficulty: 5 }, { title: 'T', artist: 'A', playLevel: 12 }),
    });
    expect(state.text(LR2_TEXT.TITLE)).toBe('T');
    expect(state.text(LR2_TEXT.ARTIST_ALT)).toBe('A');
    expect(state.text(LR2_TEXT.DIFFICULTY)).toBe('5');
    expect(state.text(LR2_TEXT.INSANE_LEVEL)).toBeUndefined();
    expect(state.text(LR2_TEXT.TAG_ALT)).toBe('');
    expect(state.number(LR2_NUM.TOTAL_NOTES)).toBeUndefined();
    expect(state.slider(1)).toBeUndefined();
  });

  it('lights a course stage’s course ops and draws its course texts and numbers', () => {
    const state = resolveLr2DecideState({
      chart: makeChartWith({}),
      course: {
        kind: 'expert',
        title: 'Course',
        stages: [{ title: 'one', level: 9 }, { title: 'two' }],
        stageIndex: 0,
      },
      customOps: [920],
    });
    for (const op of [LR2_OP.COURSE, LR2_OP.COURSE_EXPERT, LR2_OP.COURSE_STAGE1, 920]) {
      expect(state.ops.has(op)).toBe(true);
    }
    expect(state.text(LR2_TEXT.COURSE_TITLE)).toBe('Course');
    expect(state.number(LR2_NUM.COURSE_STAGE1_LEVEL)).toBe(9);
  });
});
