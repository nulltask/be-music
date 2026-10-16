import { createEmptyScore, type ScoreSummary } from '@be-music/player/core/scoring';
import { describe, expect, it } from 'vite-plus/test';
import { LR2_NUM, LR2_OP, LR2_SLIDER, LR2_TEXT, LR2_TIMER } from '../ids/index.ts';
import {
  resolveLr2GaugeRangeOp,
  resolveLr2GaugeTypeOps,
  resolveLr2LaneTimer,
  resolveLr2PlayKeyModeOp,
  resolveLr2PlayState,
  resolveLr2PlayTimers,
  resolveLr2RankOp,
  type Lr2PlayFrame,
  type Lr2PlaySetup,
} from './play.ts';
import { makeChartWith } from './test-support.ts';

const SETUP: Lr2PlaySetup = {
  chart: makeChartWith({ difficulty: 3 }, { title: 'T', artist: 'A', bpm: 150, playLevel: 9 }),
  lanes: { playVariant: '7', channels: ['11', '12', '16', '18'] },
  features: { longNote: true, bpmChange: false, bga: true },
  options: {
    autoPlay: false,
    autoScratch1P: true,
    autoScratch2P: false,
    scoreGraph: true,
    bga: 'ON',
    bgaSize: 'EXTEND',
  },
  gauge: 'GROOVE',
};

function score(overrides: Partial<ScoreSummary> = {}): ScoreSummary {
  return { ...createEmptyScore(100), ...overrides };
}

function frame(overrides: Partial<Lr2PlayFrame> = {}): Lr2PlayFrame {
  return {
    play: { gauge: 54, combo: 12, maxCombo: 30, totalSeconds: 120, view: { hiSpeed: { player: 2.5 } } },
    score: score(),
    seconds: 75,
    ...overrides,
  };
}

describe('resolveLr2PlayState ops', () => {
  it('lights the play’s fixed ops from its setup', () => {
    const { ops } = resolveLr2PlayState(SETUP, frame());
    for (const op of [
      LR2_OP.PLAYABLE_BAR,
      LR2_OP.EXTRA_MODE_OFF,
      LR2_OP.SCORE_SAVE_ON,
      LR2_OP.AUTO_SCRATCH_1P_ON,
      LR2_OP.AUTO_SCRATCH_2P_OFF,
      LR2_OP.GAUGE_1P_NORMAL,
      LR2_OP.GAUGE_2P_NORMAL,
      LR2_OP.SCORE_GRAPH_ON,
      LR2_OP.BGA_ON,
      LR2_OP.BGA_EXTEND,
      LR2_OP.AUTOPLAY_OFF,
      LR2_OP.KEYS_7,
      LR2_OP.HAS_LN,
      LR2_OP.NO_BPM_CHANGE,
      LR2_OP.HAS_BGA,
      LR2_OP.NO_STAGEFILE,
      LR2_OP.LOADED,
    ]) {
      expect(ops.has(op)).toBe(true);
    }
  });

  it('reports a course stage’s gauge as the red one and keeps a skin’s own BGA size', () => {
    const { ops } = resolveLr2PlayState({ ...SETUP, courseGauge: true, customOps: [LR2_OP.BGA_NORMAL, 905] }, frame());
    expect(ops.has(LR2_OP.GAUGE_1P_RED)).toBe(true);
    expect(ops.has(LR2_OP.BGA_NORMAL)).toBe(true);
    expect(ops.has(LR2_OP.BGA_EXTEND)).toBe(false);
    expect(ops.has(905)).toBe(true);
  });

  it('lights the frame’s ops: loading, the rank so far and the gauge range', () => {
    const loading = resolveLr2PlayState(SETUP, frame({ loaded: false })).ops;
    expect(loading.has(LR2_OP.LOADING)).toBe(true);
    expect(loading.has(LR2_OP.LOADED)).toBe(false);
    const { ops } = resolveLr2PlayState(SETUP, frame({ score: score({ exScore: 180 }) }));
    expect(ops.has(LR2_OP.RANK_1P_AAA)).toBe(true);
    expect(ops.has(LR2_OP.GAUGE_1P_50_59)).toBe(true);
  });

  it('lights the course ops and moves a NONSTOP play’s stage ops to the stage it shows', () => {
    const course = {
      kind: 'nonstop' as const,
      title: 'Course',
      stages: [{ title: 'one' }, { title: 'two' }, { title: 'three' }],
      stageIndex: 0,
    };
    const first = resolveLr2PlayState({ ...SETUP, course }, frame({ nonstopStage: 0 }));
    expect(first.ops.has(LR2_OP.COURSE_NONSTOP)).toBe(true);
    expect(first.ops.has(LR2_OP.COURSE_STAGE1)).toBe(true);
    expect(first.text(LR2_TEXT.TITLE)).toBe('T');
    const second = resolveLr2PlayState({ ...SETUP, course }, frame({ nonstopStage: 1 }));
    expect(second.ops.has(LR2_OP.COURSE_STAGE1)).toBe(false);
    expect(second.ops.has(LR2_OP.COURSE_STAGE2)).toBe(true);
    expect(second.text(LR2_TEXT.TITLE)).toBe('two');
  });
});

