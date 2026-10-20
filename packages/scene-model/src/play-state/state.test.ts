import { describe, expect, test } from 'vite-plus/test';
import { createHiSpeedState } from './hi-speed.ts';
import {
  createPlayState,
  playEventFromUICommand,
  playProgress,
  recentJudgeTimings,
  reducePlayState,
  type PlayEvent,
  type PlayState,
} from './state.ts';

const frame = (exScore: number, current: number, extra: { cleared?: boolean; total?: number } = {}): PlayEvent => ({
  type: 'frame',
  frame: {
    totalSeconds: extra.total ?? 100,
    summary: { exScore, gauge: { current, max: 100, cleared: extra.cleared ?? false, type: 'GROOVE' } },
  },
});
const judge = (name: string, combo: number, seconds: number, deltaMs?: number, channel?: string): PlayEvent => ({
  type: 'judge',
  judge: { judge: name, combo, ...(deltaMs !== undefined ? { deltaMs } : {}), ...(channel ? { channel } : {}) },
  seconds,
  atMs: seconds * 1000,
});
const run = (state: PlayState, ...events: PlayEvent[]): PlayState => events.reduce(reducePlayState, state);

describe('graphs', () => {
  test('start at the gauge the play starts with and sample the gauge and EX score at each judgment', () => {
    const state = run(
      createPlayState({ gauge: 20, totalSeconds: 100 }),
      frame(2, 22),
      judge('PERFECT', 1, 25),
      frame(3, 23),
      judge('GREAT', 2, 50),
    );
    expect(state.gaugeHistory).toEqual([
      { progress: 0, value: 20 },
      { progress: 0.25, value: 22 },
      { progress: 0.5, value: 23 },
    ]);
    expect(state.scoreHistory).toEqual([
      { progress: 0, exScore: 0 },
      { progress: 0.25, exScore: 2 },
      { progress: 0.5, exScore: 3 },
    ]);
  });

  test('start at the first frame when the starting gauge was not given', () => {
    const state = run(createPlayState(), frame(0, 100));
    expect(state.gaugeHistory).toEqual([{ progress: 0, value: 100 }]);
    expect(state.scoreHistory).toEqual([{ progress: 0, exScore: 0 }]);
    expect(state.totalSeconds).toBe(100);
  });

  test('sample an empty POOR, which moves the gauge without a judgment of a note', () => {
    const state = run(createPlayState({ gauge: 20, totalSeconds: 100 }), frame(0, 18), {
      type: 'empty-poor',
      seconds: 40,
    });
    expect(state.gaugeHistory.at(-1)).toEqual({ progress: 0.4, value: 18 });
    expect(playEventFromUICommand({ kind: 'trigger-poor-bga', seconds: 40 })).toEqual({
      type: 'empty-poor',
      seconds: 40,
    });
    expect(playEventFromUICommand({ kind: 'clear-poor-bga' })).toBeUndefined();
  });

  test('read the gauge in percent of its maximum', () => {
    const state = run(createPlayState(), {
      type: 'frame',
      frame: { totalSeconds: 10, summary: { exScore: 0, gauge: { current: 5, max: 10, cleared: true } } },
    });
    expect(state.gauge).toBe(50);
    expect(state.cleared).toBe(true);
  });

  test('take the chart-time fraction over the chart, clamped, and 0 before its length is known', () => {
    expect(playProgress({ totalSeconds: 200 }, 50)).toBe(0.25);
    expect(playProgress({ totalSeconds: 200 }, 500)).toBe(1);
    expect(playProgress({ totalSeconds: 0 }, 50)).toBe(0);
  });
});

describe('combo', () => {
  test('follows the published combo and keeps the longest', () => {
    const state = run(
      createPlayState(),
      judge('PERFECT', 1, 1),
      judge('GREAT', 2, 2),
      judge('POOR', 0, 3),
      judge('PERFECT', 1, 4),
    );
    expect(state.combo).toBe(1);
    expect(state.maxCombo).toBe(2);
  });

  test('ignores the engine READY reset', () => {
    const state = run(createPlayState(), judge('PERFECT', 3, 1));
    expect(reducePlayState(state, judge('READY', 0, 2))).toBe(state);
  });

  test('reads a full combo as every note once the play is over, even when combos went unpublished', () => {
    const state = run(createPlayState(), judge('PERFECT', 3, 1), {
      type: 'finish',
      summary: { total: 5, perfect: 4, great: 1, good: 0, bad: 0, poor: 0 },
    });
    expect(state.maxCombo).toBe(5);
    const broken = run(createPlayState(), judge('PERFECT', 3, 1), {
      type: 'finish',
      summary: { total: 5, perfect: 4, great: 0, good: 0, bad: 0, poor: 1 },
    });
    expect(broken.maxCombo).toBe(3);
  });

  test('runs the course combo on from the stage carried in', () => {
    const state = run(
      createPlayState({ courseCarryIn: { combo: 40, maxCombo: 55 } }),
      judge('PERFECT', 1, 1),
      judge('PERFECT', 2, 2),
      judge('BAD', 0, 3),
      judge('PERFECT', 1, 4),
    );
    expect(state.courseCombo).toEqual({ combo: 1, maxCombo: 55, stageCombo: 1 });
    expect(createPlayState().courseCombo).toBeUndefined();
  });
});

