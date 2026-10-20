import { describe, expect, it } from 'vite-plus/test';
import { LR2_NUM, LR2_OP, LR2_TEXT, LR2_TIMER } from '../ids/index.ts';
import { resolveLR2DecideState, resolveLR2DecideTimers } from './decide.ts';
import { makeChartWith } from './test-support.ts';

describe('resolveLR2DecideState', () => {
  it('lights the base ops and the chart’s difficulty and key-mode ops', () => {
    const { ops } = resolveLR2DecideState({ chart: makeChartWith({ channels: ['11', '18'], difficulty: 4 }) });
    expect([...ops].sort((a, b) => a - b)).toEqual([
      LR2_OP.OFFLINE,
      LR2_OP.LOADED,
      LR2_OP.DIFFICULTY_ANOTHER,
      LR2_OP.KEYS_7,
    ]);
    expect(resolveLR2DecideState({ chart: makeChartWith({}) }).ops.has(LR2_OP.DIFFICULTY_UNDEFINED)).toBe(true);
  });

  it('draws the chart’s texts, the INSANE level among them', () => {
    const state = resolveLR2DecideState({
      chart: makeChartWith({ difficulty: 5 }, { title: 'T', artist: 'A', playLevel: 12 }),
    });
    expect(state.text(LR2_TEXT.TITLE)).toBe('T');
    expect(state.text(LR2_TEXT.ARTIST_ALT)).toBe('A');
    expect(state.text(LR2_TEXT.DIFFICULTY)).toBe('5');
    // LR2 sets texts 10-29 on the select screen and keeps them through decide, play and result.
    expect(state.text(LR2_TEXT.INSANE_LEVEL)).toBe('12');
    expect(state.text(LR2_TEXT.TAG_ALT)).toBe('');
    expect(state.number(LR2_NUM.TOTAL_NOTES)).toBeUndefined();
    expect(state.slider(1)).toBeUndefined();
  });

  it('lights a course stage’s course ops and draws its course texts and numbers', () => {
    const state = resolveLR2DecideState({
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

describe('resolveLR2DecideTimers', () => {
  it('runs timer 0 from the entry, and timer 1 once input has opened', () => {
    const frame = (nowMs: number) => ({ clock: { nowMs, enteredAtMs: 1000 }, inputOpenAtMs: 1300 });
    expect([...resolveLR2DecideTimers(frame(1200))]).toEqual([[LR2_TIMER.SCENE_START, 1000]]);
    expect([...resolveLR2DecideTimers(frame(1300))]).toEqual([
      [LR2_TIMER.SCENE_START, 1000],
      [LR2_TIMER.START_INPUT, 1300],
    ]);
  });

  it('runs timer 2 from when the screen started leaving', () => {
    const leaving = { to: 'play' as const, atMs: 1400 };
    expect(
      resolveLR2DecideTimers({ clock: { nowMs: 1450, enteredAtMs: 1000 }, inputOpenAtMs: 1300, leaving }).get(
        LR2_TIMER.FADE_OUT,
      ),
    ).toBe(1400);
  });
});