describe('resolveLr2PlayState numbers', () => {
  it('reads the score, combo, gauge, judgement counts, time and BPM', () => {
    const state = resolveLr2PlayState(
      SETUP,
      frame({
        score: score({ perfect: 50, great: 10, poor: 3, exScore: 110, score: 120000 }),
        displayedScore: 119_999.6,
        bpm: 151,
        fps: 59.6,
      }),
    );
    expect(state.number(LR2_NUM.HISPEED_1P)).toBe(250);
    expect(state.number(LR2_NUM.FPS)).toBe(60);
    expect(state.number(LR2_NUM.SCORE)).toBe(120000);
    expect(state.number(LR2_NUM.EXSCORE)).toBe(110);
    expect(state.number(LR2_NUM.COMBO)).toBe(12);
    expect(state.number(LR2_NUM.MAX_COMBO)).toBe(30);
    expect(state.number(LR2_NUM.NOTES)).toBe(100);
    expect(state.number(LR2_NUM.GAUGE)).toBe(54);
    expect(state.number(LR2_NUM.PERFECT)).toBe(50);
    expect(state.number(LR2_NUM.POOR)).toBe(3);
    expect(state.number(LR2_NUM.TOTAL_RATE)).toBe(55);
    expect(state.number(LR2_NUM.PLAY_MINUTE)).toBe(1);
    expect(state.number(LR2_NUM.PLAY_SECOND)).toBe(15);
    expect(state.number(LR2_NUM.REMAINING_SECOND)).toBe(45);
    expect(state.number(LR2_NUM.BPM)).toBe(151);
    expect(resolveLr2PlayState(SETUP, frame()).number(LR2_NUM.BPM)).toBe(150);
    expect(state.number(LR2_NUM.NEXT_RANK_DIFF)).toBe(68);
  });

  it('counts the whole course in the combo numbers of an expert or grade course', () => {
    const course = { kind: 'grade' as const, title: 'Dan', stages: [{ title: 'one', level: 11 }], stageIndex: 0 };
    const play = { ...frame().play, courseCombo: { combo: 412, maxCombo: 500 } };
    const grade = resolveLr2PlayState({ ...SETUP, course }, frame({ play }));
    expect(grade.number(LR2_NUM.COMBO)).toBe(412);
    expect(grade.number(LR2_NUM.MAX_COMBO)).toBe(500);
    expect(grade.number(LR2_NUM.COURSE_STAGE1_LEVEL)).toBe(11);
    const nonstop = resolveLr2PlayState({ ...SETUP, course: { ...course, kind: 'nonstop' } }, frame({ play }));
    expect(nonstop.number(LR2_NUM.COMBO)).toBe(12);
  });
});