describe('judge timings', () => {
  test('record the timed judgments with their channel, and count each judgment early and late', () => {
    const state = run(
      createPlayState(),
      judge('PERFECT', 1, 1, -4, '11'),
      judge('GREAT', 2, 2, 15),
      judge('GREAT', 3, 3, -20),
      judge('PERFECT', 4, 4, 0),
    );
    expect(state.judgeTimings).toEqual([
      { atMs: 1000, deltaMs: -4, judge: 'PERFECT', channel: '11' },
      { atMs: 2000, deltaMs: 15, judge: 'GREAT' },
      { atMs: 3000, deltaMs: -20, judge: 'GREAT' },
      { atMs: 4000, deltaMs: 0, judge: 'PERFECT' },
    ]);
    expect(state.earlyLate.PERFECT).toEqual({ early: 1, late: 0 });
    expect(state.earlyLate.GREAT).toEqual({ early: 1, late: 1 });
    expect(state.lastJudgeDeltaMs).toBe(0);
  });

  test('skip judgments without a finite timing or a known grade', () => {
    const state = run(
      createPlayState(),
      judge('PERFECT', 1, 1),
      judge('POOR', 0, 2, Number.NaN),
      judge('MISS', 0, 3, 5),
    );
    expect(state.judgeTimings).toEqual([]);
    expect(state.lastJudgeDeltaMs).toBeUndefined();
  });

  test('keep the latest ones for a live meter, the same array until a judgment arrives', () => {
    let state = createPlayState();
    for (let index = 0; index < 70; index += 1) state = reducePlayState(state, judge('GOOD', index, index, index));
    const recent = recentJudgeTimings(state);
    expect(recent).toHaveLength(64);
    expect(recent[0]!.deltaMs).toBe(6);
    expect(recentJudgeTimings(state)).toBe(recent);
    expect(recentJudgeTimings(state, 3).map((timing) => timing.deltaMs)).toEqual([67, 68, 69]);
  });
});

describe('reducePlayState', () => {
  test('returns the same state for a frame that changes nothing', () => {
    const state = run(createPlayState({ gauge: 20, totalSeconds: 100 }), frame(4, 30));
    expect(reducePlayState(state, frame(4, 30))).toBe(state);
  });

  test('never changes the state it is given', () => {
    const state = createPlayState({ gauge: 20, totalSeconds: 100 });
    const before = JSON.stringify(state);
    run(state, frame(4, 30), judge('PERFECT', 1, 10, 3), { type: 'empty-poor', seconds: 20 });
    expect(JSON.stringify(state)).toBe(before);
  });

  test('routes hi-speed and lane cover commands to the view', () => {
    const state = createPlayState({
      view: {
        hiSpeed: createHiSpeedState({ hiSpeed: 2 }),
        covers: [{ side: '1P', sudden: 0.25, suddenOn: false, hidden: 0.25, hiddenOn: false, lift: 0 }],
      },
    });
    const faster = reducePlayState(state, { type: 'hi-speed-step', delta: 0.5 });
    expect(faster.view.hiSpeed.drawn).toBe(2.5);
    const covered = reducePlayState(faster, { type: 'cover-adjust', part: 'sudden', delta: 0.05 });
    expect(covered.view.covers[0]).toMatchObject({ sudden: 0.3, suddenOn: true });
    expect(reducePlayState(covered, { type: 'cover-adjust', part: 'lift', delta: Number.NaN })).toBe(covered);
  });

  test('locks the hi-speed and the covers together for a course that forbids changing them', () => {
    const state = createPlayState({
      view: {
        hiSpeed: createHiSpeedState({ hiSpeed: 2, locked: true }),
        covers: [{ side: '1P', sudden: 0.25, suddenOn: true, hidden: 0, hiddenOn: false, lift: 0 }],
      },
    });
    expect(reducePlayState(state, { type: 'hi-speed-step', delta: 0.5 })).toBe(state);
    expect(reducePlayState(state, { type: 'cover-adjust', part: 'sudden', delta: 0.1 })).toBe(state);
    // A replay's recorded covers and hi-speed still apply.
    const replayed = reducePlayState(state, { type: 'cover-set', covers: [{ side: '1P', sudden: 0.5 }] });
    expect(replayed.view.covers[0]!.sudden).toBe(0.5);
    const replayedSpeed = reducePlayState(replayed, { type: 'hi-speed-drawn', value: 3 });
    expect(replayedSpeed.view.hiSpeed).toMatchObject({ player: 3, drawn: 3, locked: true });
    expect(replayedSpeed.view.covers).toBe(replayed.view.covers);
  });
});
