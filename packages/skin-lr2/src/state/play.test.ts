import { createEmptyScore, type ScoreSummary } from '@be-music/player-engine/ruleset';
import { describe, expect, it } from 'vite-plus/test';
import { LR2_NUM, LR2_OP, LR2_SLIDER, LR2_TEXT, LR2_TIMER } from '../ids/index.ts';
import {
  isLR2AutoLane,
  resolveLR2GaugeRangeOp,
  resolveLR2GaugeTypeOps,
  resolveLR2LaneTimer,
  resolveLR2PlayKeyModeOp,
  resolveLR2PlayState,
  resolveLR2PlayTimers,
  resolveLR2RankOp,
  type LR2PlayFrame,
  type LR2PlaySetup,
} from './play.ts';
import { makeChartWith } from './test-support.ts';

const SETUP: LR2PlaySetup = {
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

function frame(overrides: Partial<LR2PlayFrame> = {}): LR2PlayFrame {
  return {
    play: { gauge: 54, combo: 12, maxCombo: 30, totalSeconds: 120, view: { hiSpeed: { player: 2.5 } } },
    score: score(),
    seconds: 75,
    ...overrides,
  };
}

describe('resolveLR2PlayState ops', () => {
  it('lights per-side judgment gates used by LITONE4 lasers, including the initial miss state', () => {
    const initial = resolveLR2PlayState(SETUP, frame()).ops;
    expect(initial.has(LR2_OP.JUDGE_1P_MISS)).toBe(true);
    const judged = resolveLR2PlayState(SETUP, frame({ judgments: { '1P': 'PERFECT', '2P': 'BAD' } })).ops;
    expect(judged.has(LR2_OP.JUDGE_1P_PERFECT)).toBe(true);
    expect(judged.has(LR2_OP.JUDGE_2P_BAD)).toBe(true);
    expect(judged.has(LR2_OP.JUDGE_1P_MISS)).toBe(false);
    expect(judged.has(LR2_OP.JUDGE_2P_PERFECT)).toBe(false);
  });

  it('lights the play’s fixed ops from its setup', () => {
    const { ops } = resolveLR2PlayState(SETUP, frame());
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
    const { ops } = resolveLR2PlayState({ ...SETUP, courseGauge: true, customOps: [LR2_OP.BGA_NORMAL, 905] }, frame());
    expect(ops.has(LR2_OP.GAUGE_1P_RED)).toBe(true);
    expect(ops.has(LR2_OP.BGA_NORMAL)).toBe(true);
    expect(ops.has(LR2_OP.BGA_EXTEND)).toBe(false);
    expect(ops.has(905)).toBe(true);
  });

  it('lights the frame’s ops: loading, the rank so far and the gauge range', () => {
    const loading = resolveLR2PlayState(SETUP, frame({ loaded: false })).ops;
    expect(loading.has(LR2_OP.LOADING)).toBe(true);
    expect(loading.has(LR2_OP.LOADED)).toBe(false);
    const { ops } = resolveLR2PlayState(SETUP, frame({ score: score({ perfect: 90, exScore: 180 }) }));
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
    const first = resolveLR2PlayState({ ...SETUP, course }, frame({ nonstopStage: 0 }));
    expect(first.ops.has(LR2_OP.COURSE_NONSTOP)).toBe(true);
    expect(first.ops.has(LR2_OP.COURSE_STAGE1)).toBe(true);
    expect(first.text(LR2_TEXT.TITLE)).toBe('T');
    const second = resolveLR2PlayState({ ...SETUP, course }, frame({ nonstopStage: 1 }));
    expect(second.ops.has(LR2_OP.COURSE_STAGE1)).toBe(false);
    expect(second.ops.has(LR2_OP.COURSE_STAGE2)).toBe(true);
    expect(second.text(LR2_TEXT.TITLE)).toBe('two');
  });
});

describe('resolveLR2PlayState numbers', () => {
  it('reads the score, combo, gauge, judgement counts, time and BPM', () => {
    const state = resolveLR2PlayState(
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
    // 102 is the score rate, not the frame rate: 110 of the 126 points of the 63 notes judged, 87.30 %.
    expect(state.number(LR2_NUM.SCORE_RATE)).toBe(87);
    expect(state.number(LR2_NUM.SCORE_RATE_AFTERDOT)).toBe(30);
    expect(state.number(LR2_NUM.PLAY_MINUTE)).toBe(1);
    expect(state.number(LR2_NUM.PLAY_SECOND)).toBe(15);
    expect(state.number(LR2_NUM.REMAINING_SECOND)).toBe(45);
    expect(state.number(LR2_NUM.BPM)).toBe(151);
    expect(resolveLR2PlayState(SETUP, frame()).number(LR2_NUM.BPM)).toBe(150);
    // 110 of 200 points is rank 4 (C): B's border is floor(200 × 5 / 9) = 111, one point away.
    expect(state.number(LR2_NUM.NEXT_RANK_DIFF)).toBe(-1);
    expect(state.number(LR2_NUM.NEXT_RANK_DIFF_ALT)).toBe(-1);
  });

  it('reads LR2’s distance to the next rank on 109 / 154: negative, toward the maximum from AAA', () => {
    const diff = (exScore: number, total = 100): number | undefined =>
      resolveLR2PlayState(SETUP, frame({ score: { ...createEmptyScore(total), exScore } })).number(
        LR2_NUM.NEXT_RANK_DIFF,
      );
    // F counts down to E's border (floor(200 × 2 / 9) = 44), from no score as well.
    expect(diff(0)).toBe(-44);
    expect(diff(30)).toBe(-14);
    // AA counts down to AAA's border (floor(200 × 8 / 9) = 177), and AAA to the maximum.
    expect(diff(156)).toBe(-21);
    expect(diff(178)).toBe(-22);
    expect(diff(199)).toBe(-1);
    // 0 at the maximum and on a chart without notes.
    expect(diff(200)).toBe(0);
    expect(diff(0, 0)).toBe(0);
  });

  it('counts the whole course in the combo numbers of an expert or grade course', () => {
    const course = { kind: 'grade' as const, title: 'Dan', stages: [{ title: 'one', level: 11 }], stageIndex: 0 };
    const play = { ...frame().play, courseCombo: { combo: 412, maxCombo: 500 } };
    const grade = resolveLR2PlayState({ ...SETUP, course }, frame({ play }));
    expect(grade.number(LR2_NUM.COMBO)).toBe(412);
    expect(grade.number(LR2_NUM.MAX_COMBO)).toBe(500);
    expect(grade.number(LR2_NUM.COURSE_STAGE1_LEVEL)).toBe(11);
    const nonstop = resolveLR2PlayState({ ...SETUP, course: { ...course, kind: 'nonstop' } }, frame({ play }));
    expect(nonstop.number(LR2_NUM.COMBO)).toBe(12);
  });
});

describe('resolveLR2PlayState texts, sliders and bar graphs', () => {
  it('draws the chart’s texts, an empty tag and the INSANE level', () => {
    const state = resolveLR2PlayState(SETUP, frame());
    expect(state.text(LR2_TEXT.TITLE)).toBe('T');
    expect(state.text(LR2_TEXT.ARTIST)).toBe('A');
    expect(state.text(LR2_TEXT.DIFFICULTY)).toBe('3');
    expect(state.text(LR2_TEXT.RIVAL)).toBe('TARGET');
    expect(state.text(LR2_TEXT.TAG)).toBe('');
    expect(state.text(LR2_TEXT.INSANE_LEVEL)).toBe('');
    const insane = { ...SETUP, chart: makeChartWith({ difficulty: 5 }, { playLevel: 12 }) };
    expect(resolveLR2PlayState(insane, frame()).text(LR2_TEXT.INSANE_LEVEL)).toBe('12');
    expect(resolveLR2PlayState({ ...SETUP, chart: undefined }, frame()).text(LR2_TEXT.TITLE)).toBeUndefined();
  });

  it('places the hi-speed and progress sliders and fills the bar graphs', () => {
    const state = resolveLR2PlayState(SETUP, frame({ score: score({ exScore: 50 }) }));
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
    expect(resolveLR2PlayKeyModeOp({ playVariant: '9', channels: ['11'] })).toBe(LR2_OP.KEYS_9);
    expect(resolveLR2PlayKeyModeOp({ playVariant: '5', channels: ['11', '15'] })).toBe(LR2_OP.KEYS_5);
    expect(resolveLR2PlayKeyModeOp({ playVariant: '10', channels: ['11', '21'] })).toBe(LR2_OP.KEYS_10);
    expect(resolveLR2PlayKeyModeOp({ playVariant: '14', channels: ['11', '29'] })).toBe(LR2_OP.KEYS_14);
  });

  it('lights the red gauge ops for HARD and DEATH, the normal ones for GROOVE and EASY', () => {
    expect(resolveLR2GaugeTypeOps('HARD')).toEqual([43, 45]);
    expect(resolveLR2GaugeTypeOps('DEATH')).toEqual([43, 45]);
    expect(resolveLR2GaugeTypeOps('GROOVE')).toEqual([42, 44]);
    expect(resolveLR2GaugeTypeOps('EASY')).toEqual([42, 44]);
  });

  it('maps each 10 % band of the gauge to 230-240', () => {
    expect(resolveLR2GaugeRangeOp(0)).toBe(230);
    expect(resolveLR2GaugeRangeOp(9.9)).toBe(230);
    expect(resolveLR2GaugeRangeOp(10)).toBe(231);
    expect(resolveLR2GaugeRangeOp(79.9)).toBe(237);
    expect(resolveLR2GaugeRangeOp(99.9)).toBe(239);
    expect(resolveLR2GaugeRangeOp(100)).toBe(240);
    expect(resolveLR2GaugeRangeOp(-5)).toBe(230);
    expect(resolveLR2GaugeRangeOp(150)).toBe(240);
  });

  it('lights the rank op of the EX score over the notes judged so far, as LR2 does', () => {
    // Nothing is lit before the first note is judged, whatever the chart's notes.
    expect(resolveLR2RankOp(score())).toBeUndefined();
    // 10 notes judged of the chart's 100, all PGREAT: AAA, not the F the EX score over every note would give.
    expect(resolveLR2RankOp(score({ perfect: 10, exScore: 20 }))).toBe(LR2_OP.RANK_1P_AAA);
    // 16 of 18 points is exactly 8/9: AAA; 15 of 18 is AA.
    expect(resolveLR2RankOp(score({ perfect: 7, great: 2, exScore: 16 }))).toBe(LR2_OP.RANK_1P_AAA);
    expect(resolveLR2RankOp(score({ perfect: 6, great: 3, exScore: 15 }))).toBe(LR2_OP.RANK_1P_AA);
    // POORs are notes judged; an empty POOR is not.
    expect(resolveLR2RankOp(score({ perfect: 1, poor: 9, emptyPoor: 50, exScore: 2 }))).toBe(LR2_OP.RANK_1P_F);
    expect(resolveLR2RankOp(score({ perfect: 1, emptyPoor: 50, exScore: 2 }))).toBe(LR2_OP.RANK_1P_AAA);
  });
});

describe('isLR2AutoLane', () => {
  it('draws the 1P scratch as an auto lane while 1P auto scratch is on', () => {
    const autoScratch = new Set([LR2_OP.AUTO_SCRATCH_1P_ON]);
    expect(isLR2AutoLane(0, autoScratch)).toBe(true);
    expect(isLR2AutoLane(1, autoScratch)).toBe(false);
    expect(isLR2AutoLane(0, new Set([LR2_OP.AUTO_SCRATCH_1P_OFF]))).toBe(false);
  });

  it('takes no lane for an auto lane under EXTRA MODE (op 53) or full AUTOPLAY (op 33)', () => {
    const ops = new Set([LR2_OP.EXTRA_MODE_ON, LR2_OP.AUTOPLAY_ON, LR2_OP.AUTO_SCRATCH_1P_OFF]);
    for (const lane of [0, 1, 7]) expect(isLR2AutoLane(lane, ops)).toBe(false);
  });
});

describe('resolveLR2LaneTimer', () => {
  it('adds the lane to its side’s bank', () => {
    expect(resolveLR2LaneTimer('bomb', { channel: '13', laneIndex: 3, playVariant: '7' })).toBe(53);
    expect(resolveLR2LaneTimer('bomb', { channel: '26', laneIndex: 0, playVariant: '14' })).toBe(60);
    expect(resolveLR2LaneTimer('ln-hold', { channel: '21', laneIndex: 1, playVariant: '14' })).toBe(81);
    expect(resolveLR2LaneTimer('key-on', { channel: '17', laneIndex: 7, playVariant: '7' })).toBe(107);
    expect(resolveLR2LaneTimer('key-off', { channel: '27', laneIndex: 7, playVariant: '14' })).toBe(137);
  });

  it('runs every 9 KEYS lane through the 1P bank', () => {
    expect(resolveLR2LaneTimer('key-on', { channel: '22', laneIndex: 9, playVariant: '9' })).toBe(109);
    expect(resolveLR2LaneTimer('bomb', { channel: '25', laneIndex: 8, playVariant: '9' })).toBe(58);
  });

  it('gives a lane past the bank no timer', () => {
    expect(resolveLR2LaneTimer('bomb', { channel: '1A', laneIndex: 10, playVariant: '24' })).toBeUndefined();
    expect(resolveLR2LaneTimer('key-on', { channel: '1A', laneIndex: 8, playVariant: '24' })).toBeUndefined();
    expect(resolveLR2LaneTimer('bomb', { channel: 'xx', laneIndex: -1, playVariant: '7' })).toBeUndefined();
  });
});

describe('resolveLR2PlayTimers', () => {
  it('starts the scene-stage and judgement timers', () => {
    expect(resolveLR2PlayTimers({ kind: 'scene-start', at: 1 }).start.get(LR2_TIMER.SCENE_START)).toBe(1);
    expect(resolveLR2PlayTimers({ kind: 'load-end', at: 2 }).start.get(LR2_TIMER.READY)).toBe(2);
    expect(resolveLR2PlayTimers({ kind: 'play-start', at: 3 }).start.get(LR2_TIMER.PLAY)).toBe(3);
    expect(resolveLR2PlayTimers({ kind: 'exit-close', at: 4 }).start.get(LR2_TIMER.FAILED)).toBe(4);
    expect(resolveLR2PlayTimers({ kind: 'judge', side: '2P', at: 5 }).start.get(LR2_TIMER.JUDGE_2P)).toBe(5);
    expect([...resolveLR2PlayTimers({ kind: 'full-combo', at: 6 }).start.keys()]).toEqual([48, 49]);
  });

  it('starts the gauge-up timer on a rise and runs the gauge-max timer while the gauge is full', () => {
    expect(resolveLR2PlayTimers({ kind: 'gauge', previous: 98, next: 100, at: 7 })).toEqual({
      start: new Map([
        [LR2_TIMER.GAUGE_UP_1P, 7],
        [LR2_TIMER.GAUGE_MAX_1P, 7],
      ]),
      stop: [],
    });
    expect(resolveLR2PlayTimers({ kind: 'gauge', previous: 100, next: 94, at: 8 })).toEqual({
      start: new Map(),
      stop: [LR2_TIMER.GAUGE_MAX_1P],
    });
  });

  it('stops what the judgments and lanes started on a seek, and keeps the scene timers', () => {
    const update = resolveLR2PlayTimers({ kind: 'seek', gauge: 80, at: 10 });
    expect(update.start.size).toBe(0);
    for (const timer of [42, 44, 46, 47, 48, 49, 50, 59, 69, 70, 89, 100, 119, 120, 139]) {
      expect(update.stop).toContain(timer);
    }
    for (const timer of [0, 1, 2, 3, 40, 41, 140]) expect(update.stop).not.toContain(timer);
    // A full gauge runs its timer again from the seek.
    expect(resolveLR2PlayTimers({ kind: 'seek', gauge: 100, at: 11 }).start.get(LR2_TIMER.GAUGE_MAX_1P)).toBe(11);
  });

  it('starts a lane’s bank timer', () => {
    const lane = { channel: '12', laneIndex: 2, playVariant: '7' as const };
    expect(resolveLR2PlayTimers({ kind: 'lane', bank: 'bomb', lane, at: 9 }).start.get(52)).toBe(9);
    expect(
      resolveLR2PlayTimers({ kind: 'lane', bank: 'bomb', lane: { ...lane, laneIndex: 12 }, at: 9 }).start.size,
    ).toBe(0);
  });
});