describe('resolveLr2PlayState texts, sliders and bar graphs', () => {
  it('draws the chart’s texts but not its file name or INSANE level', () => {
    const state = resolveLr2PlayState(SETUP, frame());
    expect(state.text(LR2_TEXT.TITLE)).toBe('T');
    expect(state.text(LR2_TEXT.ARTIST)).toBe('A');
    expect(state.text(LR2_TEXT.DIFFICULTY)).toBe('HYPER');
    expect(state.text(LR2_TEXT.RIVAL)).toBe('TARGET');
    expect(state.text(LR2_TEXT.FULL_ARTIST)).toBeUndefined();
    expect(resolveLr2PlayState({ ...SETUP, chart: undefined }, frame()).text(LR2_TEXT.TITLE)).toBeUndefined();
  });

  it('places the hi-speed and progress sliders and fills the bar graphs', () => {
    const state = resolveLr2PlayState(SETUP, frame({ score: score({ exScore: 50 }) }));
    expect(state.slider(LR2_SLIDER.HISPEED_1P)).toBeCloseTo((2.5 - 0.1) / 5.9);
    expect(state.slider(LR2_SLIDER.PLAY_PROGRESS)).toBe(0.625);
    expect(state.slider(LR2_SLIDER.LANE_COVER_1P)).toBe(0);
    expect(state.bargraph(1)).toBe(0.625);
    expect(state.bargraph(2)).toBe(1);
    expect(state.bargraph(10)).toBe(0.25);
    expect(state.bargraph(99)).toBe(0);
  });
});

describe('play ops', () => {
  it('lights the key mode of the lanes in use', () => {
    expect(resolveLr2PlayKeyModeOp({ playVariant: '9', channels: ['11'] })).toBe(LR2_OP.KEYS_9);
    expect(resolveLr2PlayKeyModeOp({ playVariant: '5', channels: ['11', '15'] })).toBe(LR2_OP.KEYS_5);
    expect(resolveLr2PlayKeyModeOp({ playVariant: '10', channels: ['11', '21'] })).toBe(LR2_OP.KEYS_10);
    expect(resolveLr2PlayKeyModeOp({ playVariant: '14', channels: ['11', '29'] })).toBe(LR2_OP.KEYS_14);
  });

  it('lights the red gauge ops for HARD and DEATH, the normal ones for GROOVE and EASY', () => {
    expect(resolveLr2GaugeTypeOps('HARD')).toEqual([43, 45]);
    expect(resolveLr2GaugeTypeOps('DEATH')).toEqual([43, 45]);
    expect(resolveLr2GaugeTypeOps('GROOVE')).toEqual([42, 44]);
    expect(resolveLr2GaugeTypeOps('EASY')).toEqual([42, 44]);
  });

  it('maps each 10 % band of the gauge to 230-240', () => {
    expect(resolveLr2GaugeRangeOp(0)).toBe(230);
    expect(resolveLr2GaugeRangeOp(9.9)).toBe(230);
    expect(resolveLr2GaugeRangeOp(10)).toBe(231);
    expect(resolveLr2GaugeRangeOp(79.9)).toBe(237);
    expect(resolveLr2GaugeRangeOp(99.9)).toBe(239);
    expect(resolveLr2GaugeRangeOp(100)).toBe(240);
    expect(resolveLr2GaugeRangeOp(-5)).toBe(230);
    expect(resolveLr2GaugeRangeOp(150)).toBe(240);
  });

  it('lights the rank op of the EX score over the chart’s notes', () => {
    expect(resolveLr2RankOp({ total: 0, exScore: 0 })).toBeUndefined();
    expect(resolveLr2RankOp({ total: 100, exScore: 200 })).toBe(LR2_OP.RANK_1P_AAA);
    expect(resolveLr2RankOp({ total: 100, exScore: 0 })).toBe(LR2_OP.RANK_1P_F);
  });
});

describe('resolveLr2LaneTimer', () => {
  it('adds the lane to its side’s bank', () => {
    expect(resolveLr2LaneTimer('bomb', { channel: '13', laneIndex: 3, playVariant: '7' })).toBe(53);
    expect(resolveLr2LaneTimer('bomb', { channel: '26', laneIndex: 0, playVariant: '14' })).toBe(60);
    expect(resolveLr2LaneTimer('ln-hold', { channel: '21', laneIndex: 1, playVariant: '14' })).toBe(81);
    expect(resolveLr2LaneTimer('key-on', { channel: '17', laneIndex: 7, playVariant: '7' })).toBe(107);
    expect(resolveLr2LaneTimer('key-off', { channel: '27', laneIndex: 7, playVariant: '14' })).toBe(137);
  });

  it('runs every 9 KEYS lane through the 1P bank', () => {
    expect(resolveLr2LaneTimer('key-on', { channel: '22', laneIndex: 9, playVariant: '9' })).toBe(109);
    expect(resolveLr2LaneTimer('bomb', { channel: '25', laneIndex: 8, playVariant: '9' })).toBe(58);
  });

  it('gives a lane past the bank no timer', () => {
    expect(resolveLr2LaneTimer('bomb', { channel: '1A', laneIndex: 10, playVariant: '24' })).toBeUndefined();
    expect(resolveLr2LaneTimer('key-on', { channel: '1A', laneIndex: 8, playVariant: '24' })).toBeUndefined();
    expect(resolveLr2LaneTimer('bomb', { channel: 'xx', laneIndex: -1, playVariant: '7' })).toBeUndefined();
  });
});

describe('resolveLr2PlayTimers', () => {
  it('starts the scene-stage and judgement timers', () => {
    expect(resolveLr2PlayTimers({ kind: 'scene-start', at: 1 }).start.get(LR2_TIMER.SCENE_START)).toBe(1);
    expect(resolveLr2PlayTimers({ kind: 'load-end', at: 2 }).start.get(LR2_TIMER.READY)).toBe(2);
    expect(resolveLr2PlayTimers({ kind: 'play-start', at: 3 }).start.get(LR2_TIMER.PLAY)).toBe(3);
    expect(resolveLr2PlayTimers({ kind: 'exit-close', at: 4 }).start.get(LR2_TIMER.FAILED)).toBe(4);
    expect(resolveLr2PlayTimers({ kind: 'judge', side: '2P', at: 5 }).start.get(LR2_TIMER.JUDGE_2P)).toBe(5);
    expect([...resolveLr2PlayTimers({ kind: 'full-combo', at: 6 }).start.keys()]).toEqual([48, 49]);
  });

  it('starts the gauge-up timer on a rise and runs the gauge-max timer while the gauge is full', () => {
    expect(resolveLr2PlayTimers({ kind: 'gauge', previous: 98, next: 100, at: 7 })).toEqual({
      start: new Map([
        [LR2_TIMER.GAUGE_UP_1P, 7],
        [LR2_TIMER.GAUGE_MAX_1P, 7],
      ]),
      stop: [],
    });
    expect(resolveLr2PlayTimers({ kind: 'gauge', previous: 100, next: 94, at: 8 })).toEqual({
      start: new Map(),
      stop: [LR2_TIMER.GAUGE_MAX_1P],
    });
  });

  it('starts a lane’s bank timer', () => {
    const lane = { channel: '12', laneIndex: 2, playVariant: '7' as const };
    expect(resolveLr2PlayTimers({ kind: 'lane', bank: 'bomb', lane, at: 9 }).start.get(52)).toBe(9);
    expect(
      resolveLr2PlayTimers({ kind: 'lane', bank: 'bomb', lane: { ...lane, laneIndex: 12 }, at: 9 }).start.size,
    ).toBe(0);
  });
});
